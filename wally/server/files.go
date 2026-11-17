package main

// LOS ARCHIVOS ADJUNTOS: Wally los lee EN ESTA MÁQUINA y manda su texto dentro de la pregunta, aparte de lo que se ve
// en la conversación (ahí sólo queda su ficha). No se suben a AI Studio: lo que se sube allá queda en el Drive de la
// cuenta aunque el chat sea temporal, y eso es lo que Miguel no quiere (2026-11-17). Por eso van sólo los que tienen
// texto: texto plano y código, PDF (`pdftotext`, de poppler) y Word, RTF, ODT o HTML (`textutil`, de macOS). Una imagen
// o un binario se rechaza con su porqué.
//
// Un archivo subido queda en `wally/.data/files/<id>.txt` (el texto) y `<id>.json` (su ficha). Pertenece al bloque de
// la pregunta con la que se mandó: borrar ese bloque, o la conversación, lo borra del disco.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Attachment es la ficha de un archivo: lo que se ve en la conversación.
type Attachment struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`  // bytes del original
	Chars int    `json:"chars"` // caracteres del texto que viaja
	Kind  string `json:"kind"`  // texto · pdf · documento
}

const (
	maxUpload = 25 << 20  // 25 MB de original
	maxChars  = 3_000_000 // ~3 MB de texto: AI Studio se probó con 2 MB (2026-11-17)
)

// Lo que se lee como texto tal cual, por extensión (si no, decide el contenido: UTF-8 válido y sin bytes nulos).
var textExt = regexp.MustCompile(`(?i)\.(txt|md|markdown|csv|tsv|json|jsonl|ndjson|ya?ml|xml|log|sql|go|ts|tsx|js|jsx|mjs|vue|py|rb|php|java|kt|swift|rs|c|h|cpp|cs|sh|zsh|env|ini|toml|conf|css|scss|html?)$`)

// Lo que se convierte con las herramientas de macOS.
var docExt = regexp.MustCompile(`(?i)\.(docx?|rtf|odt|pages|webarchive)$`)

func (a *app) filesDir() string { return filepath.Join(a.root, "wally", ".data", "files") }

func validID(id string) bool { return regexp.MustCompile(`^[0-9a-f]{12}$`).MatchString(id) }

// extract devuelve el texto de un archivo y de qué tipo es, o por qué no se puede.
func extract(ctx context.Context, path, name string, head []byte) (string, string, error) {
	switch {
	case strings.EqualFold(filepath.Ext(name), ".pdf"):
		out, err := exec.CommandContext(ctx, "pdftotext", "-layout", "-enc", "UTF-8", path, "-").Output()
		if err != nil {
			return "", "", fmt.Errorf("no pude leer el PDF (%v): ¿está protegido, o es sólo imágenes escaneadas?", err)
		}
		if strings.TrimSpace(string(out)) == "" {
			return "", "", errors.New("el PDF no tiene texto: parece un escaneo (imágenes). Sin texto no hay qué mandar")
		}
		return string(out), "pdf", nil
	case docExt.MatchString(name):
		out, err := exec.CommandContext(ctx, "textutil", "-convert", "txt", "-stdout", path).Output()
		if err != nil {
			return "", "", fmt.Errorf("no pude convertir el documento a texto: %v", err)
		}
		return string(out), "documento", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	if textExt.MatchString(name) || (utf8.Valid(head) && !bytes.Contains(head, []byte{0})) {
		if !utf8.Valid(raw) {
			return "", "", errors.New("no es texto UTF-8")
		}
		return string(raw), "texto", nil
	}
	return "", "", fmt.Errorf("«%s» no es texto: por ahora van texto y código, PDF y Word. Imágenes y binarios tendrían "+
		"que subirse a AI Studio, que los guarda en tu Drive", name)
}

// upload recibe un archivo (multipart, campo «file»), extrae su texto y devuelve su ficha.
func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, fmt.Errorf("no llegó el archivo (máximo %d MB): %v", maxUpload>>20, err))
		return
	}
	defer file.Close()
	name := filepath.Base(header.Filename)
	if err := os.MkdirAll(a.filesDir(), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	// El original se guarda un momento para las herramientas que leen de un archivo, y se borra.
	tmp, err := os.CreateTemp(a.filesDir(), "subida-*"+filepath.Ext(name))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, io.LimitReader(file, maxUpload+1))
	tmp.Close()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if size > maxUpload {
		writeErr(w, 413, fmt.Errorf("«%s» pesa más de %d MB", name, maxUpload>>20))
		return
	}
	head := make([]byte, 8192)
	if f, err := os.Open(tmp.Name()); err == nil {
		n, _ := f.Read(head)
		head = head[:n]
		f.Close()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	text, kind, err := extract(ctx, tmp.Name(), name, head)
	if err != nil {
		writeErr(w, 415, err)
		return
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	chars := utf8.RuneCountInString(text)
	if chars > maxChars {
		writeErr(w, 413, fmt.Errorf("«%s» tiene %d caracteres de texto: el tope es %d (AI Studio se probó con unos 2 millones)", name, chars, maxChars))
		return
	}
	att := Attachment{ID: newID(), Name: name, Size: size, Chars: chars, Kind: kind}
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".txt"), []byte(text), 0o600); err != nil {
		writeErr(w, 500, err)
		return
	}
	meta, _ := json.Marshal(att)
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".json"), meta, 0o600); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, att)
}

// attachment lee la ficha de un archivo subido.
func (a *app) attachment(id string) (Attachment, error) {
	var att Attachment
	if !validID(id) {
		return att, errors.New("id de archivo inválido")
	}
	raw, err := os.ReadFile(filepath.Join(a.filesDir(), id+".json"))
	if err != nil {
		return att, fmt.Errorf("no existe el archivo %s", id)
	}
	return att, json.Unmarshal(raw, &att)
}

// fileText es el texto de un archivo (lo que viaja en la pregunta).
func (a *app) fileText(id string) (string, error) {
	if !validID(id) {
		return "", errors.New("id de archivo inválido")
	}
	raw, err := os.ReadFile(filepath.Join(a.filesDir(), id+".txt"))
	return string(raw), err
}

// readFile devuelve el texto extraído, para verlo desde la ficha.
func (a *app) readFile(w http.ResponseWriter, r *http.Request) {
	text, err := a.fileText(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, errors.New("no existe ese archivo"))
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, text)
}

// deleteFile borra un archivo subido que todavía no se mandó (la ✕ de su ficha en el campo).
func (a *app) deleteFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeErr(w, 400, errors.New("id de archivo inválido"))
		return
	}
	a.forgetFiles([]Attachment{{ID: id}})
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// forgetFiles borra del disco los archivos de un bloque o de una conversación.
func (a *app) forgetFiles(atts []Attachment) {
	for _, att := range atts {
		if validID(att.ID) {
			_ = os.Remove(filepath.Join(a.filesDir(), att.ID+".txt"))
			_ = os.Remove(filepath.Join(a.filesDir(), att.ID+".json"))
		}
	}
}

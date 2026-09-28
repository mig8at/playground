package canoncache

/* La copia local del corpus: `tablero/data/cache/canon/content/<tema>/context.md` y su `map.json`, para leer
 * canon como se lee cualquier archivo —grep, Read— y sin la VPN de prod.
 *
 * Por qué existe: la API obliga a acordarse de un comando por cada lectura, y lo que se lee con grep se
 * lee sin pensarlo. Medido el 2026-09-27 con radar: en 90 días hubo 13 consultas a canon para trabajar.
 *
 * ⚠ ES UNA COPIA, NO UNA FUENTE. Nadie la edita (los archivos quedan de sólo lectura): se reemplaza entera
 * cuando cambia el corpus, y lo que se quiera cambiar se dicta a canon (`make canon-write`). Así no vuelve
 * a pasar lo de `context/`, que eran dos contextos para mantener a la par.
 *
 * Cuándo se refresca: el export lleva en su header un `ETag` que es el sha256 de TODOS los archivos (el
 * «hash global»). Se le pide con el de la copia: si no cambió, canon contesta 304 y no se baja nada; si
 * cambió, se baja (~1,7 MB, ~1,6 s), se verifica contra su sha256 y se cambia de una vez. El ETag del
 * corpus (el de `/api/topics`) NO sirve para esto: no ve el diccionario ni el guion del agente, que
 * también vienen en el export. */

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

// Manifest es `VERSION.json`: de qué corpus es la copia.
type Manifest struct {
	ETag       string    `json:"etag"`      // el del corpus (el cuerpo del export)
	ExportTag  string    `json:"exportTag"` // el del header: el hash de TODOS los archivos, con el que se revalida
	SHA256     string    `json:"sha256"`
	ExportedAt string    `json:"exportedAt"`
	SyncedAt   time.Time `json:"syncedAt"`
	Files      int       `json:"files"`
	Source     string    `json:"source"`
	Note       string    `json:"note"`
}

// MirrorDir es la carpeta de la copia.
func MirrorDir(cacheDir string) string { return filepath.Join(cacheDir, "canon") }

// LoadMirror lee el manifiesto; ok=false si no hay copia.
func LoadMirror(cacheDir string) (Manifest, bool) {
	raw, err := os.ReadFile(filepath.Join(MirrorDir(cacheDir), "VERSION.json"))
	if err != nil {
		return Manifest{}, false
	}
	var m Manifest
	if json.Unmarshal(raw, &m) != nil || m.ETag == "" {
		return Manifest{}, false
	}
	return m, true
}

/* SyncMirror deja la copia al día con canon. Si no cambió (304, o el mismo sha256 de una instancia que
 * todavía no contesta 304), no hace nada (changed=false). Si cambió, baja, verifica y reemplaza; ante
 * cualquier error la copia anterior queda intacta. */
func SyncMirror(ctx context.Context, client *canon.Client, source, cacheDir string, now time.Time) (Manifest, bool, error) {
	old, had := LoadMirror(cacheDir)
	tag := ""
	if had {
		tag = old.ExportTag
	}
	exp, newTag, notModified, err := client.Export(ctx, tag)
	if err != nil {
		return old, false, err
	}
	if notModified {
		return old, false, nil
	}
	if had && exp.SHA256 == old.SHA256 {
		/* Mismo contenido, pero el tag puede faltar (una copia anterior a este campo) o ser otro: se anota,
		 * o la próxima revalidación no tendría con qué pedir el 304 y bajaría todo cada vez. */
		if newTag != "" && newTag != old.ExportTag {
			old.ExportTag = newTag
			if err := saveManifest(cacheDir, old); err != nil {
				return old, false, err
			}
		}
		return old, false, nil
	}
	if err := exp.Verify(); err != nil {
		return old, false, err
	}
	m := Manifest{ETag: exp.ETag, ExportTag: newTag, SHA256: exp.SHA256, ExportedAt: exp.ExportedAt, SyncedAt: now,
		Files: len(exp.Files), Source: source,
		Note: "Copia de canon: no se edita, se reemplaza entera cuando cambia el corpus. Para cambiar algo: make canon-write."}
	if err := writeMirror(cacheDir, exp.Files, m); err != nil {
		return old, false, err
	}
	return m, true, nil
}

// safePath: una ruta del export dentro de `content/`, sin salirse de la carpeta.
func safePath(p string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(p))
	if filepath.IsAbs(clean) || !strings.HasPrefix(clean, "content"+string(filepath.Separator)) ||
		strings.Contains(clean, ".."+string(filepath.Separator)) || strings.HasSuffix(clean, "..") {
		return "", false
	}
	return clean, true
}

// saveManifest reescribe sólo `VERSION.json`, por renombre (el archivo es de sólo lectura).
func saveManifest(cacheDir string, m Manifest) error {
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(MirrorDir(cacheDir), "VERSION.json")
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, raw, 0o444); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// writeMirror arma la copia al lado y la cambia con dos renombres: quien lee nunca ve una a medias.
func writeMirror(cacheDir string, files map[string]string, m Manifest) error {
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(cacheDir, "canon.tmp-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp) // si todo sale bien ya no existe
	for p, content := range files {
		rel, ok := safePath(p)
		if !ok {
			return fmt.Errorf("el export trae una ruta fuera de content/: %q", p)
		}
		dst := filepath.Join(tmp, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, []byte(content), 0o444); err != nil {
			return err
		}
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(tmp, "VERSION.json"), raw, 0o444); err != nil {
		return err
	}
	dir := MirrorDir(cacheDir)
	retired := fmt.Sprintf("%s.old-%d", dir, os.Getpid())
	if _, err := os.Stat(dir); err == nil {
		if err := os.Rename(dir, retired); err != nil {
			return err
		}
	}
	if err := os.Rename(tmp, dir); err != nil {
		_ = os.Rename(retired, dir) // volver a dejar la anterior
		return err
	}
	return os.RemoveAll(retired)
}

// MirrorWait es lo que se espera al export cuando el corpus cambió (mide ~1,6 s): sólo se paga ese día.
const MirrorWait = 8 * time.Second

/* MirrorLine es cómo se nombra la copia ante quien la va a leer: dónde está, de qué versión y cómo se
 * busca. `rel` es la ruta de la carpeta tal como conviene mostrarla (relativa a la raíz del playground). */
func MirrorLine(m Manifest, ok bool, syncErr error, rel string) string {
	if !ok {
		if syncErr != nil {
			return "    copia local: no hay (canon no respondió: " + syncErr.Error() + ")"
		}
		return "    copia local: no hay"
	}
	state := "al día"
	if syncErr != nil {
		state = "del " + m.SyncedAt.Local().Format("2006-01-02 15:04") + ", canon no respondió"
	}
	return fmt.Sprintf("    copia local (%s): %s/content/<tema>/context.md y map.json — se lee con grep y Read, sin VPN;\n"+
		"      no se edita: se reemplaza cuando cambia el corpus", state, rel)
}

// canon lee y dicta canon, el corpus compartido de CreditOp, en un comando (`make canon-*`).
//
//	search "<palabras del negocio>"      qué sección y qué área lo cubren (gratis, sin modelo)
//	read <id>[,<id>…]                    secciones completas: `cuota/context#<ancla>` o el tema entero
//	code <tema/capa> [n]                 los archivos que declara el área n del tema
//	propose <pieza.json>                 dónde iría y qué le rechaza el lint. NO escribe
//	write <pieza.json>… [-title T]       borrador → piezas → cierre: UNA revisión. ESCRIBE
//
// El origen es CANON_URL —producción por defecto, que pide la VPN de prod—, el mismo del tablero. La
// pieza es un JSON con las claves del borrador de canon; `text_file` en vez de `text` lee la prosa de
// un archivo relativo a la pieza. Qué entra y cómo: `.claude/skills/canon/SKILL.md` en la raíz.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/canon"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := canon.FromEnv()
	args := os.Args[2:]

	var err error
	switch os.Args[1] {
	case "search":
		err = search(ctx, client, strings.Join(args, " "))
	case "read":
		err = read(ctx, client, args)
	case "code":
		err = code(ctx, client, args)
	case "propose":
		err = propose(ctx, client, args)
	case "write":
		err = write(ctx, client, args)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "uso: canon search|read|code|propose|write …  (ver `make canon-search` y sus vecinos)")
	os.Exit(2)
}

func search(ctx context.Context, client *canon.Client, query string) error {
	if strings.TrimSpace(query) == "" {
		return fmt.Errorf("falta qué buscar: palabras del negocio, en español y cortas")
	}
	found, err := client.Search(ctx, query)
	if err != nil {
		return err
	}
	fmt.Printf("  prosa (%s):\n", canon.URL())
	for i, hit := range found.Prose {
		if i == 6 {
			break
		}
		fmt.Printf("    %s#%s  ·  %s\n", hit.Node, hit.Anchor, hit.Section)
	}
	fmt.Println("  mapa (dónde vive en el código):")
	for i, hit := range found.Map {
		if i == 4 {
			break
		}
		fmt.Printf("    %s  ·  %s\n", hit.Cite, clip(hit.Goal, 110))
	}
	if found.Uncovered != nil {
		if text, _ := json.Marshal(found.Uncovered); len(text) > 4 {
			fmt.Printf("  ⚠ sin cubrir: %s\n", text)
		}
	}
	if len(found.Prose) == 0 {
		fmt.Println("  ⚠ nada: probá otras palabras; si sigue vacío, canon no lo tiene (no es lo mismo que «no existe»)")
	}
	fmt.Println("  → leer: make canon-read IDS='<tema/capa#ancla>'")
	return nil
}

func read(ctx context.Context, client *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta IDS: `cuota/context#<ancla>`, varias por coma, o el tema")
	}
	text, err := client.Markdown(ctx, args[0])
	if err != nil {
		return err
	}
	fmt.Print(text)
	return nil
}

func code(ctx context.Context, client *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta el área: `cuota/context` y, si hace falta, su número")
	}
	n := 0
	if len(args) > 1 {
		n, _ = strconv.Atoi(args[1])
	}
	area, err := client.Code(ctx, args[0], n)
	if err != nil {
		return err
	}
	fmt.Printf("  %s · área %d: %s\n", args[0], n, area.Area.Goal)
	for _, f := range area.Files {
		fmt.Printf("    %s:%s  (%s)\n", f.Repo, f.Path, f.Hash)
	}
	return nil
}

func propose(ctx context.Context, client *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta la pieza (.json)")
	}
	piece, err := loadPiece(args[0])
	if err != nil {
		return err
	}
	result, err := client.Propose(ctx, piece)
	if err != nil {
		return err
	}
	lint := "sin objeciones"
	if result.Lint != nil {
		text, _ := json.Marshal(result.Lint)
		lint = string(text)
	}
	fmt.Printf("  ready: %v  ·  lint: %s\n", result.Ready, lint)
	if result.Missing != nil {
		text, _ := json.Marshal(result.Missing)
		fmt.Printf("  le falta: %s\n", text)
	}
	for i, where := range result.Where {
		if i == 3 {
			break
		}
		fmt.Printf("    podría ir cerca de: %s\n", where.Read)
	}
	return nil
}

func write(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("write", flag.ExitOnError)
	title := flags.String("title", "canon: dictado desde el playground", "el título de la revisión")
	author := flags.String("author", envOr("CANON_AUTHOR", "Miguel Ochoa"), "quién firma la revisión")
	_ = flags.Parse(args)
	if flags.NArg() == 0 {
		return fmt.Errorf("falta al menos una pieza (.json)")
	}
	var pieces []canon.Piece
	for _, path := range flags.Args() {
		piece, err := loadPiece(path)
		if err != nil {
			return err
		}
		pieces = append(pieces, piece)
	}
	written, err := client.Write(ctx, *author, *title, pieces)
	for i, result := range written.Pieces {
		fmt.Printf("  ✓ %v · «%v»: %s\n", pieces[i]["node"], pieces[i]["section"], result.Operation)
		for note, text := range result.Notes {
			fmt.Printf("    ⚠ %s: %s\n", note, clip(text, 220))
		}
	}
	if err != nil {
		return err
	}
	fmt.Printf("  ✓ revisión %d en %s\n", written.Revision, canon.URL())
	if written.Unlinked != nil {
		if text, _ := json.Marshal(written.Unlinked); len(text) > 4 {
			fmt.Printf("    ⚠ sin enlazar: %s\n", text)
		}
	}
	return nil
}

// loadPiece lee una pieza; con `text_file` la prosa sale de un archivo relativo a la pieza.
func loadPiece(path string) (canon.Piece, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var piece canon.Piece
	if err := json.Unmarshal(raw, &piece); err != nil {
		return nil, fmt.Errorf("%s no es un JSON válido: %w", path, err)
	}
	if file, ok := piece["text_file"].(string); ok {
		text, err := os.ReadFile(filepath.Join(filepath.Dir(path), file))
		if err != nil {
			return nil, err
		}
		delete(piece, "text_file")
		piece["text"] = strings.TrimSpace(string(text))
	}
	return piece, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func clip(text string, n int) string {
	runes := []rune(text)
	if len(runes) <= n {
		return text
	}
	return string(runes[:n]) + "…"
}

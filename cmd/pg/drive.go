package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/drive"
)

// Google Drive por su conector, y sólo lectura. Cada comando acepta la URL que se copia del navegador
// (carpeta, archivo, Doc, Sheet o Slides) o el id.

func driveClient() (*drive.Client, int) {
	cl, err := drive.Open()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return cl, 0
}

// driveRef separa la referencia (el primer posicional) de las banderas, como figmaRef.
func driveRef(fs *flag.FlagSet, args []string) (string, int) {
	var pos []string
	for len(args) > 0 {
		if fs.Parse(args) != nil {
			return "", 2
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(pos) == 0 {
		return "", fail(2, "falta la URL de Drive o el id")
	}
	id, err := drive.ParseID(pos[0])
	if err != nil {
		return "", fail(2, "%v", err)
	}
	return id, 0
}

func runDriveLogin(args []string) int {
	oc, err := drive.LoadOAuthClient()
	if err != nil {
		return fail(2, "%v", err)
	}
	open := func(u string) {
		fmt.Fprintf(os.Stderr, "abrí en el navegador (si no se abrió solo):\n\n  %s\n\n", u)
		_ = exec.Command("open", u).Start()
	}
	s, err := drive.Login(context.Background(), oc, open, 5*time.Minute)
	if err != nil {
		return fail(1, "%v", err)
	}
	p, _ := drive.SessionPath()
	fmt.Printf("sesión de Drive como %s, sólo lectura · guardada en %s\n", s.Email, p)
	return 0
}

func runDriveLogout(args []string) int {
	revoked, err := drive.Logout(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	if revoked {
		fmt.Println("sesión de Drive revocada en Google y borrada")
	} else {
		fmt.Println("sesión de Drive borrada (Google no confirmó la revocación: revisá myaccount.google.com/permissions)")
	}
	return 0
}

func runDriveMe(args []string) int {
	cl, code := driveClient()
	if cl == nil {
		return code
	}
	u, err := cl.Me(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("la sesión de Drive es de %s (%s), sólo lectura\n", u.Name, u.Email)
	return 0
}

func runDriveLs(args []string) int {
	fs := flag.NewFlagSet("drive ls", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON")
	id, code := driveRef(fs, args)
	if code != 0 {
		return code
	}
	cl, code := driveClient()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	f, err := cl.Get(ctx, id)
	if err != nil {
		return fail(1, "%v", err)
	}
	if !f.IsFolder() {
		return fail(2, "%q no es una carpeta: para leerlo, pg drive read %s", f.Name, f.ID)
	}
	files, err := cl.List(ctx, f.ID)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(map[string]any{"folder": f, "files": files})
	}
	fmt.Printf("%s  (%s%s)\n\n", f.Name, f.ID, ownerOf(f))
	printFiles(files)
	return 0
}

func runDriveSearch(args []string) int {
	fs := flag.NewFlagSet("drive search", flag.ContinueOnError)
	q := fs.String("q", "", "el texto a buscar, en el nombre o el contenido")
	folder := fs.String("folder", "", "sólo dentro de esta carpeta (URL o id; sus hijos directos)")
	n := fs.Int("n", 50, "cuántos resultados como máximo")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*q) == "" {
		return fail(2, "falta --q")
	}
	parent := ""
	if *folder != "" {
		id, err := drive.ParseID(*folder)
		if err != nil {
			return fail(2, "%v", err)
		}
		parent = id
	}
	cl, code := driveClient()
	if cl == nil {
		return code
	}
	files, err := cl.Search(context.Background(), *q, parent, *n)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(files)
	}
	if len(files) == 0 {
		fmt.Println("nada: la búsqueda sólo ve lo que tu cuenta ve")
		return 0
	}
	printFiles(files)
	return 0
}

func runDriveRead(args []string) int {
	fs := flag.NewFlagSet("drive read", flag.ContinueOnError)
	out := fs.String("out", "", "guardar en este archivo o carpeta en vez de imprimir (obligatorio para PDF, xlsx, docx…)")
	format := fs.String("format", "", "exportar un Doc/Sheet/Slides a otro mime (ej. application/pdf, …sheet para xlsx)")
	id, code := driveRef(fs, args)
	if code != 0 {
		return code
	}
	cl, code := driveClient()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	f, err := cl.Get(ctx, id)
	if err != nil {
		return fail(1, "%v", err)
	}
	if f.IsFolder() {
		files, err := cl.List(ctx, f.ID)
		if err != nil {
			return fail(1, "%v", err)
		}
		fmt.Printf("%s es una carpeta:\n\n", f.Name)
		printFiles(files)
		return 0
	}

	var body io.ReadCloser
	ext := filepath.Ext(f.Name)
	switch {
	case drive.IsGoogle(f.MimeType):
		mime, e, ok := drive.DefaultExport(f.MimeType)
		if *format != "" {
			mime, e, ok = *format, "", true
		}
		if !ok {
			return fail(2, "%q es %s: no tiene exportación a texto; probá --format", f.Name, f.MimeType)
		}
		ext = e
		body, err = cl.Export(ctx, f.ID, mime)
	default:
		if !drive.IsText(f.MimeType) && *out == "" {
			return fail(2, "%q es %s (%s): no es texto. Bajalo con --out <archivo o carpeta> y leelo con la herramienta de ese formato",
				f.Name, f.MimeType, humanSize(f.Size))
		}
		body, err = cl.Download(ctx, f.ID)
	}
	if err != nil {
		return fail(1, "%v", err)
	}
	defer body.Close()

	if *out == "" {
		if f.MimeType == drive.Sheet && *format == "" {
			fmt.Fprintln(os.Stderr, "(sólo la primera hoja: para todas, --format application/vnd.openxmlformats-officedocument.spreadsheetml.sheet --out …)")
		}
		_, err := io.Copy(os.Stdout, body)
		if err != nil {
			return fail(1, "%v", err)
		}
		return 0
	}
	dest := *out
	if st, err := os.Stat(dest); err == nil && st.IsDir() {
		name := f.Name
		if ext != "" && filepath.Ext(name) != ext {
			name += ext
		}
		dest = filepath.Join(dest, strings.ReplaceAll(name, string(os.PathSeparator), "_"))
	}
	w, err := os.Create(dest)
	if err != nil {
		return fail(1, "%v", err)
	}
	n, err := io.Copy(w, body)
	if cerr := w.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%s → %s (%s)\n", f.Name, dest, humanSize(strconv.FormatInt(n, 10)))
	return 0
}

func printFiles(files []drive.File) {
	for _, f := range files {
		kind := shortMime(f.MimeType)
		if f.IsFolder() {
			kind = "carpeta"
		}
		mod := f.ModifiedTime
		if len(mod) >= 10 {
			mod = mod[:10]
		}
		fmt.Printf("  %-9s %-10s %8s  %s\n    %s\n", kind, mod, humanSize(f.Size), f.Name, f.ID)
	}
	fmt.Printf("\n%d elemento(s) · leer uno: pg drive read <id> · una carpeta: pg drive ls <id>\n", len(files))
}

func ownerOf(f drive.File) string {
	if len(f.Owners) == 0 {
		return ""
	}
	return " · de " + f.Owners[0].Email
}

func shortMime(m string) string {
	switch m {
	case drive.Doc:
		return "doc"
	case drive.Sheet:
		return "sheet"
	case drive.Slides:
		return "slides"
	case drive.Shortcut:
		return "atajo"
	case "application/pdf":
		return "pdf"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return "xlsx"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return "docx"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return "pptx"
	}
	if i := strings.LastIndex(m, "/"); i >= 0 {
		return m[i+1:]
	}
	return m
}

func humanSize(s string) string {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || s == "" {
		return "—"
	}
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

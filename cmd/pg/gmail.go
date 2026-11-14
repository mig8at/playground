package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"creditop/my-tools/connectors/gmail"
)

// Gmail por su conector, sólo lectura: la cuenta de quien hizo `pg gmail login`. Lo usa también la herramienta de
// correo (correo/), que vigila remitentes y avisa.

func gmailClient() (*gmail.Client, int) {
	cl, err := gmail.Open()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return cl, 0
}

func runGmailLogin(args []string) int {
	open := func(u string) {
		fmt.Fprintf(os.Stderr, "abrí en el navegador (si no se abrió solo):\n\n  %s\n\n", u)
		_ = exec.Command("open", u).Start()
	}
	s, err := gmail.Login(context.Background(), open, 5*time.Minute)
	if err != nil {
		return fail(1, "%v", err)
	}
	p, _ := gmail.SessionPath()
	fmt.Printf("sesión de Gmail como %s, sólo lectura · guardada en %s\n", s.Email, p)
	return 0
}

func runGmailLogout(args []string) int {
	revoked, err := gmail.Logout(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	if revoked {
		fmt.Println("sesión de Gmail revocada en Google y borrada")
	} else {
		fmt.Println("sesión de Gmail borrada (Google no confirmó la revocación: revisá myaccount.google.com/permissions)")
	}
	return 0
}

func runGmailMe(args []string) int {
	cl, code := gmailClient()
	if cl == nil {
		return code
	}
	p, err := cl.Profile(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%s · %d correos\n", p.Email, p.Messages)
	return 0
}

func runGmailSearch(args []string) int {
	fs := flag.NewFlagSet("gmail search", flag.ContinueOnError)
	q := fs.String("q", "", "la búsqueda, con la sintaxis de Gmail (from:support@shopify.com newer_than:7d)")
	n := fs.Int("n", 20, "cuántos como máximo")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*q) == "" {
		return fail(2, "falta --q")
	}
	cl, code := gmailClient()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	ids, err := cl.Search(ctx, *q, *n)
	if err != nil {
		return fail(1, "%v", err)
	}
	var out []gmail.Message
	for _, id := range ids {
		m, err := cl.Get(ctx, id, false)
		if err != nil {
			return fail(1, "%v", err)
		}
		out = append(out, m)
	}
	if *asJSON {
		return printJSON(out)
	}
	for _, m := range out {
		fmt.Printf("%s  %s\n    %s\n    %s\n", m.Date.Format("2006-01-02 15:04"), m.ID, m.From, m.Subject)
	}
	if len(out) == 0 {
		fmt.Println("nada")
	}
	return 0
}

// parseWithID lee las banderas antes o después del id (Go deja de leer banderas en el primer posicional: `read <id>
// --json` perdía el --json).
func parseWithID(fs *flag.FlagSet, args []string) (string, bool) {
	var pos []string
	for {
		if fs.Parse(args) != nil {
			return "", false
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(pos) == 0 {
		return "", true
	}
	return pos[0], true
}

func runGmailRead(args []string) int {
	fs := flag.NewFlagSet("gmail read", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON")
	id, ok := parseWithID(fs, args)
	if !ok {
		return 2
	}
	if id == "" {
		return fail(2, "falta el id del mensaje (lo da `pg gmail search`)")
	}
	cl, code := gmailClient()
	if cl == nil {
		return code
	}
	m, err := cl.Get(context.Background(), id, true)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(m)
	}
	fmt.Printf("De: %s\nPara: %s\nAsunto: %s\nFecha: %s\n\n%s\n", m.From, m.To, m.Subject, m.Date.Format("2006-01-02 15:04"), m.Body)
	return 0
}

func runGmailThread(args []string) int {
	fs := flag.NewFlagSet("gmail thread", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON")
	id, ok := parseWithID(fs, args)
	if !ok {
		return 2
	}
	if id == "" {
		return fail(2, "falta el id del hilo (el threadId que da `pg gmail search --json`)")
	}
	cl, code := gmailClient()
	if cl == nil {
		return code
	}
	msgs, err := cl.Thread(context.Background(), id)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(msgs)
	}
	for _, m := range msgs {
		fmt.Printf("%s  %s  %s\n    %s\n", m.Date.Format("2006-01-02 15:04"), m.ID, m.From, m.Snippet)
	}
	return 0
}

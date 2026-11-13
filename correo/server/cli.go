package main

// LA CONSOLA: `bin/correo …`, para Miguel y para un agente («¿contestó VTEX?»). Lo que se sigue sale de la API si está
// arriba (lo de fondo, que lee cada minuto) y si no, de lo guardado en correo/.data; buscar y leer van directo a Gmail
// con la sesión de `bin/pg gmail login`. Todo acepta --json. Sólo lee Gmail: seguir y dejar de seguir cambian la lista
// de esta herramienta, no el correo.

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/gmail"
)

var cliCommands = map[string]bool{"list": true, "watches": true, "latest": true, "read": true, "search": true,
	"follow": true, "unfollow": true, "refresh": true, "noreply": true, "digest": true, "help": true}

const api = "http://127.0.0.1:5225"

const cliHelp = `correo — los correos de los remitentes que se siguen (Shopify, VTEX…), por consola. Sólo lee Gmail.

  bin/correo watches                         qué se sigue: nombre, búsqueda de Gmail y cuántos sin ver
  bin/correo list [seguimiento] [--unread | --pending] [--n 10]
                                             los correos de lo que se sigue (o de uno), con su estado (● sin ver,
                                             ◐ por responder, ✓ respondido) y su enlace a Gmail
  bin/correo latest <seguimiento>            el último que llegó de ese seguimiento y hace cuánto («¿contestó VTEX?»)
  bin/correo read <id>                       un correo entero (el id lo dan list y search)
  bin/correo digest <id> [--refresh]         el hilo de ese correo desglosado EN ESPAÑOL: resumen, en qué está, qué te
                                             toca y cada mensaje (ellos / vos) en puntos. Lo arma Gemini; se guarda por
                                             hilo y se rearma sólo si llegó un mensaje nuevo
  bin/correo search --q '<búsqueda de Gmail>' [--n 20]
                                             cualquier búsqueda en Gmail, se siga o no
  bin/correo follow --name 'Soporte VTEX' --query 'from:support@vtexhelp.zendesk.com'
                                             seguir otro; con el nombre de uno que ya se sigue, le cambia la búsqueda
  bin/correo unfollow <seguimiento>          dejar de seguir (Gmail no se toca)
  bin/correo noreply <id> [--undo]           «no hace falta responder» (un acuse automático); --undo lo devuelve
  bin/correo refresh                         que lo de fondo lea ya

  --json en cualquiera, para un agente. El seguimiento es su id (shopify, vtex…) o su nombre.`

func runCLI(root string, args []string) int {
	cmd, rest := args[0], args[1:]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON")
	unread := fs.Bool("unread", false, "sólo los sin ver")
	pending := fs.Bool("pending", false, "sólo los por responder (vistos, y lo último del hilo es de ellos)")
	n := fs.Int("n", 10, "cuántos como máximo")
	q := fs.String("q", "", "la búsqueda, con la sintaxis de Gmail")
	undo := fs.Bool("undo", false, "deshacer (noreply)")
	refresh := fs.Bool("refresh", false, "volver a armar el desglose aunque el hilo no haya cambiado")
	name := fs.String("name", "", "el nombre del seguimiento")
	query := fs.String("query", "", "la búsqueda de Gmail del seguimiento")
	// Los posicionales pueden ir antes o después de las banderas.
	var pos []string
	for {
		if err := fs.Parse(rest); err != nil {
			return 2
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	arg := strings.Join(pos, " ")
	out := func(v any, text func()) int {
		if *asJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			_ = enc.Encode(v)
		} else {
			text()
		}
		return 0
	}
	fail := func(format string, a ...any) int {
		fmt.Fprintf(os.Stderr, "correo: "+format+"\n", a...)
		return 1
	}

	switch cmd {
	case "help":
		fmt.Println(cliHelp)
		return 0

	case "watches":
		o, src, err := overviewFor(root)
		if err != nil {
			return fail("%v", err)
		}
		return out(o.Watches, func() {
			fmt.Println(src)
			for _, w := range o.Watches {
				fmt.Printf("%-12s %-12s %2d sin ver · %2d por responder · %2d esta semana · %s\n", w.ID, w.Name, w.Unread, w.Pending, w.Week, w.Query)
			}
		})

	case "list", "latest":
		o, src, err := overviewFor(root)
		if err != nil {
			return fail("%v", err)
		}
		watches := o.Watches
		if arg != "" {
			w, ok := findWatch(watches, arg)
			if !ok {
				return fail("no se sigue «%s»: `bin/correo watches` dice qué se sigue", arg)
			}
			watches = []WatchView{w}
		} else if cmd == "latest" {
			return fail("¿de qué seguimiento? `bin/correo latest vtex`")
		}
		if cmd == "latest" {
			w := watches[0]
			if len(w.Messages) == 0 {
				return out(nil, func() { fmt.Printf("%s: nada en los últimos 60 días (%s)\n", w.Name, w.Query) })
			}
			m := w.Messages[0]
			// ¿Quién escribió último en ese hilo? Si fuiste vos, se espera a ellos; si fueron ellos, te toca.
			type latestView struct {
				MessageView
				LastInThread *gmail.Message `json:"lastInThread,omitempty"`
				Waiting      string         `json:"waiting,omitempty"` // «them» (contestaste vos) o «you»
			}
			lv := latestView{MessageView: m}
			if c, err := gmail.Open(); err == nil {
				if th, err := c.Thread(context.Background(), m.ThreadID); err == nil && len(th) > 0 {
					last := th[len(th)-1]
					lv.LastInThread = &last
					lv.Waiting = "you"
					if strings.Contains(strings.ToLower(last.From), strings.ToLower(c.Email())) {
						lv.Waiting = "them"
					}
				}
			}
			return out(lv, func() {
				fmt.Printf("%s · el último de ellos, hace %s (%s)\n", w.Name, ago(m.Date), m.Date.Format("2006-01-02 15:04"))
				printMessage(m)
				switch {
				case lv.Waiting == "them":
					fmt.Printf("\n  Lo último del hilo es tuyo (%s, hace %s): se espera a ellos.\n", lv.LastInThread.Date.Format("2006-01-02 15:04"), ago(lv.LastInThread.Date))
				case lv.Waiting == "you":
					fmt.Println("\n  Lo último del hilo es de ellos: te toca contestar.")
				}
			})
		}
		type item struct {
			Watch string `json:"watch"`
			MessageView
		}
		var list []item
		for _, w := range watches {
			count := 0
			for _, m := range w.Messages {
				if (*unread && m.Status != "unread") || (*pending && m.Status != "pending") || count >= *n {
					continue
				}
				list = append(list, item{w.ID, m})
				count++
			}
		}
		return out(list, func() {
			fmt.Println(src)
			last := ""
			for _, it := range list {
				if it.Watch != last {
					fmt.Printf("\n%s\n", it.Watch)
					last = it.Watch
				}
				printMessage(it.MessageView)
			}
			if len(list) == 0 {
				fmt.Println("nada")
			}
		})

	case "read":
		if arg == "" {
			return fail("falta el id del correo (lo dan `bin/correo list` y `search`)")
		}
		c, err := gmail.Open()
		if err != nil {
			return fail("%v", err)
		}
		m, err := c.Get(context.Background(), arg, true)
		if err != nil {
			return fail("%v", err)
		}
		return out(m, func() {
			fmt.Printf("De: %s\nPara: %s\n", m.From, m.To)
			if m.Cc != "" {
				fmt.Printf("Cc: %s\n", m.Cc)
			}
			fmt.Printf("Asunto: %s\nFecha: %s\nGmail: %s\n\n%s\n", m.Subject, m.Date.Format("2006-01-02 15:04"), threadURL(c.Email(), m.ThreadID), m.Body)
		})

	case "digest":
		if arg == "" {
			return fail("falta el id de un correo o de su hilo (lo da `bin/correo list`)")
		}
		c, err := gmail.Open()
		if err != nil {
			return fail("%v", err)
		}
		thread := arg
		if m, err := c.Get(context.Background(), arg, false); err == nil && m.ThreadID != "" {
			thread = m.ThreadID
		}
		g, err := newDigester(filepath.Join(root, "correo", ".data")).get(c, thread, *refresh)
		if err != nil {
			return fail("%v", err)
		}
		return out(g, func() {
			fmt.Printf("%s\n\n%s\n\nEstado: %s\nSiguiente: %s\n", g.Subject, g.Summary, g.Status, g.Next)
			for _, t := range g.Turns {
				who := sender(t.From)
				if t.Mine {
					who = "Vos"
				}
				fmt.Printf("\n%s · %s\n", who, t.Date.Format("2006-01-02 15:04"))
				for _, p := range t.Points {
					fmt.Printf("  · %s\n", p)
				}
			}
			fmt.Printf("\n(%s, %s)\n", g.Model, g.At.Format("2006-01-02 15:04"))
		})

	case "search":
		if strings.TrimSpace(*q) == "" {
			*q = arg
		}
		if strings.TrimSpace(*q) == "" {
			return fail("falta --q '<búsqueda de Gmail>'")
		}
		c, err := gmail.Open()
		if err != nil {
			return fail("%v", err)
		}
		ctx := context.Background()
		ids, err := c.Search(ctx, *q, *n)
		if err != nil {
			return fail("%v", err)
		}
		var list []MessageView
		for _, id := range ids {
			m, err := c.Get(ctx, id, false)
			if err != nil {
				return fail("%v", err)
			}
			list = append(list, MessageView{Message: m, URL: threadURL(c.Email(), m.ThreadID)})
		}
		return out(list, func() {
			for _, m := range list {
				printMessage(m)
			}
			if len(list) == 0 {
				fmt.Println("nada")
			}
		})

	case "follow":
		if *name == "" || *query == "" {
			return fail("falta --name y --query (por ejemplo --name 'Soporte VTEX' --query 'from:support@vtexhelp.zendesk.com')")
		}
		w := Watch{Name: *name, Query: *query}
		// Con el nombre de uno que ya se sigue, le cambia la búsqueda (y se vuelve a estrenar: no avisa lo de antes).
		if o, _, err := overviewFor(root); err == nil {
			if old, ok := findWatch(o.Watches, *name); ok {
				w.ID, w.Name = old.ID, old.Name
			}
		}
		if apiUp() {
			if err := postJSON("/api/watches", w); err != nil {
				return fail("%v", err)
			}
		} else {
			st, err := openStore(filepath.Join(root, "correo", ".data"))
			if err != nil {
				return fail("%v", err)
			}
			if _, err := st.addWatch(w); err != nil {
				return fail("%v", err)
			}
		}
		fmt.Printf("se sigue «%s» (%s); lo de antes no avisa, lo nuevo sí\n", *name, *query)
		return 0

	case "unfollow":
		o, _, err := overviewFor(root)
		if err != nil {
			return fail("%v", err)
		}
		w, ok := findWatch(o.Watches, arg)
		if !ok {
			return fail("no se sigue «%s»", arg)
		}
		if apiUp() {
			req, _ := http.NewRequest(http.MethodDelete, api+"/api/watches?id="+w.ID, nil)
			if err := do(req); err != nil {
				return fail("%v", err)
			}
		} else {
			st, err := openStore(filepath.Join(root, "correo", ".data"))
			if err != nil {
				return fail("%v", err)
			}
			if err := st.removeWatch(w.ID); err != nil {
				return fail("%v", err)
			}
		}
		fmt.Printf("ya no se sigue «%s»\n", w.Name)
		return 0

	case "noreply":
		if arg == "" {
			return fail("falta el id del correo (lo da `bin/correo list`)")
		}
		body := map[string]any{"ids": pos, "undo": *undo}
		if apiUp() {
			if err := postJSON("/api/noreply", body); err != nil {
				return fail("%v", err)
			}
		} else {
			st, err := openStore(filepath.Join(root, "correo", ".data"))
			if err != nil {
				return fail("%v", err)
			}
			if err := st.markNoReply(pos, *undo, time.Now()); err != nil {
				return fail("%v", err)
			}
		}
		if *undo {
			fmt.Println("vuelve a contar como por responder")
		} else {
			fmt.Println("listo: no hace falta responder")
		}
		return 0

	case "refresh":
		if !apiUp() {
			return fail("no corre: `make correo-install` lo deja de fondo")
		}
		if err := postJSON("/api/refresh", map[string]bool{}); err != nil {
			return fail("%v", err)
		}
		fmt.Println("leyendo Gmail; en unos segundos, `bin/correo list`")
		return 0
	}
	fmt.Println(cliHelp)
	return 2
}

// overviewFor: la vista de la API si está arriba (lo que lee cada minuto); si no, la de lo guardado.
func overviewFor(root string) (Overview, string, error) {
	var o Overview
	if res, err := (&http.Client{Timeout: 5 * time.Second}).Get(api + "/api/overview"); err == nil {
		defer res.Body.Close()
		if res.StatusCode == http.StatusOK && json.NewDecoder(res.Body).Decode(&o) == nil {
			src := fmt.Sprintf("%s · leído a las %s", o.Account, o.CheckedAt.Format("15:04"))
			if o.Error != "" {
				src += " · ⚠ " + o.Error
			}
			return o, src, nil
		}
	}
	b, err := os.ReadFile(filepath.Join(root, "correo", ".data", "state.json"))
	if err != nil {
		return o, "", fmt.Errorf("ni la API contesta ni hay nada guardado: `make correo-install` (y `bin/pg gmail login`)")
	}
	s := &store{}
	if err := json.Unmarshal(b, &s.st); err != nil {
		return o, "", err
	}
	o.Watches, o.Unread = s.view("")
	return o, "⚠ la API no contesta: esto es lo guardado de la última lectura (`make correo-install` la deja de fondo)", nil
}

func findWatch(ws []WatchView, key string) (WatchView, bool) {
	key = strings.ToLower(strings.TrimSpace(key))
	for _, w := range ws {
		if w.ID == key || strings.ToLower(w.Name) == key {
			return w, true
		}
	}
	return WatchView{}, false
}

// printMessage: un correo con su estado. ● sin ver · ◐ por responder · ✓ respondido (y cuándo) · – no hace falta.
func printMessage(m MessageView) {
	mark, status := " ", ""
	switch m.Status {
	case "unread":
		mark, status = "●", "sin ver"
	case "pending":
		mark, status = "◐", "por responder"
	case "replied":
		mark, status = "✓", "respondido el "+m.RepliedAt.Format("2006-01-02 15:04")
	case "noreply":
		mark, status = "–", "no hace falta responder"
	}
	if status != "" {
		status = " · " + status
	}
	fmt.Printf("%s %s  %s%s\n    %s\n    id %s · %s\n", mark, m.Date.Format("2006-01-02 15:04"), sender(m.From), status, m.Subject, m.ID, m.URL)
}

func ago(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Hour:
		return fmt.Sprintf("%d min", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%d h", int(d.Hours()))
	default:
		return fmt.Sprintf("%d días", int(d.Hours()/24))
	}
}

func apiUp() bool { return correoAt("127.0.0.1:5225") }

func postJSON(path string, v any) error {
	b, _ := json.Marshal(v)
	req, _ := http.NewRequest(http.MethodPost, api+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	return do(req)
}

func do(req *http.Request) error {
	res, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

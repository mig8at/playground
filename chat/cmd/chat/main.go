// Command chat es bin/chat: el chat del equipo desde la terminal, para una conversación en vivo (una sesión de Claude
// que espera y contesta). Habla con el servidor de `make chat` (:5185), que guarda el historial en disco y manda por el
// CLI `playground`: no es otro cliente del chat.
//
//	bin/chat inbox                       las conversaciones, la más reciente primero (★ = te escribieron último)
//	bin/chat history <quién> [-n 30]     la conversación con alguien o con un grupo (#demo), con los ids
//	bin/chat follow <quién>… [--json]    cada mensaje nuevo de esas conversaciones, apenas llega (para un Monitor)
//	bin/chat send <quién> <texto…>       manda un mensaje (--re <id> para contestar uno)
//	bin/chat reply <quién> <texto…>      contesta el último mensaje que te mandó
//
// <quién>: el correo, su parte antes de la @ (o el comienzo: `duncan`), `@duncan`, o un grupo `#demo`.
// ⚠ send y reply salen a nombre de quien tiene la sesión del CLI.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type person struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type file struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type entry struct {
	Seq   int    `json:"seq"`
	With  string `json:"with"`
	ID    string `json:"id"`
	Re    string `json:"re"`
	Dir   string `json:"dir"`
	From  person `json:"from"`
	To    string `json:"to"`
	Text  string `json:"text"`
	Time  string `json:"time"`
	Files []file `json:"files"`
	Via   *struct {
		Name string `json:"name"`
	} `json:"via"`
}

type historyResponse struct {
	Messages []entry           `json:"messages"`
	Last     int               `json:"last"`
	Files    map[string]string `json:"files"`
}

func base() string {
	if b := os.Getenv("CHAT_API"); b != "" {
		return strings.TrimRight(b, "/")
	}
	return "http://127.0.0.1:5185"
}

var client = &http.Client{Timeout: 30 * time.Second}

func call(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, base()+path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("no contesta el servidor del chat (" + base() + "): levantalo con `make chat`")
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return errors.New(e.Error)
		}
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func history(after int) (historyResponse, error) {
	var h historyResponse
	err := call("GET", "/api/history?after="+strconv.Itoa(after), nil, &h)
	return h, err
}

// resolve: la conversación que nombra <quién>. Un grupo es tal cual; una persona, por correo, por su parte antes de la
// @ o por el comienzo de ella, entre las conversaciones que ya existen. Sin coincidencias devuelve lo escrito.
func resolve(who string, known []string) (string, error) {
	w := strings.ToLower(strings.TrimSpace(who))
	if strings.HasPrefix(w, "#") {
		return w, nil
	}
	w = strings.TrimPrefix(w, "@")
	if strings.Contains(w, "@") {
		return w, nil
	}
	var exact, prefix []string
	for _, k := range known {
		if strings.HasPrefix(k, "#") {
			continue
		}
		local := strings.SplitN(k, "@", 2)[0]
		switch {
		case local == w:
			exact = append(exact, k)
		case strings.HasPrefix(local, w):
			prefix = append(prefix, k)
		}
	}
	if len(exact) == 1 {
		return exact[0], nil
	}
	if len(exact) == 0 && len(prefix) == 1 {
		return prefix[0], nil
	}
	if len(exact)+len(prefix) > 1 {
		return "", fmt.Errorf("«%s» puede ser %s: escribí el correo", who, strings.Join(append(exact, prefix...), ", "))
	}
	return w, nil
}

func conversations(h historyResponse) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range h.Messages {
		if m.With != "" && !seen[m.With] {
			seen[m.With] = true
			out = append(out, m.With)
		}
	}
	return out
}

func clock(t string) string {
	tt, err := time.Parse(time.RFC3339Nano, t)
	if err != nil {
		return t
	}
	tt = tt.Local()
	if y, m, d := tt.Date(); y == time.Now().Year() && m == time.Now().Month() && d == time.Now().Day() {
		return tt.Format("15:04")
	}
	return tt.Format("02/01 15:04")
}

func speaker(m entry) string {
	if m.Dir == "out" {
		return "vos"
	}
	name := m.From.Name
	if name == "" {
		name = strings.SplitN(m.From.Email, "@", 2)[0]
	}
	if m.Via != nil && m.Via.Name != "" {
		return m.Via.Name + " (agente de " + strings.Fields(name + " ")[0] + ")"
	}
	return name
}

func printEntry(m entry, files map[string]string) {
	line := fmt.Sprintf("[%s] %s: %s", clock(m.Time), speaker(m), m.Text)
	if m.With != "" && strings.HasPrefix(m.With, "#") {
		line = fmt.Sprintf("[%s] %s · %s: %s", clock(m.Time), m.With, speaker(m), m.Text)
	}
	if m.ID != "" {
		line += "  · id " + m.ID
	}
	if m.Re != "" {
		line += " (contesta a " + m.Re + ")"
	}
	fmt.Println(line)
	for _, f := range m.Files {
		where := "sin bajar: playground get " + f.ID
		if p, ok := files[f.ID]; ok {
			where = p
		}
		fmt.Printf("    📎 %s · %s\n", f.Name, where)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "✗ "+err.Error())
	os.Exit(1)
}

// flagValue saca `--nombre valor` de los argumentos.
func flagValue(args []string, name string) (string, []string) {
	var rest []string
	value := ""
	for i := 0; i < len(args); i++ {
		if args[i] == name && i+1 < len(args) {
			value = args[i+1]
			i++
			continue
		}
		rest = append(rest, args[i])
	}
	return value, rest
}

func hasFlag(args []string, name string) (bool, []string) {
	var rest []string
	found := false
	for _, a := range args {
		if a == name {
			found = true
			continue
		}
		rest = append(rest, a)
	}
	return found, rest
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println(strings.TrimSpace(usage))
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	switch cmd {
	case "inbox":
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		last := map[string]entry{}
		for _, m := range h.Messages {
			last[m.With] = m
		}
		keys := conversations(h)
		sort.Slice(keys, func(i, j int) bool { return last[keys[i]].Time > last[keys[j]].Time })
		for _, k := range keys {
			m := last[k]
			mark := " "
			if m.Dir != "out" {
				mark = "★"
			}
			text := strings.ReplaceAll(m.Text, "\n", " ")
			if r := []rune(text); len(r) > 70 {
				text = string(r[:70]) + "…"
			}
			fmt.Printf("%s %-34s %-11s %s: %s\n", mark, k, clock(m.Time), speaker(m), text)
		}
	case "history":
		n, rest := flagValue(args, "-n")
		if len(rest) != 1 {
			fail(errors.New("uso: bin/chat history <quién> [-n 30]"))
		}
		limit := 30
		if n != "" {
			limit, _ = strconv.Atoi(n)
		}
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		with, err := resolve(rest[0], conversations(h))
		if err != nil {
			fail(err)
		}
		var mine []entry
		for _, m := range h.Messages {
			if m.With == with {
				mine = append(mine, m)
			}
		}
		if len(mine) == 0 {
			fail(fmt.Errorf("no hay mensajes con %s en el historial", with))
		}
		if limit > 0 && len(mine) > limit {
			mine = mine[len(mine)-limit:]
		}
		fmt.Printf("— %s · %d mensaje(s) —\n", with, len(mine))
		for _, m := range mine {
			printEntry(m, h.Files)
		}
	case "follow":
		asJSON, rest := hasFlag(args, "--json")
		if len(rest) == 0 {
			fail(errors.New("uso: bin/chat follow <quién>… [--json]"))
		}
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		want := map[string]bool{}
		for _, w := range rest {
			with, err := resolve(w, conversations(h))
			if err != nil {
				fail(err)
			}
			want[with] = true
		}
		after, down := h.Last, false
		fmt.Fprintf(os.Stderr, "siguiendo %s (Ctrl-C para terminar)\n", strings.Join(rest, ", "))
		for {
			time.Sleep(2 * time.Second)
			next, err := history(after)
			if err != nil {
				if !down {
					fmt.Fprintln(os.Stderr, "⚠ "+err.Error())
					down = true
				}
				continue
			}
			down = false
			for _, m := range next.Messages {
				after = m.Seq
				if !want[m.With] {
					continue
				}
				if asJSON {
					b, _ := json.Marshal(m)
					fmt.Println(string(b))
				} else {
					printEntry(m, next.Files)
				}
			}
		}
	case "send", "reply":
		re, rest := flagValue(args, "--re")
		if len(rest) < 2 {
			fail(fmt.Errorf("uso: bin/chat %s <quién> <texto…>", cmd))
		}
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		with, err := resolve(rest[0], conversations(h))
		if err != nil {
			fail(err)
		}
		if cmd == "reply" && re == "" {
			for i := len(h.Messages) - 1; i >= 0; i-- {
				if m := h.Messages[i]; m.With == with && m.Dir != "out" && m.ID != "" {
					re = m.ID
					break
				}
			}
			if re == "" {
				fail(fmt.Errorf("%s no te mandó nada que se pueda contestar: usá send", with))
			}
		}
		var out struct {
			Delivered int    `json:"delivered"`
			To        string `json:"to"`
			ID        string `json:"id"`
		}
		if err := call("POST", "/api/send", map[string]string{"to": with, "text": strings.Join(rest[1:], " "), "re": re}, &out); err != nil {
			fail(err)
		}
		state := "entregado"
		if out.Delivered == 0 {
			state = "en el buzón (no está conectado)"
		}
		fmt.Printf("✓ a %s · %s · id %s\n", out.To, state, out.ID)
	default:
		fmt.Println(strings.TrimSpace(usage))
		os.Exit(2)
	}
}

const usage = `
bin/chat — el chat del equipo desde la terminal (servidor de make chat, :5185)
  inbox                       las conversaciones, la más reciente primero (★ = te escribieron último)
  history <quién> [-n 30]     la conversación con alguien o con un grupo (#demo), con los ids
  follow <quién>… [--json]    cada mensaje nuevo de esas conversaciones, apenas llega (para un Monitor)
  send <quién> <texto…>       manda un mensaje (--re <id> para contestar uno)
  reply <quién> <texto…>      contesta el último mensaje que te mandó
<quién>: el correo, su parte antes de la @ (o el comienzo: duncan), @duncan, o #grupo.
⚠ send y reply salen a nombre de quien tiene la sesión del CLI.`

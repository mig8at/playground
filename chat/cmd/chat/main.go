// Command chat es bin/chat: el chat del equipo desde la terminal, para una conversación en vivo (una sesión de Claude
// que espera y contesta). Habla con el servidor de `make chat` (:5185), que guarda el historial en disco y manda por el
// CLI `playground`: no es otro cliente del chat.
//
// Los comandos están en `usage`, al final. <who>: el correo, su parte antes de la @ (o el comienzo: `duncan`),
// `@duncan`, o un grupo `#demo`. ⚠ send y reply salen a nombre de quien tiene la sesión del CLI.
//
// CONVENCIÓN: código, comandos, opciones y salida de la terminal en inglés; comentarios en español. Sólo las
// interfaces gráficas van en español.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
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
		return errors.New("the chat server is not answering (" + base() + "): start it with `make chat-service` or `make chat`")
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
		return "", fmt.Errorf("%q is ambiguous (%s): use the email", who, strings.Join(append(exact, prefix...), ", "))
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
		return "you"
	}
	name := m.From.Name
	if name == "" {
		name = strings.SplitN(m.From.Email, "@", 2)[0]
	}
	if m.Via != nil && m.Via.Name != "" {
		return m.Via.Name + " (" + strings.Fields(name + " ")[0] + "'s agent)"
	}
	return name
}

var imageName = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|webp)$`)

// pendingImages: las imágenes del mensaje que el chat todavía no bajó (las baja solo, a los pocos segundos de llegar).
func pendingImages(m entry, files map[string]string) bool {
	for _, f := range m.Files {
		if _, ok := files[f.ID]; !ok && imageName.MatchString(f.Name) {
			return true
		}
	}
	return false
}

// printEntry: una cabecera por mensaje y, si el texto tiene varias líneas, las siguientes sangradas con «│», para que
// quien lea la salida no confunda una línea del cuerpo con otro mensaje.
func printEntry(m entry, files map[string]string) {
	lines := strings.Split(strings.TrimRight(m.Text, "\n"), "\n")
	head := fmt.Sprintf("[%s] %s: %s", clock(m.Time), speaker(m), lines[0])
	if m.With != "" && strings.HasPrefix(m.With, "#") {
		head = fmt.Sprintf("[%s] %s · %s: %s", clock(m.Time), m.With, speaker(m), lines[0])
	}
	line := head
	if m.ID != "" {
		line += "  · id " + m.ID
	}
	if m.Re != "" {
		line += " (re " + m.Re + ")"
	}
	fmt.Println(line)
	for _, l := range lines[1:] {
		fmt.Println("    │ " + l)
	}
	for _, f := range m.Files {
		where := "not downloaded: playground get " + f.ID
		if imageName.MatchString(f.Name) {
			// Una imagen la baja el chat solo: `playground get` se la quitaría (el home la borra al entregarla).
			where = "the chat is downloading it: bin/chat history " + m.With + " gives the path"
		}
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

// noUnknownFlags: lo que queda después de sacar las opciones conocidas no puede empezar con «-»; si no, `follow --algo`
// se quedaría siguiendo a alguien llamado «--algo».
func noUnknownFlags(rest []string) {
	for _, a := range rest {
		if strings.HasPrefix(a, "-") {
			fmt.Fprintf(os.Stderr, "✗ unknown option %s\n\n%s\n", a, strings.TrimSpace(usage))
			os.Exit(2)
		}
	}
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
	if cmd == "help" || cmd == "-h" || cmd == "--help" {
		fmt.Println(strings.TrimSpace(usage))
		return
	}
	for _, a := range args {
		if a == "-h" || a == "--help" {
			fmt.Println(strings.TrimSpace(usage))
			return
		}
	}
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
		noUnknownFlags(rest)
		if len(rest) != 1 {
			fail(errors.New("usage: bin/chat history <who> [-n 30]"))
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
			fail(fmt.Errorf("no messages with %s in the history", with))
		}
		if limit > 0 && len(mine) > limit {
			mine = mine[len(mine)-limit:]
		}
		fmt.Printf("— %s · %d message(s) —\n", with, len(mine))
		for _, m := range mine {
			printEntry(m, h.Files)
		}
	case "follow":
		asJSON, rest := hasFlag(args, "--json")
		theirs, rest := hasFlag(rest, "--theirs")
		noUnknownFlags(rest)
		if len(rest) == 0 {
			fail(errors.New("usage: bin/chat follow <who>… [--json] [--theirs]"))
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
		fmt.Fprintf(os.Stderr, "following %s (Ctrl-C to stop)\n", strings.Join(rest, ", "))
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
			// Las imágenes que trae: el chat las baja a los pocos segundos. Se espera hasta 20 s para dar su ruta local.
			for wait := 0; wait < 20; wait++ {
				pending := false
				for _, m := range next.Messages {
					pending = pending || (want[m.With] && m.Dir != "out" && pendingImages(m, next.Files))
				}
				if !pending {
					break
				}
				time.Sleep(time.Second)
				if fresh, err := history(after); err == nil {
					next.Files = fresh.Files
				}
			}
			for _, m := range next.Messages {
				after = m.Seq
				if !want[m.With] || (theirs && m.Dir == "out") {
					continue
				}
				if asJSON {
					// Una línea por mensaje, con quién lo escribió (`dir`, `from`) y la ruta de cada adjunto ya bajado.
					type jsonFile struct {
						file
						Path string `json:"path,omitempty"`
					}
					out := struct {
						entry
						Files []jsonFile `json:"files,omitempty"`
					}{entry: m}
					for _, f := range m.Files {
						out.Files = append(out.Files, jsonFile{file: f, Path: next.Files[f.ID]})
					}
					b, _ := json.Marshal(out)
					fmt.Println(string(b))
				} else {
					printEntry(m, next.Files)
				}
			}
		}
	case "send", "reply":
		re, rest := flagValue(args, "--re")
		if len(rest) > 0 {
			noUnknownFlags(rest[:1])
		}
		if len(rest) < 2 {
			fail(fmt.Errorf("usage: bin/chat %s <who> <text…>", cmd))
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
				fail(fmt.Errorf("%s has sent you nothing to reply to: use send", with))
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
		state := "delivered"
		if out.Delivered == 0 {
			state = "queued (not connected)"
		}
		fmt.Printf("✓ to %s · %s · id %s\n", out.To, state, out.ID)
	default:
		fmt.Println(strings.TrimSpace(usage))
		os.Exit(2)
	}
}

const usage = `
bin/chat — the team chat from the terminal (the make chat server, :5185)
  inbox                          conversations, most recent first (★ = they wrote last)
  history <who> [-n 30]          the conversation with someone or a group (#demo), with message ids
  follow <who>… [--json] [--theirs]
                                 each new message in those conversations as it arrives (for a Monitor).
                                 --json: one per line, with dir/from and each attachment's local path
                                 --theirs: leave out your own messages
  send <who> <text…> [--re <id>] send a message (--re replies to a given one)
  reply <who> <text…>            reply to the last message they sent you
<who>: the email, its part before the @ (or its start: duncan), @duncan, or #group.
⚠ send and reply go out under the CLI session's name.`

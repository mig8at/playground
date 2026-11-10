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
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
// flagValues saca TODAS las apariciones de una opción con valor (`--file a --file b`).
func flagValues(args []string, name string) ([]string, []string) {
	var values, rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == name && i+1 < len(args) {
			values = append(values, args[i+1])
			i++
			continue
		}
		rest = append(rest, args[i])
	}
	return values, rest
}

// upload sube un archivo para `to` por el servidor del chat (/api/upload) y devuelve su id.
func upload(to, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() {
		return "", errors.New("is not a regular file")
	}
	q := url.Values{"to": {to}, "name": {filepath.Base(path)}}
	req, _ := http.NewRequest("POST", base()+"/api/upload?"+q.Encode(), f)
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req.Header.Set("Content-Type", contentType)
	res, err := (&http.Client{Timeout: 4 * time.Minute}).Do(req)
	if err != nil {
		return "", errors.New("the chat server is not answering (" + base() + ")")
	}
	defer res.Body.Close()
	var out struct {
		ID    string `json:"id"`
		Error string `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode >= 300 || out.ID == "" {
		if out.Error != "" {
			return "", errors.New(out.Error)
		}
		return "", fmt.Errorf("upload: HTTP %d", res.StatusCode)
	}
	return out.ID, nil
}

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

// printJSON: una salida para un agente (o jq): JSON en una línea.
func printJSON(v any) {
	b, _ := json.Marshal(v)
	fmt.Println(string(b))
}

// withPaths: el mensaje con la ruta local de cada adjunto ya bajado, para --json.
type jsonFile struct {
	file
	Path string `json:"path,omitempty"`
}

type jsonEntry struct {
	entry
	Files []jsonFile `json:"files,omitempty"`
}

func withPaths(m entry, files map[string]string) jsonEntry {
	out := jsonEntry{entry: m}
	for _, f := range m.Files {
		out.Files = append(out.Files, jsonFile{file: f, Path: files[f.ID]})
	}
	return out
}

// parseWait: «5m», «90s» o un número de segundos.
func parseWait(v string) (time.Duration, error) {
	if v == "" {
		return 0, nil
	}
	if n, err := strconv.Atoi(v); err == nil {
		return time.Duration(n) * time.Second, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("--wait %q: use 90s, 5m or a number of seconds", v)
	}
	return d, nil
}

// waitFor espera, desde la posición `after` del historial, el primer mensaje que cumple `match`. Devuelve también los
// adjuntos ya bajados. Sin nada al vencer `limit`, ok es false.
func waitFor(after int, limit time.Duration, match func(entry) bool) (entry, map[string]string, bool) {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		time.Sleep(2 * time.Second)
		next, err := history(after)
		if err != nil {
			continue
		}
		for _, m := range next.Messages {
			after = m.Seq
			if match(m) {
				// Si trae imágenes, el chat las baja a los pocos segundos: se espera un poco para dar la ruta.
				for i := 0; i < 15 && pendingImages(m, next.Files); i++ {
					time.Sleep(time.Second)
					if fresh, err := history(m.Seq - 1); err == nil {
						next.Files = fresh.Files
					}
				}
				return m, next.Files, true
			}
		}
	}
	return entry{}, nil, false
}

// markRead: la conversación queda leída hasta lo último que tiene (lo comparten la app y bin/chat).
func markRead(with string) error {
	return call("POST", "/api/reads", map[string]any{"key": with}, nil)
}

var slowClient = &http.Client{Timeout: 100 * time.Second}

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
		unreadOnly, rest := hasFlag(args, "--unread")
		asJSON, rest := hasFlag(rest, "--json")
		noUnknownFlags(rest)
		var box struct {
			Conversations []struct {
				Key      string `json:"key"`
				Group    bool   `json:"group"`
				Last     entry  `json:"last"`
				Unread   int    `json:"unread"`
				Mentions int    `json:"mentions"`
			} `json:"conversations"`
		}
		path := "/api/inbox"
		if unreadOnly {
			path += "?unread=1"
		}
		if err := call("GET", path, nil, &box); err != nil {
			fail(err)
		}
		if asJSON {
			printJSON(box.Conversations)
			return
		}
		if len(box.Conversations) == 0 && unreadOnly {
			fmt.Println("nothing unread")
		}
		for _, c := range box.Conversations {
			// ● n = sin leer · @n = te mencionaron · ★ = escribieron último (y ya lo leíste)
			mark := "    "
			switch {
			case c.Mentions > 0:
				mark = fmt.Sprintf("@%-3d", c.Mentions)
			case c.Unread > 0:
				mark = fmt.Sprintf("●%-3d", c.Unread)
			case c.Last.Dir != "out":
				mark = "★   "
			}
			text := strings.ReplaceAll(c.Last.Text, "\n", " ")
			if r := []rune(text); len(r) > 70 {
				text = string(r[:70]) + "…"
			}
			fmt.Printf("%s %-34s %-11s %s: %s\n", mark, c.Key, clock(c.Last.Time), speaker(c.Last), text)
		}
	case "mentions":
		all, rest := hasFlag(args, "--all")
		asJSON, rest := hasFlag(rest, "--json")
		noUnknownFlags(rest)
		var out struct {
			Mentions []entry `json:"mentions"`
			Me       string  `json:"me"`
		}
		path := "/api/mentions"
		if all {
			path += "?all=1"
		}
		if err := call("GET", path, nil, &out); err != nil {
			fail(err)
		}
		if asJSON {
			printJSON(out.Mentions)
			return
		}
		if len(out.Mentions) == 0 {
			fmt.Printf("no unread mentions of @%s\n", out.Me)
			return
		}
		for _, m := range out.Mentions {
			printEntry(m, nil)
		}
	case "read":
		noUnknownFlags(args)
		if len(args) == 0 {
			fail(errors.New("usage: bin/chat read <who>…"))
		}
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		for _, w := range args {
			with, err := resolve(w, conversations(h))
			if err != nil {
				fail(err)
			}
			if err := markRead(with); err != nil {
				fail(err)
			}
			fmt.Printf("✓ %s read\n", with)
		}
	case "who":
		asJSON, rest := hasFlag(args, "--json")
		noUnknownFlags(rest)
		var online struct {
			Online []person `json:"online"`
		}
		var groups struct {
			Groups []struct {
				ID      string   `json:"id"`
				Owner   string   `json:"owner"`
				Members []string `json:"members"`
			} `json:"groups"`
		}
		if err := call("GET", "/api/online", nil, &online); err != nil {
			fail(err)
		}
		if err := call("GET", "/api/groups", nil, &groups); err != nil {
			fail(err)
		}
		on := map[string]bool{}
		names := map[string]string{}
		for _, p := range online.Online {
			on[strings.ToLower(p.Email)] = true
			names[strings.ToLower(p.Email)] = p.Name
		}
		if h, err := history(-1); err == nil {
			for _, m := range h.Messages {
				if m.From.Name != "" {
					names[strings.ToLower(m.From.Email)] = m.From.Name
				}
			}
		}
		// Un miembro como lo nombra una mención: `@usuario` o `@usuario/agente`.
		type member struct {
			Handle string `json:"handle"`
			Email  string `json:"email"`
			Name   string `json:"name,omitempty"`
			Agent  string `json:"agent,omitempty"`
			Online bool   `json:"online"`
		}
		memberOf := func(raw string) member {
			email, agent, _ := strings.Cut(strings.ToLower(raw), "/")
			handle := strings.SplitN(email, "@", 2)[0]
			if agent != "" {
				handle += "/" + agent
			}
			return member{Handle: "@" + handle, Email: email, Name: names[email], Agent: agent, Online: on[email]}
		}
		if len(rest) == 1 {
			id := strings.TrimPrefix(strings.ToLower(rest[0]), "#")
			for _, g := range groups.Groups {
				if strings.ToLower(g.ID) != id {
					continue
				}
				var ms []member
				for _, raw := range g.Members {
					ms = append(ms, memberOf(raw))
				}
				if asJSON {
					printJSON(map[string]any{"group": "#" + g.ID, "members": ms})
					return
				}
				fmt.Printf("#%s · %d member(s) · mention with @handle, or @todos for everyone\n", g.ID, len(ms))
				for _, m := range ms {
					dot := " "
					if m.Online {
						dot = "●"
					}
					fmt.Printf("  %s %-32s %s\n", dot, m.Handle, m.Name)
				}
				return
			}
			fail(fmt.Errorf("you are not in #%s (bin/chat who lists your groups)", id))
		}
		if asJSON {
			var people []member
			for _, p := range online.Online {
				people = append(people, memberOf(p.Email))
			}
			gs := []map[string]any{}
			for _, g := range groups.Groups {
				gs = append(gs, map[string]any{"group": "#" + g.ID, "members": len(g.Members)})
			}
			printJSON(map[string]any{"online": people, "groups": gs})
			return
		}
		fmt.Println("online")
		for _, p := range online.Online {
			m := memberOf(p.Email)
			fmt.Printf("  ● %-32s %s\n", m.Handle, m.Name)
		}
		fmt.Println("groups (bin/chat who #group lists its members)")
		for _, g := range groups.Groups {
			fmt.Printf("  #%-31s %d member(s)\n", g.ID, len(g.Members))
		}
	case "history":
		n, rest := flagValue(args, "-n")
		asJSON, rest := hasFlag(rest, "--json")
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
		if asJSON {
			out := make([]jsonEntry, 0, len(mine))
			for _, m := range mine {
				out = append(out, withPaths(m, h.Files))
			}
			printJSON(out)
			return
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
					printJSON(withPaths(m, next.Files))
				} else {
					printEntry(m, next.Files)
				}
			}
		}
	case "send", "reply":
		re, rest := flagValue(args, "--re")
		files, rest := flagValues(rest, "--file")
		as, rest := flagValue(rest, "--as")
		waitArg, rest := flagValue(rest, "--wait")
		asJSON, rest := hasFlag(rest, "--json")
		if as == "" {
			as = os.Getenv("CHAT_AS") // el agente que está usando esta terminal, para no repetirlo en cada envío
		}
		wait, err := parseWait(waitArg)
		if err != nil {
			fail(err)
		}
		if len(rest) > 0 {
			noUnknownFlags(rest[:1])
		}
		if len(rest) < 2 && !(len(rest) == 1 && len(files) > 0) {
			fail(fmt.Errorf("usage: bin/chat %s <who> <text…> [--file <path>]…", cmd))
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
		// Los adjuntos suben por el servidor del chat (no por `playground send --file`): así queda una copia en su caché
		// y el mensaje enviado los muestra en la conversación, como los que llegan.
		ids := []string{}
		for _, path := range files {
			id, err := upload(with, path)
			if err != nil {
				fail(fmt.Errorf("%s: %w", path, err))
			}
			ids = append(ids, id)
		}
		if err := call("POST", "/api/send", map[string]any{"to": with, "text": strings.Join(rest[1:], " "), "re": re, "files": ids, "as": as}, &out); err != nil {
			fail(err)
		}
		state := "delivered"
		if out.Delivered == 0 {
			state = "queued (not connected)"
		}
		who := ""
		if as != "" {
			who = " · as " + as
		}
		if !asJSON {
			fmt.Printf("✓ to %s · %s%s · id %s\n", out.To, state, who, out.ID)
		}
		if wait == 0 {
			if asJSON {
				printJSON(map[string]any{"sent": out})
			}
			return
		}
		// --wait: la primera respuesta de esa conversación (de otro, no tuya), o nada al vencer el tiempo.
		if !asJSON {
			fmt.Fprintf(os.Stderr, "waiting up to %s for a reply…\n", wait)
		}
		reply, got, ok := waitFor(h.Last, wait, func(m entry) bool { return m.With == with && m.Dir != "out" })
		if !ok {
			if asJSON {
				printJSON(map[string]any{"sent": out, "reply": nil})
			} else {
				fmt.Printf("… no reply within %s\n", wait)
			}
			os.Exit(3)
		}
		_ = markRead(with)
		if asJSON {
			printJSON(map[string]any{"sent": out, "reply": withPaths(reply, got)})
			return
		}
		printEntry(reply, got)
	case "ask":
		waitArg, rest := flagValue(args, "--wait")
		asJSON, rest := hasFlag(rest, "--json")
		if len(rest) > 0 {
			noUnknownFlags(rest[:1])
		}
		target := ""
		if len(rest) > 0 {
			target = strings.TrimPrefix(rest[0], "@")
		}
		owner, agent, ok := strings.Cut(target, "/")
		if !ok || owner == "" || agent == "" || len(rest) < 2 {
			fail(errors.New("usage: bin/chat ask <who>/<agent> <question…> [--wait 2m] [--json]"))
		}
		wait, err := parseWait(waitArg)
		if err != nil {
			fail(err)
		}
		h, err := history(-1)
		if err != nil {
			fail(err)
		}
		var res struct {
			Answer  string `json:"answer"`
			Pending bool   `json:"pending"`
			ID      string `json:"id"`
		}
		body, _ := json.Marshal(map[string]any{"to": owner, "agent": agent, "text": strings.Join(rest[1:], " ")})
		req, _ := http.NewRequest("POST", base()+"/api/ask", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := slowClient.Do(req)
		if err != nil {
			fail(errors.New("the chat server is not answering (" + base() + ")"))
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			var e struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal(data, &e)
			fail(fmt.Errorf("ask: %s", e.Error))
		}
		_ = json.Unmarshal(data, &res)
		if !res.Pending {
			if asJSON {
				printJSON(map[string]any{"id": res.ID, "answer": res.Answer})
			} else {
				fmt.Println(res.Answer)
			}
			return
		}
		if wait == 0 {
			if asJSON {
				printJSON(map[string]any{"id": res.ID, "pending": true})
			} else {
				fmt.Printf("… %s/%s is taking long: id %s (the answer arrives later; --wait 2m waits for it)\n", owner, agent, res.ID)
			}
			os.Exit(3)
		}
		answer, files, ok := waitFor(h.Last, wait, func(m entry) bool { return m.Re == res.ID && m.Dir != "out" })
		if !ok {
			if asJSON {
				printJSON(map[string]any{"id": res.ID, "pending": true})
			} else {
				fmt.Printf("… no answer within %s (id %s)\n", wait, res.ID)
			}
			os.Exit(3)
		}
		if asJSON {
			printJSON(map[string]any{"id": res.ID, "answer": answer.Text, "message": withPaths(answer, files)})
			return
		}
		fmt.Println(answer.Text)
	default:
		fmt.Println(strings.TrimSpace(usage))
		os.Exit(2)
	}
}

const usage = `
bin/chat — the team chat from the terminal (the make chat server, :5185). Every command takes --json.
 read
  inbox [--unread]               conversations, most recent first (●n unread · @n mentions you · ★ they wrote last)
  mentions [--all]               group messages that mention you or your agents (unread ones, unless --all)
  history <who> [-n 30]          the conversation with someone or a group, with message ids
  who [#group]                   who is online and your groups; with a group, its members as @handles
  read <who>…                    mark as read (also happens when you send or reply there)
 talk
  send <who> <text…> [--re <id>] [--file <path>]… [--as <agent>] [--wait 5m]
                                 send a message. --file attaches (several allowed). --as sends it as one of
                                 your agents. --wait blocks until the first reply there and prints it
                                 (exit 3 if nobody answers in time)
  reply <who> <text…> [same options]   reply to the last message they sent you
  ask <who>/<agent> <question…> [--wait 2m]   ask someone's agent; --wait also waits for a late answer
 watch
  follow <who>… [--theirs]       each new message as it arrives (for a Monitor); --theirs leaves out yours
<who>: the email, its part before the @ (or its start: duncan), @duncan, or #group. In a group, mention
with @handle (bin/chat who #group) or @todos.
⚠ send and reply go out under the CLI session's name, unless --as (or CHAT_AS=<agent>) says which agent.`

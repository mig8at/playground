package main

// LOS AVISOS: cuando una señal pasa a alerta (sostenida, como la muestra la interfaz), un aviso de macOS que al tocarlo
// abre Sentinel en esa señal. UN aviso por episodio: el episodio sigue abierto mientras la señal no vuelva a lo normal
// durante `clearMinutes` (así una que va y viene entre alerta y «para mirar» no avisa cada 5 minutos), y al cerrarse
// avisa que volvió (sin sonido). También avisa una vez si producción no se puede leer durante `staleMinutes` (la VPN
// caída): un vigía mudo es peor que uno que no existe.
//
// El estado de cada episodio se guarda en `sentinel/.data/alerts.json`, para que un reinicio no repita avisos; cada aviso
// mandado queda en `sentinel/.data/notices.jsonl` (lo que se avisó y cuándo). Sólo avisa la API que escucha.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// NotifyRules: cuándo avisar (en `rules.json`, bajo `notify`).
type NotifyRules struct {
	Level        string `json:"level"`        // desde qué nivel se avisa: «alert» (por defecto) o «warn»; «off» apaga los avisos
	ClearMinutes int    `json:"clearMinutes"` // cuánto tiempo normal cierra un episodio
	StaleMinutes int    `json:"staleMinutes"` // cuánto tiempo sin poder leer producción se avisa
	Recovered    bool   `json:"recovered"`    // avisar también cuando un episodio avisado se cierra
	// Merchants: de qué comercios se avisa. «following» (por defecto): sólo de los que se siguen (following.go); «all»:
	// de todos. Entidades, servicios y la cola avisan siempre.
	Merchants string `json:"merchants"`
}

// Notice es un aviso mandado.
type Notice struct {
	At     string `json:"at"`
	Signal Signal `json:"signal"`
	Name   string `json:"name"`
	Level  string `json:"level"` // alert · warn · recovered · stale
	Text   string `json:"text"`
	Sent   bool   `json:"sent"` // si macOS lo aceptó
}

// episode: una señal fuera de lo normal, desde que entró hasta que volvió.
type episode struct {
	Since      string `json:"since"`
	Level      string `json:"level"`      // el peor nivel del episodio
	Notified   string `json:"notified"`   // el nivel que ya se avisó («» si ninguno)
	NormalFrom string `json:"normalFrom"` // desde cuándo volvió a lo normal, si volvió
	Name       string `json:"name"`
}

type notifier struct {
	mu       sync.Mutex
	dir      string
	Episodes map[Signal]*episode `json:"episodes"`
	// FailingSince: desde cuándo las pasadas fallan; StaleNotified, si ya se avisó.
	FailingSince  string `json:"failingSince"`
	StaleNotified bool   `json:"staleNotified"`
	notices       []Notice
	dry           bool // la prueba contra la historia: no manda ni escribe nada
	// follows dice si un comercio se sigue; sin él (nil), se avisa de todos.
	follows func(Signal) bool
}

// silenced: un comercio que no se sigue no avisa. Su episodio se lleva igual (se ve en «Para mirar»): si se empieza a
// seguir en medio de uno, avisa en la próxima pasada.
func (n *notifier) silenced(sig Signal, rules NotifyRules) bool {
	return rules.Merchants != "all" && n.follows != nil && strings.HasPrefix(string(sig), "merchant:") && !n.follows(sig)
}

func openNotifier(dir string) *notifier {
	n := &notifier{dir: dir, Episodes: map[Signal]*episode{}}
	if raw, err := os.ReadFile(filepath.Join(dir, "alerts.json")); err == nil {
		_ = json.Unmarshal(raw, n)
		if n.Episodes == nil {
			n.Episodes = map[Signal]*episode{}
		}
	}
	if f, err := os.Open(filepath.Join(dir, "notices.jsonl")); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			var x Notice
			if json.Unmarshal(sc.Bytes(), &x) == nil {
				n.notices = append(n.notices, x)
			}
		}
		f.Close()
	}
	return n
}

func (n *notifier) save() {
	if n.dry {
		return
	}
	raw, err := json.MarshalIndent(n, "", "  ")
	if err != nil {
		return
	}
	tmp := filepath.Join(n.dir, "alerts.json.tmp")
	if os.WriteFile(tmp, raw, 0o644) == nil {
		_ = os.Rename(tmp, filepath.Join(n.dir, "alerts.json"))
	}
}

func rank(level string) int {
	switch level {
	case "alert":
		return levelAlert
	case "warn":
		return levelWarn
	}
	return levelOK
}

// observe: el veredicto de una pasada. Abre, sostiene y cierra episodios, y avisa lo que corresponde.
func (n *notifier) observe(o *Overview, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	rules := o.Rules.Notify
	threshold := rank(rules.Level)
	if rules.Level == "off" || threshold < levelWarn {
		threshold = 99
	}
	if n.FailingSince != "" && n.StaleNotified {
		n.send(Notice{Signal: "sentinel", Name: "Sentinel", Level: "recovered", Text: "Volvió a leer producción."}, now, "", false)
	}
	n.FailingSince, n.StaleNotified = "", false
	all := append([]Subject{o.All}, o.Services...)
	all = append(all, o.Lenders...)
	all = append(all, o.Merchants...)
	all = append(all, o.Liveness...)
	all = append(all, o.LenderErrors...)
	seen := map[Signal]bool{}
	for _, subj := range all {
		seen[subj.Signal] = true
		lvl := rank(subj.State)
		ep := n.Episodes[subj.Signal]
		if lvl >= levelWarn {
			if ep == nil {
				ep = &episode{Since: now.Format(time.RFC3339), Name: subj.Name}
				n.Episodes[subj.Signal] = ep
			}
			ep.NormalFrom = ""
			if lvl > rank(ep.Level) {
				ep.Level = subj.State
			}
			// Se avisa al llegar al umbral, y otra vez sólo si empeora (de «para mirar» avisado a alerta).
			if lvl >= threshold && lvl > rank(ep.Notified) && !n.silenced(subj.Signal, rules) {
				ep.Notified = subj.State
				title := "Sentinel · " + map[string]string{"alert": "alerta", "warn": "para mirar"}[subj.State]
				n.send(Notice{Signal: subj.Signal, Name: subj.Name, Level: subj.State, Text: subj.Why}, now, title, lvl == levelAlert)
			}
			continue
		}
		if ep == nil {
			continue
		}
		// «Poco volumen» no cierra un episodio: no dice que volvió a lo normal, sólo que a esta hora no hay con qué
		// comparar. Un servicio callado pasaba a «poco volumen» de noche, el episodio se cerraba y a la mañana avisaba
		// otra vez (4 avisos por día por servicio).
		if subj.State == "quiet" {
			continue
		}
		if ep.NormalFrom == "" {
			ep.NormalFrom = now.Format(time.RFC3339)
		}
		from, _ := time.Parse(time.RFC3339, ep.NormalFrom)
		if now.Sub(from) >= time.Duration(rules.ClearMinutes)*time.Minute {
			if ep.Notified != "" && rules.Recovered {
				n.send(Notice{Signal: subj.Signal, Name: subj.Name, Level: "recovered", Text: "Volvió a lo normal: " + subj.Why}, now, "Sentinel · volvió a lo normal", false)
			}
			delete(n.Episodes, subj.Signal)
		}
	}
	for sig := range n.Episodes {
		if !seen[sig] { // la señal ya no aparece (una entidad que dejó de existir): se olvida
			delete(n.Episodes, sig)
		}
	}
	n.save()
}

// failed: una pasada que no pudo leer producción. Si dura `staleMinutes`, un aviso (una vez).
func (n *notifier) failed(err error, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.FailingSince == "" {
		n.FailingSince = now.Format(time.RFC3339)
	}
	since, _ := time.Parse(time.RFC3339, n.FailingSince)
	stale := 30
	if r, rerr := loadRulesQuiet(); rerr == nil && r.Notify.StaleMinutes > 0 {
		stale = r.Notify.StaleMinutes
	}
	if !n.StaleNotified && now.Sub(since) >= time.Duration(stale)*time.Minute {
		n.StaleNotified = true
		text := fmt.Sprintf("Hace %d min que no puede leer producción (¿la VPN?): %s", int(now.Sub(since).Minutes()), err)
		n.send(Notice{Signal: "sentinel", Name: "Sentinel", Level: "stale", Text: text}, now, "Sentinel no está mirando", true)
	}
	n.save()
}

// send manda el aviso y lo anota. Con n.mu tomado.
func (n *notifier) send(x Notice, now time.Time, title string, sound bool) {
	x.At = now.Format(time.RFC3339)
	if n.dry {
		n.notices = append(n.notices, x)
		return
	}
	if title == "" {
		title = "Sentinel"
	}
	body := x.Name + ": " + x.Text
	if err := macNotice(title, body, routeOf(x.Signal), sound); err != nil {
		log.Printf("sentinel: el aviso no salió: %v", err)
	} else {
		x.Sent = true
	}
	log.Printf("sentinel: aviso %s · %s · %s", x.Level, x.Name, x.Text)
	n.notices = append(n.notices, x)
	if f, err := os.OpenFile(filepath.Join(n.dir, "notices.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		raw, _ := json.Marshal(x)
		f.Write(append(raw, '\n'))
		f.Close()
	}
}

// recent: los últimos avisos, el más nuevo primero.
func (n *notifier) recent(limit int) []Notice {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := []Notice{}
	for i := len(n.notices) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, n.notices[i])
	}
	return out
}

// routeOf: la ruta de la interfaz para una señal (`#/lender/6`, `#/service/legacy-backend`, `#/queue`).
func routeOf(sig Signal) string {
	kind, key, ok := strings.Cut(sig, ":")
	switch {
	case !ok || kind == "all":
		return ""
	case kind == "queue":
		return "#/queue"
	}
	return "#/" + kind + "/" + url.PathEscape(key)
}

// rulesPath la fija main (la carpeta del playground); failed la usa para leer `staleMinutes`.
var rulesPath string

func loadRulesQuiet() (Rules, error) { return loadRules(rulesPath) }

// macNotice: el aviso de macOS. Va por el avisador del chat («Chat del playground», que ya tiene permiso de avisos y
// abre un enlace `cockpit://` al tocarlo: Cockpit trae Sentinel al frente en esa ruta); sin él, por osascript.
func macNotice(title, body, route string, sound bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat del playground.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		args := []string{"--title", title, "--body", body, "--url", "cockpit://sentinel/" + route, "--group", "creditop-sentinel-" + route}
		if sound {
			args = append(args, "--sound")
		}
		if out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("avisador: %v %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	q := func(s string) string { return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"` }
	script := "display notification " + q(body) + " with title " + q(title)
	if sound {
		script += ` sound name "Glass"`
	}
	return exec.CommandContext(ctx, "osascript", "-e", script).Run()
}

// replayNotices: qué avisos habrían salido en los últimos `days` días, con una pasada cada `stepMinutes`. No manda nada:
// es la vara antes de cambiar `notify` en rules.json.
func replayNotices(e evaluator, days int, now time.Time, follows func(Signal) bool) []Notice {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, follows: follows}
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -days)
	step := time.Duration(e.rules.StepMinutes) * time.Minute
	for t := start; t.Before(now); t = t.Add(step) {
		o := &Overview{Rules: e.rules}
		for sig := range e.data {
			ev, level := e.sustained(sig, t)
			o.Lenders = append(o.Lenders, Subject{Signal: sig, Name: sig, State: levelName(level), Why: ev.Why})
		}
		n.observe(o, t)
	}
	return n.notices
}

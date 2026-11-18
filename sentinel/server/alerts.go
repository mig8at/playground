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
	"runtime"
	"sort"
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
	// Via: por dónde salió («avisador del chat», «osascript», «notify-send»); si salió por el respaldo, dice por qué.
	Via string `json:"via,omitempty"`
}

// Unsent: los avisos que no salieron y esperan la próxima pasada para salir juntos.
type Unsent struct {
	Count int    `json:"count"`
	Since string `json:"since"` // el más viejo
	Error string `json:"error"` // el último error del avisador
}

// episode: una señal fuera de lo normal, desde que entró hasta que volvió.
type episode struct {
	Since      string `json:"since"`
	Level      string `json:"level"`      // el peor nivel del episodio
	Notified   string `json:"notified"`   // el nivel que ya se avisó («» si ninguno)
	NormalFrom string `json:"normalFrom"` // desde cuándo volvió a lo normal, si volvió
	Name       string `json:"name"`
	// Acked: el nivel que Miguel reconoció («ya lo sé»); «» si no. Un episodio reconocido sale de «Pide atención» a
	// «Conocidos» hasta que se cierra o EMPEORA (pasa a un nivel mayor que el reconocido).
	Acked   string `json:"acked,omitempty"`
	AckedAt string `json:"ackedAt,omitempty"`
}

// Gap: un tramo en que Sentinel no miró (el Mac dormido, la VPN caída, la API apagada). Se mide por reloj: lo guardado
// llegaba hasta From y la pasada siguiente fue a las To.
type Gap struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// GapAlert: una señal que pasó a alerta mientras Sentinel no miraba.
type GapAlert struct {
	Signal Signal
	Name   string
	At     time.Time
}

type notifier struct {
	mu       sync.Mutex
	dir      string
	Episodes map[Signal]*episode `json:"episodes"`
	// FailingSince: desde cuándo las pasadas fallan; StaleNotified, si ya se avisó.
	FailingSince  string `json:"failingSince"`
	StaleNotified bool   `json:"staleNotified"`
	// Pending: los avisos que no salieron (ni por el avisador ni por el respaldo). Cada pasada los reintenta en UNO
	// solo; LastError, el último error del avisador. Un aviso perdido sin que nadie lo sepa fue lo que dejó a Sentinel
	// mudo del 14 al 18/11/2026: macOS le quitó el permiso al avisador del chat.
	Pending   []Notice `json:"pending,omitempty"`
	LastError string   `json:"lastError,omitempty"`
	notices   []Notice
	dry       bool // la prueba contra la historia: no manda ni escribe nada
	// deliver manda un aviso; nil es el del sistema (systemNotice). Los tests lo reemplazan.
	deliver func(title, body, route string, sound bool) (string, error)
	// follows dice si un comercio se sigue; sin él (nil), se avisa de todos.
	follows func(Signal) bool
}

// silenced: un comercio que no se sigue no avisa. Su episodio se lleva igual (se ve en «Para mirar»): si se empieza a
// seguir en medio de uno, avisa en la próxima pasada.
func (n *notifier) silenced(sig Signal, rules NotifyRules) bool {
	if rules.Merchants == "all" || n.follows == nil {
		return false
	}
	if strings.HasPrefix(sig, "merchant:") {
		return !n.follows(sig)
	}
	// Las pantallas de un comercio (`step:otp@94`) avisan como el comercio: sólo si se sigue.
	if _, m, ok := strings.Cut(sig, "@"); ok && strings.HasPrefix(sig, "step:") {
		return !n.follows("merchant:" + m)
	}
	return false
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
	n.flush(now)
	if n.FailingSince != "" && n.StaleNotified {
		n.send(Notice{Signal: "sentinel", Name: "Sentinel", Level: "recovered", Text: "Volvió a leer producción."}, now, "", false)
	}
	n.FailingSince, n.StaleNotified = "", false
	all := append([]Subject{o.All}, o.Services...)
	all = append(all, o.Lenders...)
	all = append(all, o.Merchants...)
	all = append(all, o.Liveness...)
	all = append(all, o.LenderErrors...)
	all = append(all, o.Steps...)
	all = append(all, o.Providers...)
	all = append(all, o.NewMessages...)
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
			if ep.Acked != "" && lvl > rank(ep.Acked) { // empeoró: lo reconocido ya no alcanza
				ep.Acked, ep.AckedAt = "", ""
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
		// Un servicio que no escribe nada tampoco «volvió»: aunque esta hora no dé para alerta (los días comparables
		// también tuvieron un hueco), el episodio sigue abierto hasta que vuelva a escribir.
		if strings.HasPrefix(subj.Signal, "logs:") && subj.Now.Total == 0 {
			continue
		}
		if ep.NormalFrom == "" {
			ep.NormalFrom = now.Format(time.RFC3339)
		}
		from, _ := time.Parse(time.RFC3339, ep.NormalFrom)
		if now.Sub(from) >= time.Duration(rules.ClearMinutes)*time.Minute {
			// Un mensaje nuevo no «vuelve a lo normal»: deja de ser nuevo (se va de la lista y el episodio se olvida).
			if ep.Notified != "" && rules.Recovered && !strings.HasPrefix(subj.Signal, "newmsg:") {
				why, _, _ := strings.Cut(subj.Why, afterDeployNote)
				n.send(Notice{Signal: subj.Signal, Name: subj.Name, Level: "recovered", Text: "Volvió a lo normal: " + why}, now, "Sentinel · volvió a lo normal", false)
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

// ack: «ya lo sé». Reconoce el episodio abierto de una señal en su nivel de ahora. Error si no hay episodio.
func (n *notifier) ack(sig Signal, now time.Time) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	ep := n.Episodes[sig]
	if ep == nil {
		return fmt.Errorf("%s no tiene un episodio abierto: no hay nada que reconocer", sig)
	}
	ep.Acked, ep.AckedAt = ep.Level, now.Format(time.RFC3339)
	n.save()
	return nil
}

// clearAck deshace el reconocimiento.
func (n *notifier) clearAck(sig Signal) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if ep := n.Episodes[sig]; ep != nil {
		ep.Acked, ep.AckedAt = "", ""
		n.save()
	}
}

// acked: las señales reconocidas.
func (n *notifier) acked() map[Signal]bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := map[Signal]bool{}
	for sig, ep := range n.Episodes {
		if ep.Acked != "" {
			out[sig] = true
		}
	}
	return out
}

// gap: Sentinel no miró de g.From a g.To. Manda UN aviso con lo que pasó a alerta en ese tramo (las señales que
// avisarían: un comercio que no se sigue, no), lo anota en gaps.jsonl y deja de esperar el «volvió a leer»: este aviso
// ya lo dice. Antes, del 14 al 17/11/2026 no miró 64 h y el único rastro fue un «no puede leer» que no salió.
func (n *notifier) gap(g Gap, alerts []GapAlert, rules NotifyRules, capped bool, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	from, _ := time.Parse(time.RFC3339, g.From)
	to, _ := time.Parse(time.RFC3339, g.To)
	var names []string
	seen := map[Signal]bool{}
	for _, a := range alerts {
		if seen[a.Signal] || n.silenced(a.Signal, rules) {
			continue
		}
		seen[a.Signal] = true
		names = append(names, a.Name+" ("+a.At.In(bogota).Format("02/01 15:04")+")")
	}
	text := fmt.Sprintf("No miró %s, de %s a %s (¿el Mac dormido o la VPN?). ", fmtDuration(int(to.Sub(from).Minutes())),
		from.In(bogota).Format("02/01 15:04"), to.In(bogota).Format("02/01 15:04"))
	if capped {
		text += "Se repasaron sólo los últimos 3 días. "
	}
	if len(names) == 0 {
		text += "En ese tramo nada pasó a alerta."
	} else {
		text += fmt.Sprintf("En ese tramo pasaron a alerta %d: %s.", len(names), strings.Join(names, ", "))
	}
	n.FailingSince, n.StaleNotified = "", false
	n.send(Notice{Signal: "sentinel", Name: "Sentinel", Level: "gap", Text: text}, now, "Sentinel · no estuvo mirando", len(names) > 0)
	if !n.dry {
		if f, err := os.OpenFile(filepath.Join(n.dir, "gaps.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			raw, _ := json.Marshal(g)
			f.Write(append(raw, '\n'))
			f.Close()
		}
	}
	n.save()
}

// gaps: los tramos sin mirar que terminan después de `since`.
func (n *notifier) gaps(since time.Time) []Gap {
	var out []Gap
	raw, err := os.ReadFile(filepath.Join(n.dir, "gaps.jsonl"))
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(raw), "\n") {
		var g Gap
		if json.Unmarshal([]byte(line), &g) != nil {
			continue
		}
		if to, err := time.Parse(time.RFC3339, g.To); err == nil && to.After(since) {
			out = append(out, g)
		}
	}
	return out
}

// failed: una pasada que no pudo leer producción. Si dura `staleMinutes`, un aviso (una vez).
func (n *notifier) failed(err error, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.flush(now)
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

// stuck: la pasada en curso lleva demasiado sin avanzar (el perro guardián de main.go). Es el mismo «Sentinel no está
// mirando» que `failed`, pero sin esperar `staleMinutes`: una pasada colgada no devuelve nunca, así que nadie más va a
// avisar, y el plazo (2× el intervalo) ya pasó. Una vez; cuando una pasada vuelve a terminar bien, `observe` avisa que
// volvió y lo rearma.
func (n *notifier) stuck(since, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.FailingSince == "" {
		n.FailingSince = since.Format(time.RFC3339)
	}
	if n.StaleNotified {
		return
	}
	n.StaleNotified = true
	text := fmt.Sprintf("La pasada lleva %d min sin avanzar (¿una consulta o un proceso colgado?). Si no vuelve sola, reiniciá la API.", int(now.Sub(since).Minutes()))
	n.send(Notice{Signal: "sentinel", Name: "Sentinel", Level: "stale", Text: text}, now, "Sentinel no está mirando", true)
	n.save()
}

// send manda el aviso y lo anota. Con n.mu tomado. Si no sale, queda en Pending (salvo «volvió a lo normal», que
// atrasado ya no sirve) y la próxima pasada lo reintenta.
func (n *notifier) send(x Notice, now time.Time, title string, sound bool) {
	x.At = now.Format(time.RFC3339)
	if n.dry && n.deliver == nil {
		n.notices = append(n.notices, x)
		return
	}
	if title == "" {
		title = "Sentinel"
	}
	via, err := n.push(title, x.Name+": "+x.Text, routeOf(x.Signal), sound)
	if err != nil {
		log.Printf("sentinel: el aviso no salió: %v", err)
		n.LastError = err.Error()
		if x.Level != "recovered" && len(n.Pending) < maxPending {
			n.Pending = append(n.Pending, x)
		}
	} else {
		x.Sent, x.Via, n.LastError = true, via, ""
	}
	n.record(x)
}

// maxPending: los atrasados que se guardan; más allá, el resumen ya alcanza para ir a mirar.
const maxPending = 50

func (n *notifier) push(title, body, route string, sound bool) (string, error) {
	if n.deliver != nil {
		return n.deliver(title, body, route, sound)
	}
	return systemNotice(title, body, route, sound)
}

// record anota un aviso (mandado o no) en la memoria y en notices.jsonl.
func (n *notifier) record(x Notice) {
	log.Printf("sentinel: aviso %s · %s · %s", x.Level, x.Name, x.Text)
	n.notices = append(n.notices, x)
	if n.dry {
		return
	}
	if f, err := os.OpenFile(filepath.Join(n.dir, "notices.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		raw, _ := json.Marshal(x)
		f.Write(append(raw, '\n'))
		f.Close()
	}
}

// flush reintenta los atrasados en UN aviso («3 avisos no salieron desde las 11:06: …»), con sonido si alguno era
// alerta. Si sale, se vacía Pending; si no, siguen esperando. Con n.mu tomado.
func (n *notifier) flush(now time.Time) {
	if len(n.Pending) == 0 || (n.dry && n.deliver == nil) {
		return
	}
	since, _ := time.Parse(time.RFC3339, n.Pending[0].At)
	names, seen, sound := []string{}, map[Signal]bool{}, false
	for _, x := range n.Pending {
		sound = sound || x.Level == "alert" || x.Level == "stale"
		if !seen[x.Signal] {
			seen[x.Signal] = true
			names = append(names, x.Name)
		}
	}
	text := fmt.Sprintf("%d avisos no salieron desde %s: %s", len(n.Pending), since.In(bogota).Format("02/01 15:04"), strings.Join(names, ", "))
	via, err := n.push(fmt.Sprintf("Sentinel · %d avisos atrasados", len(n.Pending)), text, "", sound)
	if err != nil {
		n.LastError = err.Error()
		return
	}
	n.Pending, n.LastError = nil, ""
	n.record(Notice{At: now.Format(time.RFC3339), Signal: "sentinel", Name: "Sentinel", Level: "late", Text: text, Sent: true, Via: via})
}

// unsent: lo que espera salir, para la interfaz, `bin/sentinel now` y `make sentinel-status`; nil si no hay nada.
func (n *notifier) unsent() *Unsent {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.Pending) == 0 {
		return nil
	}
	return &Unsent{Count: len(n.Pending), Since: n.Pending[0].At, Error: n.LastError}
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
	case kind == "newmsg": // `newmsg:<servicio>#<huella>`: el servicio
		svc, _, _ := strings.Cut(key, "#")
		return "#/service/" + url.PathEscape(svc)
	}
	return "#/" + kind + "/" + url.PathEscape(key)
}

// rulesPath la fija main (la carpeta de my-tools); failed la usa para leer `staleMinutes`.
var rulesPath string

func loadRulesQuiet() (Rules, error) { return loadRules(rulesPath) }

// systemNotice: el aviso del sistema, y por dónde salió. En macOS va por el avisador del chat («Chat de my-tools», que
// abre un enlace `cockpit://` al tocarlo: Cockpit trae Sentinel al frente en esa ruta); si el avisador falla (sin
// permiso de avisos, por ejemplo), por osascript, que no abre nada pero avisa, y `via` dice por qué cayó al respaldo.
// En Linux, por `notify-send` si está en el PATH.
func systemNotice(title, body, route string, sound bool) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var chatErr error
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat de my-tools.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		args := []string{"--title", title, "--body", body, "--url", "cockpit://sentinel/" + route, "--group", "creditop-sentinel-" + route}
		if sound {
			args = append(args, "--sound")
		}
		out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
		if err == nil {
			return "avisador del chat", nil
		}
		chatErr = fmt.Errorf("avisador: %v %s", err, strings.TrimSpace(string(out)))
	}
	if runtime.GOOS != "darwin" {
		bin, err := exec.LookPath("notify-send")
		if err != nil {
			return "", fmt.Errorf("sin avisador en %s: no está notify-send en el PATH", runtime.GOOS)
		}
		// El sonido no depende de notify-send: en alerta va como urgencia crítica, que el escritorio no esconde sola.
		// El «--» corta las opciones: un cuerpo que empieza con «-» no se lee como una.
		urgency := "normal"
		if sound {
			urgency = "critical"
		}
		if out, err := exec.CommandContext(ctx, bin, "--app-name=Sentinel", "--urgency="+urgency, "--", title, body).CombinedOutput(); err != nil {
			return "", fmt.Errorf("notify-send: %v %s", err, strings.TrimSpace(string(out)))
		}
		return "notify-send", nil
	}
	q := func(s string) string { return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"` }
	script := "display notification " + q(body) + " with title " + q(title)
	if sound {
		script += ` sound name "Glass"`
	}
	if out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput(); err != nil {
		if chatErr != nil {
			return "", fmt.Errorf("%v; y osascript: %v %s", chatErr, err, strings.TrimSpace(string(out)))
		}
		return "", fmt.Errorf("osascript: %v %s", err, strings.TrimSpace(string(out)))
	}
	if chatErr != nil {
		return "osascript (el avisador del chat falló: " + chatErr.Error() + ")", nil
	}
	return "osascript", nil
}

// replayNotices: qué avisos habrían salido en los últimos `days` días, con una pasada cada `stepMinutes`. No manda nada:
// es la vara antes de cambiar `notify` en rules.json. Las señales se evalúan en paralelo (replay) y el avisador se
// repasa después, en orden, paso por paso.
func replayNotices(e evaluator, days int, now time.Time, follows func(Signal) bool) []Notice {
	return noticesOf(e.rules, e.replay(days, now), follows)
}

// noticesOf: los avisos que habrían salido de una historia ya evaluada (replay), repasando el avisador paso por paso.
func noticesOf(rules Rules, steps map[Signal][]replayStep, follows func(Signal) bool) []Notice {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, follows: follows}
	count := 0
	for _, s := range steps {
		count = max(count, len(s))
	}
	sigs := make([]Signal, 0, len(steps))
	for sig := range steps {
		sigs = append(sigs, sig)
	}
	sort.Strings(sigs)
	for i := 0; i < count; i++ {
		o := &Overview{Rules: rules}
		var at time.Time
		for _, sig := range sigs {
			if i >= len(steps[sig]) {
				continue
			}
			st := steps[sig][i]
			at = st.At
			o.Lenders = append(o.Lenders, Subject{Signal: sig, Name: sig, State: levelName(st.Level), Why: st.Why, Now: Window{Total: st.Now}})
		}
		n.observe(o, at)
	}
	return n.notices
}

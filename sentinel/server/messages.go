package main

// LOS MENSAJES DE ERROR NUEVOS. Un conteo de errores no ve una falla nueva de poco volumen: el 18/11/2026 el
// form-service de desarrollo empezó a decir «Unknown column 'cell_phone_lenght' in 'field list'» (12 veces en una hora,
// y cualquier hora tiene más errores que eso). Lo que sí lo delata es que el MENSAJE no existía. Acá se lleva, por
// servicio, cada mensaje de error de producción (normalizado: sin números, ids ni lo que va entre comillas) con cuándo
// apareció por primera vez; uno que aparece y se repite es `newmsg:<servicio>#<huella>`.
//
// El registro vive en `sentinel/.data/messages.json`. La primera vez se siembra con los 7 días anteriores (de a una
// hora: Loki devuelve hasta 5.000 líneas por consulta); hasta que la siembra termina, nada es «nuevo». Después, cada
// pasada lee las líneas de error desde donde quedó.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	connlogs "creditop/my-tools/connectors/logs"
)

const (
	errorLinesLogQL = `{service_name=~".+"} | detected_level="error"`
	msgSeedDays     = 7
	msgNewHours     = 6  // un mensaje es «nuevo» durante sus primeras 6 horas
	msgWarnCount    = 5  // desde que apareció: para mirar
	msgAlertCount   = 10 // alerta
	msgForgetDays   = 14 // un mensaje que no se ve hace 14 días se olvida (si vuelve, es nuevo otra vez)
	msgLokiLimit    = 5000
	msgMaxLen       = 180
)

// MsgSeen: un mensaje de un servicio.
type MsgSeen struct {
	First  string `json:"first"`
	Last   string `json:"last"`
	Count  int    `json:"count"`  // desde que apareció
	Sample string `json:"sample"` // uno tal cual llegó (sin normalizar), recortado
}

type msgStore struct {
	mu   sync.Mutex
	path string
	// Seeded: cuándo terminó la siembra; vacío mientras no. Reach: hasta dónde se leyó.
	Seeded   string                         `json:"seeded"`
	Reach    string                         `json:"reach"`
	Services map[string]map[string]*MsgSeen `json:"services"`
	seeding  bool
}

func openMessages(dir string) *msgStore {
	m := &msgStore{path: filepath.Join(dir, "messages.json"), Services: map[string]map[string]*MsgSeen{}}
	if raw, err := os.ReadFile(m.path); err == nil {
		_ = json.Unmarshal(raw, m)
		if m.Services == nil {
			m.Services = map[string]map[string]*MsgSeen{}
		}
	}
	return m
}

func (m *msgStore) save() error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

var (
	reQuoted = regexp.MustCompile(`'[^']*'|"[^"]*"|` + "`[^`]*`")
	reUUID   = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	reHex    = regexp.MustCompile(`(?i)\b(0x)?[0-9a-f]{8,}\b`)
	reEmail  = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.]+`)
	reURL    = regexp.MustCompile(`https?://\S+`)
	reNumber = regexp.MustCompile(`\d+([.,]\d+)*`)
	reSpaces = regexp.MustCompile(`\s+`)
)

// normalizeMessage: el mensaje sin lo que cambia de una vez a otra (ids, números, valores entre comillas), para que
// «Unknown column 'x'» y «Unknown column 'y'» sean dos mensajes pero «solicitud 501» y «solicitud 502» uno solo.
// Lo de entre comillas se queda si es corto y no tiene números (un nombre de columna, de tabla): eso es lo que distingue.
func normalizeMessage(s string) string {
	s = reURL.ReplaceAllString(s, "<url>")
	s = reEmail.ReplaceAllString(s, "<correo>")
	s = reQuoted.ReplaceAllStringFunc(s, func(q string) string {
		if len(q) <= 42 && !strings.ContainsAny(q, "0123456789") {
			return q
		}
		return "'…'"
	})
	s = reUUID.ReplaceAllString(s, "<id>")
	s = reHex.ReplaceAllString(s, "<id>")
	s = reNumber.ReplaceAllString(s, "N")
	s = strings.TrimSpace(reSpaces.ReplaceAllString(s, " "))
	if r := []rune(s); len(r) > msgMaxLen {
		s = string(r[:msgMaxLen]) + "…"
	}
	return s
}

// messageOf: el mensaje de una línea de error. Los servicios en Go lo mandan como metadato (`exception_message`); los
// monolitos, en el JSON de la línea (`message`); si no, la línea.
func messageOf(labels map[string]string, line string) string {
	if m := labels["exception_message"]; m != "" {
		return m
	}
	var j struct {
		Message string `json:"message"`
	}
	if strings.HasPrefix(strings.TrimSpace(line), "{") && json.Unmarshal([]byte(line), &j) == nil && j.Message != "" {
		return j.Message
	}
	return line
}

// errorLine: una línea de error ya leída.
type errorLine struct {
	At      time.Time
	Service string
	Message string
}

// readErrorLines: las líneas de error de producción de [from, to), en orden, de a `msgLokiLimit` por consulta.
func readErrorLines(cl *connlogs.Client, from, to time.Time) ([]errorLine, error) {
	var out []errorLine
	start := from
	for start.Before(to) {
		status, body, err := cl.API("query_range", url.Values{
			"query": {errorLinesLogQL}, "start": {fmt.Sprint(start.UnixNano())}, "end": {fmt.Sprint(to.UnixNano())},
			"limit": {strconv.Itoa(msgLokiLimit)}, "direction": {"forward"},
		})
		if err != nil {
			return out, err
		}
		if status != http.StatusOK {
			return out, fmt.Errorf("Loki contestó %d: %s", status, connlogs.Explain(status, body))
		}
		var res struct {
			Data struct {
				Result []struct {
					Stream map[string]string `json:"stream"`
					Values [][2]string       `json:"values"`
				} `json:"result"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &res); err != nil {
			return out, fmt.Errorf("la respuesta de Loki no se pudo leer: %w", err)
		}
		n, last := 0, start
		for _, st := range res.Data.Result {
			for _, v := range st.Values {
				ns, _ := strconv.ParseInt(v[0], 10, 64)
				at := time.Unix(0, ns)
				out = append(out, errorLine{At: at, Service: st.Stream["service_name"], Message: messageOf(st.Stream, v[1])})
				n++
				if at.After(last) {
					last = at
				}
			}
		}
		if n < msgLokiLimit {
			break
		}
		start = last.Add(time.Nanosecond) // llegó al tope: sigue desde la última que vio
	}
	return out, nil
}

// record suma las líneas al registro. Con m.mu tomado.
func (m *msgStore) record(lines []errorLine) {
	for _, l := range lines {
		if l.Service == "" || strings.TrimSpace(l.Message) == "" {
			continue
		}
		key := normalizeMessage(l.Message)
		svc := m.Services[l.Service]
		if svc == nil {
			svc = map[string]*MsgSeen{}
			m.Services[l.Service] = svc
		}
		at := l.At.In(bogota).Format(time.RFC3339)
		x := svc[key]
		if x == nil {
			sample := l.Message
			if r := []rune(sample); len(r) > 400 {
				sample = string(r[:400]) + "…"
			}
			x = &MsgSeen{First: at, Sample: sample}
			svc[key] = x
		}
		if at < x.First {
			x.First = at
		}
		if at > x.Last {
			x.Last = at
		}
		x.Count++
	}
}

// forget saca lo que no se ve hace `msgForgetDays`. Con m.mu tomado.
func (m *msgStore) forget(now time.Time) {
	limit := now.AddDate(0, 0, -msgForgetDays).Format(time.RFC3339)
	for svc, msgs := range m.Services {
		for k, x := range msgs {
			if x.Last < limit {
				delete(msgs, k)
			}
		}
		if len(msgs) == 0 {
			delete(m.Services, svc)
		}
	}
}

// track lee las líneas de error desde donde quedó hasta `now` y las registra. Sin siembra, la arranca de fondo (los 7
// días de antes, de a una hora) y no marca nada como nuevo hasta que termine.
func (m *msgStore) track(now time.Time) error {
	m.mu.Lock()
	seeded, seeding, reach := m.Seeded != "", m.seeding, m.Reach
	m.mu.Unlock()
	if !seeded {
		if !seeding {
			m.mu.Lock()
			m.seeding = true
			m.mu.Unlock()
			go m.seed(now)
		}
		return nil
	}
	from, _ := time.Parse(time.RFC3339, reach)
	if from.IsZero() || now.Sub(from) > 3*time.Hour {
		from = now.Add(-3 * time.Hour) // un hueco largo (el Mac dormido): lo de antes ya no sería «nuevo» a tiempo
	}
	cl, err := lokiClient()
	if err != nil {
		return err
	}
	lines, err := readErrorLines(cl, from, now)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.record(lines)
	m.Reach = now.In(bogota).Format(time.RFC3339)
	m.forget(now)
	return m.save()
}

// seed: los 7 días anteriores, de a una hora. Si una hora falla, sigue: la siembra es para saber qué es viejo.
func (m *msgStore) seed(now time.Time) {
	defer func() {
		m.mu.Lock()
		m.seeding = false
		m.mu.Unlock()
	}()
	cl, err := lokiClient()
	if err != nil {
		return
	}
	failed := 0
	for t := now.AddDate(0, 0, -msgSeedDays); t.Before(now); t = t.Add(time.Hour) {
		lines, err := readErrorLines(cl, t, minTime(t.Add(time.Hour), now))
		if err != nil {
			failed++
			continue
		}
		m.mu.Lock()
		m.record(lines)
		m.mu.Unlock()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if failed > msgSeedDays*24/10 { // más de un 10 % de horas sin leer: se reintenta en la próxima pasada
		return
	}
	stamp := now.In(bogota).Format(time.RFC3339)
	m.Seeded, m.Reach = stamp, stamp
	_ = m.save()
}

// msgSignal: `newmsg:<servicio>#<huella>`.
func msgSignal(service, key string) Signal {
	h := sha1.Sum([]byte(key))
	return "newmsg:" + service + "#" + hex.EncodeToString(h[:4])
}

// subjects: los mensajes nuevos (aparecidos después de la siembra, en las últimas `msgNewHours`), como señales.
func (m *msgStore) subjects(now time.Time) []Subject {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Subject
	if m.Seeded == "" {
		return out
	}
	since := now.Add(-msgNewHours * time.Hour).Format(time.RFC3339)
	for svc, msgs := range m.Services {
		for key, x := range msgs {
			if x.First <= m.Seeded || x.First < since {
				continue
			}
			state := "quiet"
			switch {
			case x.Count >= msgAlertCount:
				state = "alert"
			case x.Count >= msgWarnCount:
				state = "warn"
			}
			first, _ := time.Parse(time.RFC3339, x.First)
			out = append(out, Subject{
				Signal: msgSignal(svc, key), Kind: "newmsg", Name: svc + " · error nuevo", State: state, Raw: state,
				Now:     Window{Total: x.Count},
				Why:     fmt.Sprintf("«%s»: %d veces desde las %s, y no estaba en los %d días anteriores", key, x.Count, first.In(bogota).Format("15:04"), msgSeedDays),
				Message: &MsgView{Service: svc, Text: key, Sample: x.Sample, First: x.First, Last: x.Last, Count: x.Count},
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Now.Total > out[j].Now.Total })
	return out
}

// MsgView: un mensaje nuevo, para la interfaz.
type MsgView struct {
	Service string `json:"service"`
	Text    string `json:"text"`
	Sample  string `json:"sample"`
	First   string `json:"first"`
	Last    string `json:"last"`
	Count   int    `json:"count"`
}

// status: si la siembra terminó, para la nota de la interfaz.
func (m *msgStore) status() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch {
	case m.Seeded != "":
		return ""
	case m.seeding:
		return fmt.Sprintf("aprendiendo los mensajes de error de los últimos %d días: hasta que termine, ninguno es «nuevo»", msgSeedDays)
	}
	return "todavía sin los mensajes de error de producción"
}

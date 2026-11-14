package main

// LO GUARDADO. Un solo archivo, `correo/.data/state.json` (fuera de git): los seguimientos (qué remitentes se miran),
// los correos que salieron de cada uno, cuáles se vieron en la interfaz y cuáles ya avisaron. El cuerpo de un correo no
// se guarda: se pide a Gmail al abrirlo.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/connectors/gmail"
)

// Watch es un seguimiento: un nombre y una búsqueda de Gmail («from:shopify.com»).
type Watch struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Query string `json:"query"`
}

// keepPerWatch: cuántos correos se guardan por seguimiento (los más nuevos).
const keepPerWatch = 60

type state struct {
	Watches  []Watch                    `json:"watches"`
	Messages map[string][]gmail.Message `json:"messages"` // por seguimiento, los más nuevos primero
	Read     map[string]time.Time       `json:"read"`     // id del correo → cuándo se vio en la interfaz
	Notified map[string]time.Time       `json:"notified"` // id del correo → cuándo avisó (o se dio por visto al estrenar)
	Primed   map[string]bool            `json:"primed"`   // el seguimiento ya pasó su primera lectura: desde ahí avisa
	Threads  map[string]Thread          `json:"threads"`  // id del hilo → quién escribió y cuándo
	NoReply  map[string]time.Time       `json:"noReply"`  // id del correo → cuándo se marcó «no hace falta responder»
}

// Thread es lo que importa de un hilo para saber si se respondió: la última vez que escribiste vos y la última que
// escribieron ellos. Se lee del hilo entero en Gmail (format=metadata), en cada lectura.
type Thread struct {
	LastMine   time.Time `json:"lastMine,omitempty"`
	LastTheirs time.Time `json:"lastTheirs,omitempty"`
	Count      int       `json:"count"`
}

type store struct {
	path string
	mu   sync.Mutex
	st   state
}

// defaultWatches: con lo que arranca la primera vez. Los trámites de las tiendas: Shopify y VTEX. Afinadas el
// 2026-11-13: «from:shopify.com» traía los avisos de login y códigos (mailer@); el soporte de VTEX escribe desde
// Zendesk (support@vtexhelp.zendesk.com), no desde vtex.com, y ct.vtex.com.br son los pedidos de la tienda de pruebas.
var defaultWatches = []Watch{
	{ID: "shopify", Name: "Shopify", Query: "from:support@shopify.com OR from:paymentspartners@shopify.com"},
	{ID: "vtex", Name: "VTEX", Query: "{from:vtexhelp.zendesk.com from:vtex.com} -from:ct.vtex.com.br"},
}

func openStore(dir string) (*store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &store{path: filepath.Join(dir, "state.json")}
	b, err := os.ReadFile(s.path)
	switch {
	case os.IsNotExist(err):
		s.st.Watches = append([]Watch(nil), defaultWatches...)
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(b, &s.st); err != nil {
			return nil, err
		}
	}
	if s.st.Messages == nil {
		s.st.Messages = map[string][]gmail.Message{}
	}
	if s.st.Read == nil {
		s.st.Read = map[string]time.Time{}
	}
	if s.st.Notified == nil {
		s.st.Notified = map[string]time.Time{}
	}
	if s.st.Primed == nil {
		s.st.Primed = map[string]bool{}
	}
	if s.st.Threads == nil {
		s.st.Threads = map[string]Thread{}
	}
	if s.st.NoReply == nil {
		s.st.NoReply = map[string]time.Time{}
	}
	return s, s.saveLocked()
}

func (s *store) saveLocked() error {
	b, _ := json.MarshalIndent(s.st, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *store) watches() []Watch {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Watch(nil), s.st.Watches...)
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// addWatch agrega un seguimiento o cambia uno existente (mismo id).
func (s *store) addWatch(w Watch) (Watch, error) {
	w.Name, w.Query = strings.TrimSpace(w.Name), strings.TrimSpace(w.Query)
	if w.Name == "" || w.Query == "" {
		return w, errors.New("un seguimiento lleva nombre y búsqueda (por ejemplo «from:shopify.com»)")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if w.ID == "" {
		w.ID = strings.Trim(slugRe.ReplaceAllString(strings.ToLower(w.Name), "-"), "-")
		if w.ID == "" {
			w.ID = "seguimiento"
		}
		base := w.ID
		for n := 2; s.indexLocked(w.ID) >= 0; n++ {
			w.ID = base + "-" + itoa(n)
		}
		s.st.Watches = append(s.st.Watches, w)
	} else if i := s.indexLocked(w.ID); i >= 0 {
		if s.st.Watches[i].Query != w.Query { // otra búsqueda: se vuelve a estrenar, sin avisar de lo viejo
			delete(s.st.Primed, w.ID)
			delete(s.st.Messages, w.ID)
		}
		s.st.Watches[i] = w
	} else {
		return w, errors.New("no hay un seguimiento " + w.ID)
	}
	return w, s.saveLocked()
}

func (s *store) removeWatch(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(id)
	if i < 0 {
		return errors.New("no hay un seguimiento " + id)
	}
	s.st.Watches = append(s.st.Watches[:i], s.st.Watches[i+1:]...)
	delete(s.st.Messages, id)
	delete(s.st.Primed, id)
	return s.saveLocked()
}

func (s *store) indexLocked(id string) int {
	for i, w := range s.st.Watches {
		if w.ID == id {
			return i
		}
	}
	return -1
}

// known: los ids que ya están guardados para un seguimiento (para no volver a pedirlos a Gmail).
func (s *store) known(watch string) map[string]gmail.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]gmail.Message{}
	for _, m := range s.st.Messages[watch] {
		out[m.ID] = m
	}
	return out
}

// update deja los correos de un seguimiento y devuelve los que hay que avisar: los que no avisaron nunca, si el
// seguimiento ya estaba estrenado. En la primera lectura todo se da por avisado: no llueven cincuenta avisos viejos.
// `query` es la búsqueda con la que se leyó: si mientras tanto se cambió (o se sacó el seguimiento), no se guarda nada.
// Sin esto, una lectura en curso volvía a dejar los correos de la búsqueda vieja (medido el 2026-11-13).
func (s *store) update(watch, query string, msgs []gmail.Message, now time.Time) []gmail.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.indexLocked(watch); i < 0 || s.st.Watches[i].Query != query {
		return nil
	}
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].Date.After(msgs[j].Date) })
	if len(msgs) > keepPerWatch {
		msgs = msgs[:keepPerWatch]
	}
	s.st.Messages[watch] = msgs
	primed := s.st.Primed[watch]
	var fresh []gmail.Message
	for _, m := range msgs {
		if _, done := s.st.Notified[m.ID]; done {
			continue
		}
		s.st.Notified[m.ID] = now
		if primed {
			fresh = append(fresh, m)
		} else {
			s.st.Read[m.ID] = now // lo de antes de estrenar no cuenta como nuevo
		}
	}
	s.st.Primed[watch] = true
	_ = s.saveLocked()
	return fresh
}

// setThreads guarda el estado de los hilos leídos en esta pasada.
func (s *store) setThreads(th map[string]Thread) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, t := range th {
		s.st.Threads[id] = t
	}
	_ = s.saveLocked()
}

// threadOf resume un hilo: la última vez de cada lado. `me` es la cuenta de la sesión.
func threadOf(msgs []gmail.Message, me string) Thread {
	t := Thread{Count: len(msgs)}
	me = strings.ToLower(me)
	for _, m := range msgs {
		if me != "" && strings.Contains(strings.ToLower(m.From), me) {
			if m.Date.After(t.LastMine) {
				t.LastMine = m.Date
			}
		} else if m.Date.After(t.LastTheirs) {
			t.LastTheirs = m.Date
		}
	}
	return t
}

// markNoReply marca (o, con undo, desmarca) correos que no hace falta responder: un acuse automático («Ticket
// received»), un aviso. Marcarlo también lo da por visto.
func (s *store) markNoReply(ids []string, undo bool, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range ids {
		if undo {
			delete(s.st.NoReply, id)
			continue
		}
		s.st.NoReply[id] = now
		s.st.Read[id] = now
	}
	return s.saveLocked()
}

func (s *store) markRead(ids []string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range ids {
		s.st.Read[id] = now
	}
	return s.saveLocked()
}

// WatchView es un seguimiento como lo ve la interfaz.
type WatchView struct {
	Watch
	Unread   int           `json:"unread"`
	Pending  int           `json:"pending"` // vistos y sin responder
	Week     int           `json:"week"`    // los que llegaron en los últimos 7 días
	Messages []MessageView `json:"messages"`
}

// MessageView es un correo en la lista.
//
// Status: «unread» (no se abrió en la herramienta), «pending» (se vio y en el hilo no hay nada tuyo después),
// «replied» (hay una respuesta tuya posterior, RepliedAt) o «noreply» (se marcó que no hace falta responder: un acuse
// automático). Responder cuenta aunque no se haya abierto acá: si contestaste desde Gmail, está respondido.
type MessageView struct {
	gmail.Message
	Unread    bool      `json:"unread"`
	Status    string    `json:"status"`
	RepliedAt time.Time `json:"repliedAt,omitempty"`
	URL       string    `json:"url"` // el hilo en Gmail
}

func (s *store) view(account string) ([]WatchView, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []WatchView
	total := 0
	for _, w := range s.st.Watches {
		v := WatchView{Watch: w}
		weekAgo := time.Now().AddDate(0, 0, -7)
		for _, m := range s.st.Messages[w.ID] {
			_, read := s.st.Read[m.ID]
			mv := MessageView{Message: m, Unread: !read, URL: threadURL(account, m.ThreadID)}
			if t := s.st.Threads[m.ThreadID]; t.LastMine.After(m.Date) {
				mv.RepliedAt = t.LastMine
			}
			_, noReply := s.st.NoReply[m.ID]
			switch {
			case !mv.RepliedAt.IsZero():
				mv.Status = "replied"
			case noReply:
				mv.Status = "noreply"
			case mv.Unread:
				mv.Status = "unread"
			default:
				mv.Status = "pending"
			}
			if mv.Status == "unread" {
				v.Unread++
			}
			if mv.Status == "pending" {
				v.Pending++
			}
			if m.Date.After(weekAgo) {
				v.Week++
			}
			v.Messages = append(v.Messages, mv)
		}
		total += v.Unread
		out = append(out, v)
	}
	return out, total
}

// unreadIDs: los no vistos de un seguimiento (o de todos, con watch vacío).
func (s *store) unreadIDs(watch string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for id, msgs := range s.st.Messages {
		if watch != "" && id != watch {
			continue
		}
		for _, m := range msgs {
			if _, read := s.st.Read[m.ID]; !read {
				out = append(out, m.ID)
			}
		}
	}
	return out
}

func threadURL(account, thread string) string {
	u := "https://mail.google.com/mail/"
	if account != "" {
		u += "?authuser=" + account
	}
	return u + "#all/" + thread
}

func itoa(n int) string {
	b := []byte{}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

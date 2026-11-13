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

	"creditop/playground/connectors/gmail"
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
}

type store struct {
	path string
	mu   sync.Mutex
	st   state
}

// defaultWatches: con lo que arranca la primera vez. Los trámites de las tiendas: Shopify y VTEX.
var defaultWatches = []Watch{
	{ID: "shopify", Name: "Shopify", Query: "from:shopify.com"},
	{ID: "vtex", Name: "VTEX", Query: "from:vtex.com"},
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
	Messages []MessageView `json:"messages"`
}

// MessageView es un correo en la lista.
type MessageView struct {
	gmail.Message
	Unread bool   `json:"unread"`
	URL    string `json:"url"` // el hilo en Gmail
}

func (s *store) view(account string) ([]WatchView, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []WatchView
	total := 0
	for _, w := range s.st.Watches {
		v := WatchView{Watch: w}
		for _, m := range s.st.Messages[w.ID] {
			_, read := s.st.Read[m.ID]
			mv := MessageView{Message: m, Unread: !read, URL: threadURL(account, m.ThreadID)}
			if mv.Unread {
				v.Unread++
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

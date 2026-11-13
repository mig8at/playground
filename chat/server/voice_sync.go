package main

// LA VIDEOLLAMADA SINCRONIZADA: lo que se dice en una conversación queda en audio ANTES de abrir la llamada. Al
// sincronizar una conversación (el botón de la barra de la llamada), este servidor pasa a voz lo último que se dijo
// —hacia atrás hasta un tope de caracteres, para no pagar la historia entera— y, de ahí en adelante, cada mensaje que
// entra por el chat (aunque la llamada esté cerrada). Así, al abrir la llamada, repetir cualquier mensaje es inmediato
// y no cuesta, y en vivo lo que llega suena de una.
//
// QUÉ SE DICE y con qué voz: las frases salen de la misma receta que usa la llamada (voice_text.go, la copia de
// chat/src/voiceText.js) y la voz de cada personaje la manda la interfaz al sincronizar (es la que sabe resolverla:
// su JSON, lo que se le cambió, la de su especie). Lo que se sincroniza queda anotado como la voz con que sonó ese
// mensaje (voice-said.json): la llamada lo repite con ésa y encuentra cada frase ya guardada.
//
//	GET    /api/voice/sync                       {"conversations": {"#oficina": {estado}}}
//	POST   /api/voice/sync  {conversation, chars, maxWords, me, voices, names}   sincroniza y queda en vivo
//	PUT    /api/voice/sync  {conversation, maxWords, me, voices, names}         sólo renueva las voces (la llamada abierta)
//	DELETE /api/voice/sync?conversation=#oficina                                deja de sincronizar
//
//	event: voice-sync  data: {conversation, estado}   cada avance (realtime.go)
//
// Gasta del mismo tope diario que la llamada (voice_budget.go); si se acaba, la sincronización se detiene y lo dice.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

const (
	defaultSyncChars = 3000
	maxSyncChars     = 50000
)

// syncConversation: lo que se guarda por conversación (voice-sync.json).
type syncConversation struct {
	On       bool              `json:"on"`
	Chars    int               `json:"chars"`    // el tope hacia atrás del último pedido
	MaxWords int               `json:"maxWords"` // el tope de palabras del perfil: lo más largo no se dice
	Me       string            `json:"me"`       // tu usuario: lo que mandan tus agentes sale como tuyo, con `via`
	Voices   map[string]string `json:"voices"`   // personaje → voz
	Names    map[string]string `json:"names"`    // personaje → nombre (las @menciones se dicen por el nombre)
	Since    string            `json:"since"`    // desde cuándo está en vivo
}

// syncStatus: cómo va, para la barra de la llamada.
type syncStatus struct {
	syncConversation
	Pending int    `json:"pending"` // mensajes en fila
	Done    int    `json:"done"`    // mensajes ya en audio (de esta tanda)
	Total   int    `json:"total"`   // mensajes de esta tanda
	Spent   int    `json:"spent"`   // caracteres pagados en esta tanda (lo ya guardado no cuenta)
	Error   string `json:"error,omitempty"`
}

type syncJob struct {
	conv, id, voice string
	lines           []string
}

var (
	syncMu    sync.Mutex
	syncState = map[string]*syncStatus{}
	syncQueue = make(chan syncJob, 4096)
	syncOnce  sync.Once
)

func syncFile() string { return filepath.Join(voiceCacheDir(), "voice-sync.json") }

// loadSync trae lo guardado la primera vez (con syncMu tomado).
func loadSync() {
	syncOnce.Do(func() {
		var saved map[string]syncConversation
		if raw, err := os.ReadFile(syncFile()); err == nil && json.Unmarshal(raw, &saved) == nil {
			for k, c := range saved {
				syncState[k] = &syncStatus{syncConversation: c}
			}
		}
		go syncWorker()
	})
}

// saveSync guarda la configuración (con syncMu tomado).
func saveSync() {
	out := map[string]syncConversation{}
	for k, s := range syncState {
		out[k] = s.syncConversation
	}
	raw, _ := json.Marshal(out)
	_ = os.MkdirAll(voiceCacheDir(), 0o755)
	_ = writeAtomic(syncFile(), raw)
}

// La conversación de un mensaje es conversationOf (history.go): «#grupo» o el correo del otro, en minúscula.

// speakerKey: quién lo dijo, como clave de personaje («miguel» o «miguel/luigi»); "" si es tuyo (lo tuyo no se dice).
// Es la misma regla de speakerOf en CallView.vue.
func speakerKey(m cli.Message, me string) string {
	agent := ""
	if m.Via != nil {
		agent = strings.ToLower(m.Via.Name)
	}
	if m.Dir == "out" {
		if agent == "" || me == "" {
			return ""
		}
		return strings.ToLower(me) + "/" + agent
	}
	person := strings.ToLower(strings.SplitN(m.From.Email, "@", 2)[0])
	if agent != "" {
		return person + "/" + agent
	}
	return person
}

// jobFor: lo que hay que generar de un mensaje en una conversación sincronizada (ok=false: nada).
func jobFor(conv string, c syncConversation, m cli.Message) (syncJob, bool) {
	key := speakerKey(m, c.Me)
	voice := c.Voices[key]
	if key == "" || voice == "" {
		return syncJob{}, false
	}
	lines := callLines(m, c.Names, c.MaxWords)
	if len(lines) == 0 {
		return syncJob{}, false
	}
	return syncJob{conv: conv, id: m.ID, voice: voice, lines: lines}, true
}

// syncFresh: lo que acaba de entrar al historial, a la fila si su conversación está sincronizada.
func syncFresh(fresh []cli.Message) {
	syncMu.Lock()
	loadSync()
	var jobs []syncJob
	for _, m := range fresh {
		conv := conversationOf(m)
		s := syncState[conv]
		if s == nil || !s.On {
			continue
		}
		if j, ok := jobFor(conv, s.syncConversation, m); ok {
			s.Total++
			s.Pending++
			jobs = append(jobs, j)
		}
	}
	syncMu.Unlock()
	for _, j := range jobs {
		enqueueSync(j)
	}
}

func enqueueSync(j syncJob) {
	select {
	case syncQueue <- j:
		publishSync(j.conv)
	default: // la fila está llena (algo en un bucle): éste queda para cuando la llamada lo pida
		syncMu.Lock()
		if s := syncState[j.conv]; s != nil {
			s.Pending--
			s.Error = "demasiados mensajes en fila: algunos se generan al reproducirlos"
		}
		syncMu.Unlock()
	}
}

// syncWorker genera de a un mensaje, en orden. Cada frase pasa por synthesizeEleven: lo ya guardado no se paga.
func syncWorker() {
	for j := range syncQueue {
		syncMu.Lock()
		s := syncState[j.conv]
		on := s != nil && s.On
		syncMu.Unlock()
		spent, err := 0, error(nil)
		if on {
			// la voz con que suena este mensaje: si ya sonó antes con otra, ésa (lo dicho no cambia de voz)
			if v, e := rememberSaid(j.id, j.voice); e == nil && v != "" {
				j.voice = v
			}
			for _, line := range j.lines {
				cached := voiceCached(j.voice, line)
				if _, err = synthesizeEleven(j.voice, line); err != nil {
					break
				}
				if !cached {
					spent += len([]rune(line))
				}
			}
		}
		syncMu.Lock()
		if s := syncState[j.conv]; s != nil {
			s.Pending--
			if s.Pending < 0 {
				s.Pending = 0
			}
			if on {
				s.Done++
				s.Spent += spent
			}
			if err != nil {
				s.Error = err.Error()
				// sin créditos, sin llave o sin tope: no tiene sentido seguir quemando la fila
				if strings.Contains(err.Error(), "tope") || strings.Contains(err.Error(), "créditos") || strings.Contains(err.Error(), "llave") {
					s.On = false
					saveSync()
				}
			}
		}
		syncMu.Unlock()
		publishSync(j.conv)
	}
}

// voiceCached: ¿esta frase ya está guardada con esta voz? (la misma cuenta que synthesizeEleven)
func voiceCached(voice, text string) bool {
	file, err := voiceCacheFile(voice, text)
	if err != nil {
		return false
	}
	_, err = os.Stat(file)
	return err == nil
}

func publishSync(conv string) {
	syncMu.Lock()
	s := syncState[conv]
	var copy syncStatus
	if s != nil {
		copy = *s
	}
	syncMu.Unlock()
	events.publish("voice-sync", map[string]any{"conversation": conv, "status": copy})
}

// backfill: lo último de la conversación, hacia atrás, hasta `chars` caracteres de lo que se dice. En orden.
func backfill(conv string, c syncConversation, chars int) []syncJob {
	if chatHistory == nil {
		return nil
	}
	all := chatHistory.all()
	var picked []syncJob
	total := 0
	for i := len(all) - 1; i >= 0; i-- {
		m := all[i]
		if conversationOf(m) != conv {
			continue
		}
		j, ok := jobFor(conv, c, m)
		if !ok {
			continue
		}
		n := 0
		for _, l := range j.lines {
			n += len([]rune(l))
		}
		if total+n > chars && len(picked) > 0 {
			break
		}
		total += n
		picked = append(picked, j)
	}
	for a, b := 0, len(picked)-1; a < b; a, b = a+1, b-1 {
		picked[a], picked[b] = picked[b], picked[a]
	}
	return picked
}

type syncRequest struct {
	Conversation string            `json:"conversation"`
	Chars        int               `json:"chars"`
	MaxWords     int               `json:"maxWords"`
	Me           string            `json:"me"`
	Voices       map[string]string `json:"voices"`
	Names        map[string]string `json:"names"`
}

func (r syncRequest) valid() error {
	if !strings.HasPrefix(r.Conversation, "#") && !strings.Contains(r.Conversation, "@") {
		return errors.New("falta la conversación («#grupo» o un correo)")
	}
	if len(r.Voices) == 0 || len(r.Voices) > 200 {
		return errors.New("faltan las voces de los personajes")
	}
	return nil
}

func registerVoiceSync(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		syncMu.Lock()
		loadSync()
		out := map[string]syncStatus{}
		for k, s := range syncState {
			out[k] = *s
		}
		syncMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"conversations": out})
	})
	// sincronizar: guardar las voces, quedar en vivo y poner en fila lo último hacia atrás
	mux.HandleFunc("POST /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeSync(w, r)
		if !ok {
			return
		}
		chars := req.Chars
		if chars <= 0 {
			chars = defaultSyncChars
		}
		if chars > maxSyncChars {
			chars = maxSyncChars
		}
		syncMu.Lock()
		loadSync()
		s := upsertSync(req)
		s.On, s.Chars, s.Since = true, chars, time.Now().UTC().Format(time.RFC3339)
		s.Error, s.Done, s.Total, s.Pending, s.Spent = "", 0, 0, 0, 0
		jobs := backfill(req.Conversation, s.syncConversation, chars)
		s.Total, s.Pending = len(jobs), len(jobs)
		saveSync()
		status := *s
		syncMu.Unlock()
		go func() {
			for _, j := range jobs {
				enqueueSync(j)
			}
			publishSync(req.Conversation)
		}()
		writeJSON(w, http.StatusOK, map[string]any{"status": status})
	})
	// las voces cambiaron con la llamada abierta (un ♂/♀, alguien que entró): sólo se renuevan, sin volver atrás
	mux.HandleFunc("PUT /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeSync(w, r)
		if !ok {
			return
		}
		syncMu.Lock()
		loadSync()
		s := syncState[req.Conversation]
		if s != nil {
			upsertSync(req)
			saveSync()
		}
		var status syncStatus
		if s != nil {
			status = *s
		}
		syncMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"status": status})
	})
	mux.HandleFunc("DELETE /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		conv := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("conversation")))
		syncMu.Lock()
		loadSync()
		if s := syncState[conv]; s != nil {
			s.On = false
			saveSync()
		}
		syncMu.Unlock()
		publishSync(conv)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func decodeSync(w http.ResponseWriter, r *http.Request) (syncRequest, bool) {
	var req syncRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, err)
		return req, false
	}
	req.Conversation = strings.ToLower(strings.TrimSpace(req.Conversation))
	if err := req.valid(); err != nil {
		fail(w, http.StatusBadRequest, err)
		return req, false
	}
	return req, true
}

// upsertSync guarda voces, nombres, tu usuario y el tope de palabras (con syncMu tomado).
func upsertSync(req syncRequest) *syncStatus {
	s := syncState[req.Conversation]
	if s == nil {
		s = &syncStatus{}
		syncState[req.Conversation] = s
	}
	lower := func(in map[string]string) map[string]string {
		out := map[string]string{}
		for k, v := range in {
			out[strings.ToLower(k)] = v
		}
		return out
	}
	s.Voices, s.Names, s.Me = lower(req.Voices), lower(req.Names), strings.ToLower(req.Me)
	if req.MaxWords > 0 {
		s.MaxWords = req.MaxWords
	}
	return s
}

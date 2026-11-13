package main

// LA VIDEOLLAMADA SIEMPRE EN AUDIO: lo que se dice en una conversación queda en voz antes de abrir la llamada, sin
// botón. La primera vez que se abre la llamada de una conversación, la interfaz le pasa a este servidor la voz y el
// nombre de cada personaje (es la que sabe resolverla: su JSON, lo que se le cambió, la de su especie) y desde ahí:
//
//   - EN VIVO: cada mensaje que entra al chat se pasa a voz al momento, con la llamada abierta o cerrada. Si el chat
//     estuvo cerrado, lo que quedó en cola en el servidor del equipo entra al volver y se pasa a voz igual.
//   - HOY Y AYER: al abrir la llamada y al arrancar este servidor, se completa lo de hoy y lo de ayer (lo que falte; lo
//     ya guardado no se paga). De anteayer para atrás NO se pasa solo: una conversación de semanas no se paga entera
//     por abrirla, y en la línea de tiempo se ve en gris.
//   - UN DÍA VIEJO, AL ESCUCHARLO: si en la línea de tiempo se vuelve a un día sin audio y se le da play, la llamada
//     pide ese día desde ese mensaje (POST con `from`) y el servidor lo va bajando por delante de lo que suena, como
//     un video que carga; al llegar al día siguiente, la llamada pide ése.
//
// QUÉ SE DICE: las frases salen de la misma receta que usa la llamada (voice_text.go, la copia de
// chat/src/voiceText.js), y cada mensaje sincronizado queda anotado con su voz (voice-said.json): la llamada lo repite
// con ésa y encuentra cada frase ya guardada.
//
//	GET  /api/voice/sync?conversation=#oficina   {status, ready: [ids con todo su audio]}
//	PUT  /api/voice/sync  {conversation, maxWords, me, voices, names}   la llamada se abrió (o cambió una voz): en vivo, hoy y ayer
//	POST /api/voice/sync  {conversation, from, …}                       bajar el día de `from`, desde ese mensaje
//
//	event: voice-sync  data: {conversation, status}   cada avance (realtime.go)
//
// Gasta del mismo tope diario que la llamada (voice_budget.go); si se acaba, la fila se detiene y lo dice.

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

// syncConversation: lo que se guarda por conversación (voice-sync.json).
type syncConversation struct {
	On       bool              `json:"on"`
	MaxWords int               `json:"maxWords"` // el tope de palabras del perfil: lo más largo no se dice
	Me       string            `json:"me"`       // tu usuario: lo que mandan tus agentes sale como tuyo, con `via`
	Voices   map[string]string `json:"voices"`   // personaje → voz
	Names    map[string]string `json:"names"`    // personaje → nombre (las @menciones se dicen por el nombre)
	Since    string            `json:"since"`    // desde cuándo está en vivo
}

// syncStatus: cómo va (para la barra de la llamada).
type syncStatus struct {
	syncConversation
	Pending int    `json:"pending"` // mensajes en fila
	Spent   int    `json:"spent"`   // caracteres pagados desde que arrancó el servidor (lo ya guardado no cuenta)
	Error   string `json:"error,omitempty"`
}

type syncJob struct {
	conv, id, voice string
	lines           []string
}

var (
	syncMu     sync.Mutex
	syncState  = map[string]*syncStatus{}
	syncQueued = map[string]bool{} // id de mensaje → ya está en la fila (no se pone dos veces)
	syncQueue  = make(chan syncJob, 4096)
	syncOnce   sync.Once
)

func syncFile() string { return filepath.Join(voiceCacheDir(), "voice-sync.json") }

// loadSync trae lo guardado la primera vez y arranca la fila (con syncMu tomado).
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

// jobFor: lo que hay que generar de un mensaje (ok=false: nada que decir, o su personaje no tiene voz). La voz es la
// anotada si ya sonó (lo dicho no cambia de voz) o la de su personaje.
func jobFor(conv string, c syncConversation, m cli.Message, said map[string]string) (syncJob, bool) {
	key := speakerKey(m, c.Me)
	voice := said[m.ID]
	if voice == "" {
		voice = c.Voices[key]
	}
	if key == "" || voice == "" {
		return syncJob{}, false
	}
	lines := callLines(m, c.Names, c.MaxWords)
	if len(lines) == 0 {
		return syncJob{}, false
	}
	return syncJob{conv: conv, id: m.ID, voice: voice, lines: lines}, true
}

// ready: ¿están guardadas todas sus frases?
func (j syncJob) ready() bool {
	for _, l := range j.lines {
		if !voiceCached(j.voice, l) {
			return false
		}
	}
	return true
}

// dayOf: el día (hora local) de un mensaje, «2026-11-13».
func dayOf(m cli.Message) string {
	t, err := time.Parse(time.RFC3339Nano, m.Time)
	if err != nil {
		return ""
	}
	return t.Local().Format("2006-01-02")
}

// conversationMessages: los mensajes de una conversación, en orden.
func conversationMessages(conv string) []cli.Message {
	if chatHistory == nil {
		return nil
	}
	var out []cli.Message
	for _, m := range chatHistory.all() {
		if conversationOf(m) == conv {
			out = append(out, m)
		}
	}
	return out
}

// pendingJobs: lo que falta en audio de los mensajes dados (en orden), sin lo que ya está en la fila.
func pendingJobs(conv string, c syncConversation, messages []cli.Message) []syncJob {
	said := readSaidLocked()
	var out []syncJob
	for _, m := range messages {
		if j, ok := jobFor(conv, c, m, said); ok && !syncQueued[m.ID] && !j.ready() {
			out = append(out, j)
		}
	}
	return out
}

// recentDays: los mensajes de hoy y de ayer (hora local). Lo de anteayer para atrás no se pasa solo: queda para cuando
// se escuche (dayFrom).
func recentDays(all []cli.Message, now time.Time) []cli.Message {
	from := now.Local().AddDate(0, 0, -1).Format("2006-01-02")
	i := len(all)
	for i > 0 && dayOf(all[i-1]) >= from {
		i--
	}
	return all[i:]
}

// dayFrom: desde el mensaje `id` hasta el final de su día.
func dayFrom(all []cli.Message, id string) []cli.Message {
	for i, m := range all {
		if m.ID != id {
			continue
		}
		day, j := dayOf(m), i
		for j < len(all) && dayOf(all[j]) == day {
			j++
		}
		return all[i:j]
	}
	return nil
}

// queueJobs pone en la fila (con syncMu tomado) y avisa.
func queueJobs(conv string, jobs []syncJob) {
	s := syncState[conv]
	for _, j := range jobs {
		select {
		case syncQueue <- j:
			syncQueued[j.id] = true
			if s != nil {
				s.Pending++
			}
		default: // la fila está llena (algo en un bucle): éste se genera cuando la llamada lo pida
			if s != nil {
				s.Error = "demasiados mensajes en fila: algunos se generan al reproducirlos"
			}
		}
	}
	if len(jobs) > 0 {
		go publishSync(conv)
	}
}

// syncFresh: lo que acaba de entrar al historial, a la fila si su conversación está sincronizada.
func syncFresh(fresh []cli.Message) {
	syncMu.Lock()
	defer syncMu.Unlock()
	loadSync()
	byConv := map[string][]cli.Message{}
	for _, m := range fresh {
		conv := conversationOf(m)
		if s := syncState[conv]; s != nil && s.On {
			byConv[conv] = append(byConv[conv], m)
		}
	}
	for conv, ms := range byConv {
		queueJobs(conv, pendingJobs(conv, syncState[conv].syncConversation, ms))
	}
}

// syncCatchUp: al arrancar, cada conversación sincronizada completa hoy y ayer (lo que llegó mientras tanto entra
// por syncFresh; esto cubre lo que quedó a medias si el servidor se cerró en la mitad).
func syncCatchUp() {
	syncMu.Lock()
	defer syncMu.Unlock()
	loadSync()
	for conv, s := range syncState {
		if s.On {
			queueJobs(conv, pendingJobs(conv, s.syncConversation, recentDays(conversationMessages(conv), time.Now())))
		}
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
		delete(syncQueued, j.id)
		if s := syncState[j.conv]; s != nil {
			if s.Pending--; s.Pending < 0 {
				s.Pending = 0
			}
			s.Spent += spent
			if err != nil {
				s.Error = err.Error()
			} else if s.Pending == 0 {
				s.Error = ""
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
	var status syncStatus
	if s := syncState[conv]; s != nil {
		status = *s
	}
	syncMu.Unlock()
	events.publish("voice-sync", map[string]any{"conversation": conv, "status": status})
}

// readyIDs: los mensajes de la conversación que ya tienen todo su audio (con syncMu tomado).
func readyIDs(conv string, c syncConversation) []string {
	said := readSaidLocked()
	out := []string{}
	for _, m := range conversationMessages(conv) {
		if j, ok := jobFor(conv, c, m, said); ok && j.ready() {
			out = append(out, m.ID)
		}
	}
	return out
}

// readSaidLocked: las voces anotadas, con su candado.
func readSaidLocked() map[string]string {
	saidMu.Lock()
	defer saidMu.Unlock()
	return readSaid()
}

type syncRequest struct {
	Conversation string            `json:"conversation"`
	From         string            `json:"from"`
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
		conv := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("conversation")))
		syncMu.Lock()
		defer syncMu.Unlock()
		loadSync()
		s := syncState[conv]
		if s == nil {
			writeJSON(w, http.StatusOK, map[string]any{"status": syncStatus{}, "ready": []string{}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": *s, "ready": readyIDs(conv, s.syncConversation)})
	})
	// la llamada se abrió (o cambió una voz): queda en vivo y completa hoy y ayer
	mux.HandleFunc("PUT /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeSync(w, r)
		if !ok {
			return
		}
		syncMu.Lock()
		defer syncMu.Unlock()
		loadSync()
		s := upsertSync(req)
		if !s.On {
			s.On, s.Since = true, time.Now().UTC().Format(time.RFC3339)
		}
		saveSync()
		queueJobs(req.Conversation, pendingJobs(req.Conversation, s.syncConversation, recentDays(conversationMessages(req.Conversation), time.Now())))
		writeJSON(w, http.StatusOK, map[string]any{"status": *s})
	})
	// bajar un día viejo desde un mensaje (la línea de tiempo volvió atrás y le dio play)
	mux.HandleFunc("POST /api/voice/sync", func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeSync(w, r)
		if !ok {
			return
		}
		syncMu.Lock()
		defer syncMu.Unlock()
		loadSync()
		s := upsertSync(req)
		jobs := pendingJobs(req.Conversation, s.syncConversation, dayFrom(conversationMessages(req.Conversation), req.From))
		queueJobs(req.Conversation, jobs)
		writeJSON(w, http.StatusOK, map[string]any{"status": *s, "queued": len(jobs)})
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

package main

// LOS EFECTOS DE SONIDO DE LA VIDEOLLAMADA: un catálogo fijo (acá abajo), generado con ElevenLabs (connectors/elevenlabs,
// SoundEffect) la primera vez que se pide cada uno y guardado para siempre junto a las voces (sfx-<nombre>.mp3). La
// interfaz sólo pide por nombre: no puede inventar un sonido y gastar créditos. Cuestan ~10 créditos por segundo (medido
// el 2026-11-12); el catálogo entero, ~35 s, unos 350 créditos una sola vez.
//
//	GET /api/sfx            los nombres del catálogo y cuáles ya están guardados
//	GET /api/sfx/{name}     el MP3 (lo genera si todavía no está)
//
// Para cambiar un sonido: se cambia su descripción acá y se borra su archivo; el próximo pedido lo vuelve a generar.

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"creditop/my-tools/connectors/elevenlabs"
)

type sfxSpec struct {
	Text    string  // qué suena (en inglés: el modelo lo entiende mejor)
	Seconds float64 // cuánto dura
	Loop    bool    // si empalma consigo mismo (fondos)
}

var sfxCatalog = map[string]sfxSpec{
	"join":       {"soft friendly two-note video call join chime, warm and short", 1.5, false},
	"leave":      {"soft descending two-note video call leave chime, warm and short", 1.5, false},
	"lid-close":  {"laptop lid closing gently, soft muffled click", 1, false},
	"lid-open":   {"laptop lid opening, soft click and gentle hinge", 1, false},
	"sip":        {"a person taking a quiet sip of hot coffee from a ceramic mug, then setting the mug down softly", 2.5, false},
	"headphones": {"faint lo-fi music leaking from headphones, muffled and quiet", 6, true},
	"mention":    {"short soft notification pop", 0.6, false},
	"paper":      {"a single sheet of paper handed over, soft rustle", 1.2, false},
	"photo":      {"soft camera shutter click", 0.8, false},
	"keys":       {"a small bunch of keys jingling briefly", 1.2, false},
	"ambient":    {"quiet modern office room tone, distant soft keyboard typing, gentle air conditioning hum", 15, true},
}

var sfxMu sync.Mutex // de a uno: dos pedidos del mismo sonido no lo generan (ni lo pagan) dos veces

func sfxFile(name string) string { return filepath.Join(voiceCacheDir(), "sfx-"+name+".mp3") }

func sfxEnsure(name string) (string, error) {
	spec, ok := sfxCatalog[name]
	if !ok {
		return "", errors.New("ese sonido no está en el catálogo")
	}
	file := sfxFile(name)
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	sfxMu.Lock()
	defer sfxMu.Unlock()
	if _, err := os.Stat(file); err == nil { // otro pedido lo generó mientras se esperaba
		return file, nil
	}
	cfg, err := elevenlabs.LoadConfig()
	if err != nil {
		return "", err
	}
	audio, err := elevenlabs.New(cfg).SoundEffect(spec.Text, spec.Seconds, spec.Loop)
	if err != nil {
		return "", elevenFriendly(err)
	}
	if err := os.MkdirAll(voiceCacheDir(), 0o755); err != nil {
		return "", err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, audio, 0o644); err != nil {
		return "", err
	}
	return file, os.Rename(tmp, file)
}

func registerSfx(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sfx", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]bool{}
		for name := range sfxCatalog {
			_, err := os.Stat(sfxFile(name))
			out[name] = err == nil
		}
		writeJSON(w, http.StatusOK, map[string]any{"sfx": out})
	})
	mux.HandleFunc("GET /api/sfx/{name}", func(w http.ResponseWriter, r *http.Request) {
		file, err := sfxEnsure(r.PathValue("name"))
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		http.ServeFile(w, r, file)
	})
}

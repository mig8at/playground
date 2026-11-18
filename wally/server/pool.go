package main

// EL POOL: todas las preguntas a AI Studio pasan por un solo proceso de Node (jarvis/recipes/aistudio/pool.ts), que
// tiene la única conexión a Chrome que acepta el puente de Jarvis y reparte las preguntas en pestañas, hasta 2 a la
// vez y escalonadas. Acá se arranca la primera vez que hace falta, se le manda cada pregunta como una línea JSON con
// su id y se espera la línea de respuesta con ese id. Si el proceso se cae, lo que esperaba falla con el porqué y el
// próximo pedido lo vuelve a arrancar.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type poolAnswer struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Answer string `json:"answer"`
	// URL: el chat donde quedó la respuesta (DeepSeek, ChatGPT, AI Studio): la próxima pregunta sigue ahí.
	URL    string `json:"url"`
	Format string `json:"format"`
	Model  string `json:"model"`
	Ms     int64  `json:"ms"`
	Error  string `json:"error"`
	Paused bool   `json:"paused"`
	Until  int64  `json:"until"`
	// Check: la respuesta de un `{"type": "check"}` (check.ts): proveedor → estado.
	Check map[string]ProviderCheck `json:"check"`
}

// ProviderCheck: lo que vio el chequeo de un proveedor, sin preguntar nada.
type ProviderCheck struct {
	State  string `json:"state"` // listo · sin-sesion · error
	Detail string `json:"detail"`
	Ms     int64  `json:"ms"`
}

type pool struct {
	root    string
	mu      sync.Mutex
	stdin   io.WriteCloser
	waiting map[string]chan poolAnswer
	seq     int
}

// errPaused: Google cortó y la cuenta está en pausa; quien pregunta puede esperar y volver.
type errPaused struct {
	until time.Time
	msg   string
}

func (e errPaused) Error() string { return e.msg }

func (p *pool) start() error {
	cmd := exec.Command("node", filepath.Join(p.root, "jarvis", "recipes", "aistudio", "pool.ts"))
	cmd.Dir = p.root
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("no pude arrancar el pool de AI Studio: %v", err)
	}
	p.stdin = in
	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			log.Print(sc.Text())
		}
	}()
	go func() {
		sc := bufio.NewScanner(out)
		sc.Buffer(make([]byte, 1<<20), 64<<20)
		for sc.Scan() {
			var a poolAnswer
			if json.Unmarshal(sc.Bytes(), &a) != nil {
				continue
			}
			p.mu.Lock()
			ch := p.waiting[a.ID]
			delete(p.waiting, a.ID)
			p.mu.Unlock()
			if ch != nil {
				ch <- a
			}
		}
		err := cmd.Wait()
		// Se cayó: lo que esperaba falla, y el próximo pedido lo arranca de nuevo.
		p.mu.Lock()
		for id, ch := range p.waiting {
			ch <- poolAnswer{ID: id, Error: fmt.Sprintf("el pool de AI Studio se cerró (%v)", err)}
		}
		p.waiting = map[string]chan poolAnswer{}
		p.stdin = nil
		p.mu.Unlock()
		log.Printf("wally: el pool de AI Studio terminó: %v", err)
	}()
	return nil
}

// poolJob: una pregunta para el pool, con su proveedor y sus opciones (de la configuración de Wally).
type poolJob struct {
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	Text         string `json:"text"`
	Thinking     string `json:"thinking,omitempty"`
	DeepThink    bool   `json:"deepThink"`
	Search       bool   `json:"search"`
	ChatGPTThink bool   `json:"chatgptThink"`
	GroqModel    string `json:"groqModel,omitempty"`
	Window       string `json:"window,omitempty"`
	// ChatURL: seguir ese chat (sólo lo nuevo) en vez de abrir uno.
	ChatURL string `json:"chatUrl,omitempty"`
	// Chunk: de a cuánto partir lo que no entra en un mensaje (wally/providers.json); 0 = no se parte.
	Chunk int `json:"chunk,omitempty"`
}

// send le manda una línea al pool y espera su respuesta (o que se cancele el contexto).
func (p *pool) send(ctx context.Context, msg map[string]any) (poolAnswer, error) {
	p.mu.Lock()
	if p.waiting == nil {
		p.waiting = map[string]chan poolAnswer{}
	}
	if p.stdin == nil {
		if err := p.start(); err != nil {
			p.mu.Unlock()
			return poolAnswer{}, err
		}
	}
	p.seq++
	id := fmt.Sprintf("q%d-%d", time.Now().Unix(), p.seq)
	ch := make(chan poolAnswer, 1)
	p.waiting[id] = ch
	msg["id"] = id
	line, _ := json.Marshal(msg)
	_, err := p.stdin.Write(append(line, '\n'))
	p.mu.Unlock()
	if err != nil {
		return poolAnswer{}, fmt.Errorf("no pude hablarle al pool de AI Studio: %v", err)
	}
	select {
	case a := <-ch:
		return a, nil
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.waiting, id)
		p.mu.Unlock()
		return poolAnswer{}, errors.New("el pool no contestó a tiempo")
	}
}

// check le pide al pool que mire si cada proveedor está listo, sin preguntar nada.
func (p *pool) check(ctx context.Context, window string) (map[string]ProviderCheck, error) {
	a, err := p.send(ctx, map[string]any{"type": "check", "window": window})
	if err != nil {
		return nil, err
	}
	if !a.OK {
		return nil, errors.New(strings.TrimSpace(a.Error))
	}
	return a.Check, nil
}

// ask le manda una pregunta al pool y espera su respuesta (o que se cancele el contexto).
func (p *pool) ask(ctx context.Context, job poolJob) (string, string, error) {
	p.mu.Lock()
	if p.waiting == nil {
		p.waiting = map[string]chan poolAnswer{}
	}
	if p.stdin == nil {
		if err := p.start(); err != nil {
			p.mu.Unlock()
			return "", "", err
		}
	}
	p.seq++
	id := fmt.Sprintf("q%d-%d", time.Now().Unix(), p.seq)
	ch := make(chan poolAnswer, 1)
	p.waiting[id] = ch
	line, _ := json.Marshal(map[string]any{"id": id, "provider": job.Provider, "model": job.Model, "text": job.Text,
		"thinking": job.Thinking, "deepThink": job.DeepThink, "search": job.Search, "chatgptThink": job.ChatGPTThink, "groqModel": job.GroqModel, "window": job.Window, "chatUrl": job.ChatURL, "chunk": job.Chunk, "timeout": 600})
	_, err := p.stdin.Write(append(line, '\n'))
	p.mu.Unlock()
	if err != nil {
		return "", "", fmt.Errorf("no pude hablarle al pool de AI Studio: %v", err)
	}
	select {
	case a := <-ch:
		if a.OK {
			return a.Answer, a.URL, nil
		}
		msg := strings.TrimSpace(a.Error)
		if msg == "" {
			msg = "AI Studio no contestó"
		}
		if a.Paused {
			return "", "", errPaused{until: time.UnixMilli(a.Until), msg: msg}
		}
		return "", "", errors.New(msg)
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.waiting, id)
		p.mu.Unlock()
		return "", "", errors.New("AI Studio no contestó a tiempo")
	}
}

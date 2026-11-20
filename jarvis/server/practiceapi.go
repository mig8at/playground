package main

/* LA API DE LAS APPS DE PRÁCTICA: una app con `"api": true` en su app.json recibe, en su mismo puerto, una API JSON
 * chica y en memoria —como el backend de un admin de verdad—:
 *
 *	GET    /api/<colección>          la lista
 *	POST   /api/<colección>          crea (el cuerpo JSON; le pone `id`) · DELETE /api/<colección> la vacía
 *	GET    /api/<colección>/<id>     uno · PUT lo reemplaza (conserva el id) · DELETE lo borra
 *
 * Existe para practicar lo que hace un admin real por la red: grabar un flujo, ver sus pedidos (bin/jarvis network) y
 * convertirlo en una receta que los repite sin clics (recipes/api-from-flow.ts). Las otras apps de práctica guardan
 * todo en el navegador y no tienen red que aprender. Se pierde al reiniciar el servidor (a propósito: es práctica). */

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type practiceAPI struct {
	mu   sync.Mutex
	seq  int
	data map[string]map[string]map[string]any // colección → id → objeto
}

func newPracticeAPI() *practiceAPI { return &practiceAPI{data: map[string]map[string]map[string]any{}} }

func (p *practiceAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		writeErr(w, http.StatusNotFound, errNotFound)
		return
	}
	col := parts[0]
	p.mu.Lock()
	defer p.mu.Unlock()
	items := p.data[col]
	if items == nil {
		items = map[string]map[string]any{}
		p.data[col] = items
	}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			list := make([]map[string]any, 0, len(items))
			for _, it := range items {
				list = append(list, it)
			}
			sort.Slice(list, func(i, j int) bool { return idNum(list[i]) < idNum(list[j]) })
			writeJSON(w, http.StatusOK, list)
		case http.MethodPost:
			var it map[string]any
			if err := json.NewDecoder(r.Body).Decode(&it); err != nil || it == nil {
				writeErr(w, http.StatusBadRequest, errBadJSON)
				return
			}
			p.seq++
			it["id"] = p.seq
			items[strconv.Itoa(p.seq)] = it
			writeJSON(w, http.StatusCreated, it)
		case http.MethodDelete:
			p.data[col] = map[string]map[string]any{}
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		default:
			writeErr(w, http.StatusMethodNotAllowed, errMethod)
		}
		return
	}
	id := parts[1]
	it, found := items[id]
	switch r.Method {
	case http.MethodGet:
		if !found {
			writeErr(w, http.StatusNotFound, errNotFound)
			return
		}
		writeJSON(w, http.StatusOK, it)
	case http.MethodPut:
		if !found {
			writeErr(w, http.StatusNotFound, errNotFound)
			return
		}
		var nw map[string]any
		if err := json.NewDecoder(r.Body).Decode(&nw); err != nil || nw == nil {
			writeErr(w, http.StatusBadRequest, errBadJSON)
			return
		}
		nw["id"] = it["id"]
		items[id] = nw
		writeJSON(w, http.StatusOK, nw)
	case http.MethodDelete:
		if !found {
			writeErr(w, http.StatusNotFound, errNotFound)
			return
		}
		delete(items, id)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeErr(w, http.StatusMethodNotAllowed, errMethod)
	}
}

func idNum(m map[string]any) float64 {
	switch v := m["id"].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}

type apiErr string

func (e apiErr) Error() string { return string(e) }

const (
	errNotFound apiErr = "no existe"
	errBadJSON  apiErr = "el cuerpo tiene que ser un objeto JSON"
	errMethod   apiErr = "método no permitido"
)

package main

/* `-canon`: el CONTEXTO de canon para la tarea que se retoma — secciones enteras, no fichas.
 *
 * La ficha (`-brief`) dice qué tema abrir; esto trae lo que el tema dice, elegido por el título de la
 * tarea dentro de los temas que declara y cortado a un presupuesto de bytes. Sale de `/api/context`, que
 * NO pasa por ningún modelo: es selección léxica, y canon lo aclara en su `nota`. ⛔ Nada de `/api/ask`
 * (decisión de Miguel, 2026-09-27: desde el playground canon se lee, no se le pregunta).
 *
 * ⚠ Los temas declarados se validan contra la copia local de canon ANTES de pedir: canon ignora en
 * silencio un tema que no existe —200, cero secciones, `faltantes: []`, medido el 2026-09-27 con `motai`
 * y `altas`—, así que sin esto «no trajo nada» se lee igual que «canon no sabe». Ese día había 12
 * declaraciones así en tareas abiertas. */

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

// canonContextBytes es el presupuesto por defecto: unas tres secciones largas. Lo que no entra queda
// en `Pending`, con el comando para leerlo.
const canonContextBytes = 12000

// taskCanonContext es lo que `-canon` agrega a la retoma.
type taskCanonContext struct {
	Topics  []string              `json:"topics"`            // los que se mandaron a canon
	Unknown []string              `json:"unknown,omitempty"` // declarados que canon no tiene
	Query   string                `json:"query"`
	Package *canon.ContextPackage `json:"package,omitempty"`
	Error   string                `json:"error,omitempty"`
	Offline bool                  `json:"offline,omitempty"` // sin copia local: no se pudo validar
	Skipped bool                  `json:"skipped,omitempty"` // sin temas válidos ni consulta propia: no se buscó
}

// topicOf: `kyc`, `kyc/context` o `kyc/context#ancla` → `kyc`.
func topicOf(ref string) string {
	ref = strings.SplitN(ref, "#", 2)[0]
	return strings.SplitN(ref, "/", 2)[0]
}

/* buildCanonContext separa los temas declarados en conocidos y desconocidos (known=nil: no hay copia
 * local, se mandan todos y se avisa) y pide el paquete. Con una consulta propia y ningún tema válido, la
 * búsqueda va al corpus entero, y eso queda dicho en `Topics` vacío. */
func buildCanonContext(declared []string, query string, explicit bool, known map[string]bool, maxBytes int,
	fetch func(canon.ContextRequest) (canon.ContextPackage, error)) taskCanonContext {
	out := taskCanonContext{Query: query, Offline: known == nil}
	seen := map[string]bool{}
	for _, ref := range declared {
		topic := topicOf(ref)
		if topic == "" || seen[topic] {
			continue
		}
		seen[topic] = true
		if known != nil && !known[topic] {
			out.Unknown = append(out.Unknown, topic)
			continue
		}
		out.Topics = append(out.Topics, topic)
	}
	// Sin ningún tema válido NO se busca en todo el corpus: con el título de una tarea de herramientas
	// («Tablero») eso trajo áreas de comercios y entidades, ruido con buena puntuación. Se busca sólo si
	// quien retoma dio su propia consulta (`explicit`).
	if len(out.Topics) == 0 && !explicit {
		out.Skipped = true
		return out
	}
	req := canon.ContextRequest{Q: query, MaxBytes: maxBytes}
	for _, t := range out.Topics {
		req.Topics = append(req.Topics, t+"/context")
	}
	pkg, err := fetch(req)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.Package = &pkg
	return out
}

func contextFromCanon(client *canon.Client) func(canon.ContextRequest) (canon.ContextPackage, error) {
	return func(req canon.ContextRequest) (canon.ContextPackage, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return client.Context(ctx, req)
	}
}

// sectionBody: el texto de una sección sin el comentario HTML con que canon abre cada una.
func sectionBody(text string) string {
	text = strings.TrimSpace(text)
	for strings.HasPrefix(text, "<!--") {
		end := strings.Index(text, "-->")
		if end < 0 {
			break
		}
		text = strings.TrimSpace(text[end+3:])
	}
	// y sin el `## título` con que abre: ya va en la cabecera del ítem.
	if strings.HasPrefix(text, "#") {
		if nl := strings.Index(text, "\n"); nl >= 0 {
			text = strings.TrimSpace(text[nl+1:])
		} else {
			text = ""
		}
	}
	return text
}

func printCanonContext(c taskCanonContext) {
	fmt.Println("\n  ── Canon: el contexto de la tarea (secciones enteras, sin modelo) ──")
	if len(c.Unknown) > 0 {
		fmt.Printf("  ⚠ la tarea declara temas que canon NO tiene: %s — corregí `canon:` (make canon-mapa los lista)\n", strings.Join(c.Unknown, ", "))
	}
	if c.Offline {
		fmt.Println("  ⚠ no hay copia local de canon para validar los temas declarados (se arma al iniciar una sesión)")
	}
	if c.Skipped {
		fmt.Println("  ✗ la tarea no declara ningún tema de canon que exista, así que no se buscó: el título de una tarea")
		fmt.Println("    no es una pregunta. Con palabras del negocio: make canon-search Q='…', o CANON_Q='…' acá.")
		return
	}
	scope := "en todo el corpus (con la consulta dada; la tarea no declara temas que existan)"
	if len(c.Topics) > 0 {
		scope = "dentro de " + strings.Join(c.Topics, ", ")
	}
	fmt.Printf("  buscado por «%s», %s\n", truncate(c.Query, 60), scope)
	if c.Error != "" {
		fmt.Printf("  ✗ %s\n", c.Error)
		return
	}
	p := c.Package
	if len(p.Sections) == 0 {
		fmt.Println("  ✗ ninguna sección. El silencio de canon no es «no existe»: la pregunta va al código de main.")
		return
	}
	for _, s := range p.Sections {
		if s.Area != nil {
			printCanonArea(s)
			continue
		}
		fmt.Printf("\n  ▌ %s  ·  %s", s.Title, s.ID)
		if s.Verified != "" {
			fmt.Printf("  ·  verificada %s", s.Verified)
		}
		fmt.Println()
		for _, line := range strings.Split(sectionBody(s.Text), "\n") {
			fmt.Println("  " + line)
		}
		for _, b := range s.Backing {
			fmt.Printf("    ↳ %s\n", fit(b.Goal, 92, "      "))
		}
	}
	if len(p.Pending) > 0 {
		fmt.Printf("\n  no entraron en %d B (%d más): make canon-read IDS='%s'\n", p.MaxBytes, len(p.Pending), strings.Join(p.Pending, ","))
	}
	if p.Note != "" {
		fmt.Println("  " + fit(p.Note, 96, "  "))
	}
}

// printCanonArea: un área de código no trae prosa — trae qué pregunta contesta, dónde está el código y qué
// secciones sostiene, que son las que hay que leer.
func printCanonArea(s canon.ContextSection) {
	fmt.Printf("\n  ▌ código · %s  ·  %s\n", fit(s.Area.Goal, 80, "    "), s.ID)
	repos := make([]string, 0, len(s.Files))
	for repo := range s.Files {
		repos = append(repos, repo)
	}
	sort.Strings(repos)
	for _, repo := range repos {
		fmt.Printf("    %s: %s\n", repo, fit(strings.Join(s.Files[repo], ", "), 88, "      "))
	}
	var ids []string
	for _, sup := range s.Supports {
		fmt.Printf("    sostiene «%s»\n", sup.Section)
		ids = append(ids, sup.Read)
	}
	if len(ids) > 0 {
		fmt.Printf("    make canon-read IDS='%s'\n", strings.Join(ids, ","))
	}
}

/* taskQuery: con qué texto se busca. El título solo es mala consulta léxica —lleva el nombre interno de
 * la tarea, no las palabras del negocio—: medido el 2026-09-27 en `abaco-lender-requirements`, el título
 * encontró 1 área de código y título + «En una línea» encontró 7 secciones sobre ingresos. Se suma la
 * primera que haya de «En una línea» (la publicable, 10 de 27 abiertas) u «Objetivo» (7 de 27). */
func taskQuery(t task) string {
	for _, heading := range []string{"## En una línea", "## Objetivo"} {
		if text := sectionText(t.Body, heading); text != "" {
			return t.Title + " " + text
		}
	}
	return t.Title
}

// sectionText: el primer párrafo bajo un encabezado `##`, en una línea.
func sectionText(body, heading string) string {
	var lines []string
	in := false
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			if in {
				break
			}
			in = strings.HasPrefix(trimmed, heading)
			continue
		}
		if !in {
			continue
		}
		if trimmed == "" && len(lines) > 0 {
			break
		}
		if trimmed != "" && !strings.HasPrefix(trimmed, "<!--") {
			lines = append(lines, trimmed)
		}
	}
	return strings.Join(lines, " ")
}

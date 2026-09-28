package main

/* `-canon`: el CONTEXTO de canon para la tarea que se retoma — secciones enteras, no fichas.
 *
 * La ficha (`-brief`) dice qué tema abrir; esto trae lo que el tema dice, elegido por el título y el
 * resumen de la tarea dentro de los temas que declara y cortado a un presupuesto de bytes. Se lee de la
 * COPIA LOCAL de canon (`tablero/canon`, al día con su ETag): desde el 2026-09-27 canon ya
 * no sirve `/api/context` —el único cliente remoto es Credibot— y leer archivos es más rápido que la red.
 *
 * ⚠ Un tema declarado que la copia no tiene se AVISA: sin eso, «no trajo nada» se lee igual que «canon
 * no sabe» (medido el 2026-09-27: 12 declaraciones de temas inexistentes en tareas abiertas). */

import (
	"fmt"
	"path/filepath"
	"strings"

	"creditop/playground/tablero/server/internal/canoncache"
)

// canonContextBytes es el presupuesto por defecto: unas tres secciones largas. Lo que no entra queda
// en `Pending`, con su cita.
const canonContextBytes = 12000

// taskCanonContext es lo que `-canon` agrega a la retoma.
type taskCanonContext struct {
	Topics   []string                  `json:"topics"`            // donde se buscó
	Unknown  []string                  `json:"unknown,omitempty"` // declarados que la copia no tiene
	Query    string                    `json:"query"`
	Sections []canoncache.LocalSection `json:"sections,omitempty"`
	Pending  []string                  `json:"pending,omitempty"`
	MaxBytes int                       `json:"maxBytes"`
	Offline  bool                      `json:"offline,omitempty"` // no hay copia local
	Skipped  bool                      `json:"skipped,omitempty"` // sin temas válidos ni consulta propia: no se buscó
	Mirror   *canoncache.Manifest      `json:"mirror,omitempty"`
}

// topicOf: `kyc`, `kyc/context` o `kyc/context#ancla` → `kyc`.
func topicOf(ref string) string {
	ref = strings.SplitN(ref, "#", 2)[0]
	return strings.SplitN(ref, "/", 2)[0]
}

// allTopics: los temas que tiene la copia, para buscar en todo el corpus cuando se da una consulta propia.
func allTopics(dir string) []string {
	files, _ := filepath.Glob(filepath.Join(dir, "content", "*", "context.md"))
	var out []string
	for _, f := range files {
		out = append(out, filepath.Base(filepath.Dir(f)))
	}
	return out
}

/* buildCanonContext separa los temas declarados en los que la copia tiene y los que no, y elige las
 * secciones. Sin ningún tema válido NO busca en todo el corpus —el título de una tarea de herramientas
 * trajo ruido de comercios y entidades—, salvo que quien retoma dé su propia consulta (`explicit`). */
func buildCanonContext(declared []string, query string, explicit bool, dir string, maxBytes int) taskCanonContext {
	out := taskCanonContext{Query: query, MaxBytes: maxBytes}
	m, ok := canoncache.LoadMirror(dir)
	if !ok {
		out.Offline = true
		return out
	}
	out.Mirror = &m
	seen := map[string]bool{}
	for _, ref := range declared {
		topic := topicOf(ref)
		if topic == "" || seen[topic] {
			continue
		}
		seen[topic] = true
		if !canoncache.HasTopic(dir, topic) {
			out.Unknown = append(out.Unknown, topic)
			continue
		}
		out.Topics = append(out.Topics, topic)
	}
	scope := out.Topics
	if len(scope) == 0 {
		if !explicit {
			out.Skipped = true
			return out
		}
		scope = allTopics(dir)
	}
	out.Sections, out.Pending, _ = canoncache.SelectContext(dir, scope, query, maxBytes)
	return out
}

func printCanonContext(c taskCanonContext) {
	fmt.Println("\n  ── Canon: el contexto de la tarea (secciones enteras, de la copia local) ──")
	if c.Offline {
		fmt.Println("  ✗ no hay copia local de canon: se arma al iniciar una sesión, o con `make canon-mapa` (VPN de prod)")
		return
	}
	if len(c.Unknown) > 0 {
		fmt.Printf("  ⚠ la tarea declara temas que canon NO tiene: %s — corregí `canon:` (make canon-mapa los lista)\n", strings.Join(c.Unknown, ", "))
	}
	if c.Skipped {
		fmt.Println("  ✗ la tarea no declara ningún tema de canon que exista, así que no se buscó: el título de una tarea")
		fmt.Println("    no es una pregunta. Con palabras del negocio: grep en la copia, o CANON_Q='…' acá.")
		return
	}
	scope := "en todo el corpus (con la consulta dada; la tarea no declara temas que existan)"
	if len(c.Topics) > 0 {
		scope = "dentro de " + strings.Join(c.Topics, ", ")
	}
	fmt.Printf("  buscado por «%s», %s · copia del %s\n", truncate(c.Query, 60), scope, c.Mirror.SyncedAt.Local().Format("2006-01-02 15:04"))
	if len(c.Sections) == 0 {
		fmt.Println("  ✗ ninguna sección. El silencio de canon no es «no existe»: la pregunta va al código de main.")
		return
	}
	for _, s := range c.Sections {
		fmt.Printf("\n  ▌ %s  ·  %s\n", s.Title, s.ID)
		for _, line := range strings.Split(s.Text, "\n") {
			fmt.Println("  " + line)
		}
	}
	if len(c.Pending) > 0 {
		fmt.Printf("\n  no entraron en %d B (%d más, por puntaje): %s\n", c.MaxBytes, len(c.Pending), strings.Join(c.Pending, " · "))
		fmt.Printf("  se leen en %s\n", filepath.Join("tablero/canon/content", "<tema>", "context.md"))
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

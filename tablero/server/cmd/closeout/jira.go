package main

// jira.go — ¿cada issue mío del tablero visual tiene su documento local?
//
// El tablero lista los issues de Jira asignados a mí en los últimos sprints, y les pinta el documento de
// la tarea local que los nombra en `jira:` (store.go: el vínculo clave → tarea). Si ninguna los nombra,
// el centro queda vacío aunque el trabajo esté documentado en otra carpeta. Pasó el 2026-10-20: CORE-752
// vivía en `auto-ecommerce` (que sólo nombraba CORE-731) y CORE-757 en `ajuste-nombres-onboarding-v1-v2`,
// que lo citaba en su pila con `jira: []`. Nada avisaba: el issue se crea en Jira DESPUÉS que la tarea, y
// nadie vuelve a tocar el frontmatter.
//
// Dos severidades, por la misma razón que el resto del cierre (un aviso que reclama de más se ignora):
//
//	✗ el issue se NOMBRA en el documento o la pila de una tarea, pero no está en su `jira:` — el vínculo
//	  falta seguro y se arregla con una línea. Hace salir 1.
//	▲ ninguna tarea lo nombra — puede ser trabajo sin empezar, o documentado sin la clave. Se mira, no frena.

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/atlassian"
	"creditop/playground/tablero/server/internal/layout"
)

// jiraSprints: los mismos que pinta el tablero (SPRINT_TABS en App.vue).
const jiraSprints = 4

type MyIssue struct {
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

// UnlinkedIssue: un issue mío que el tablero muestra sin documento.
type UnlinkedIssue struct {
	MyIssue
	MentionedIn []string `json:"mentionedIn,omitempty"` // slugs que lo nombran sin tenerlo en `jira:`
}

// myRecentIssues trae mis issues de los últimos sprints del board, sin repetir los que arrastra.
func myRecentIssues() ([]MyIssue, error) {
	cfg, err := atlassian.LoadConfig()
	if err != nil {
		return nil, err
	}
	c := atlassian.NewFromConfig(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	board := 384
	if v := os.Getenv("JIRA_BOARD_ID"); v != "" {
		fmt.Sscan(v, &board)
	}
	sprints, err := c.RecentSprints(ctx, board, jiraSprints)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []MyIssue
	for _, sp := range sprints {
		iss, err := c.MySprintIssues(ctx, sp.ID)
		if err != nil {
			return nil, err
		}
		for _, it := range iss {
			if !seen[it.Key] {
				seen[it.Key] = true
				out = append(out, MyIssue{Key: it.Key, Summary: it.Summary, Status: it.Status})
			}
		}
	}
	return out, nil
}

// taskText: el documento y la pila de una tarea, donde se busca si nombra un issue.
func taskText(data string, t task) string {
	b, _ := os.ReadFile(layout.At(data).ContextPath(t.Slug))
	return t.Body + "\n" + string(b)
}

// unlinkedIssues es la parte que no toca red: cruza los issues con las tareas (y su texto).
func unlinkedIssues(issues []MyIssue, tasks []task, text map[string]string) []UnlinkedIssue {
	linked := map[string]bool{}
	for _, t := range tasks {
		for _, k := range t.Jira {
			linked[k] = true
		}
	}
	var out []UnlinkedIssue
	for _, is := range issues {
		if linked[is.Key] {
			continue
		}
		// la clave entera: CORE-75 no es CORE-752
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(is.Key) + `\b`)
		u := UnlinkedIssue{MyIssue: is}
		for _, t := range tasks {
			if re.MatchString(text[t.Slug]) {
				u.MentionedIn = append(u.MentionedIn, t.Slug)
			}
		}
		sort.Strings(u.MentionedIn)
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key > out[j].Key })
	return out
}

func printUnlinked(us []UnlinkedIssue) {
	var named, alone []UnlinkedIssue
	for _, u := range us {
		if len(u.MentionedIn) > 0 {
			named = append(named, u)
		} else {
			alone = append(alone, u)
		}
	}
	if len(named) > 0 {
		fmt.Println("  ✗ issues míos que una tarea nombra pero no tiene en `jira:` (el tablero los muestra sin documento):")
		for _, u := range named {
			fmt.Printf("    · %s %s — agregalo al `jira:` de %s\n", u.Key, u.Summary, strings.Join(u.MentionedIn, " o "))
		}
		fmt.Println()
	}
	if len(alone) > 0 {
		fmt.Println("  ▲ issues míos sin tarea local (ninguna los nombra): si el trabajo está documentado, sumalo a su `jira:`")
		for _, u := range alone {
			fmt.Printf("    · %s %s («%s»)\n", u.Key, u.Summary, u.Status)
		}
		fmt.Println()
	}
}

func unlinkedFailures(us []UnlinkedIssue) int {
	n := 0
	for _, u := range us {
		if len(u.MentionedIn) > 0 {
			n++
		}
	}
	return n
}

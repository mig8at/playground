// Package daily arma LO QUE MIGUEL DICE EN LA DAILY (Miguel, 2026-11-18: «qué se hizo durante el día, quitando todo
// lo de my-tools; muy simple de leer, para decirlo al día siguiente»). Sale de la bitácora (`data/entries`, lo que se
// registró con minutos medidos), por tarea, y la escribe el modelo de segundo plano (lib/background: Claude por defecto)
// en primera persona y pocas líneas. Queda en `data/daily/<día>.md`, fuera de git, y el tablero la muestra en el home.
//
// QUÉ ENTRA: las entradas de tareas de CreditOp y del playground compartido. QUÉ NO: las de nivel `miguel` (my-tools y
// sus herramientas: Sentinel, Wally, Goldfish…) y las que no tienen tarea (no se sabe de qué son). Sólo lo REGISTRADO:
// lo que no se anotó no aparece, y el modelo tiene prohibido inventar.
package daily

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/my-tools/lib/background"
	"creditop/my-tools/tablero/server/internal/agenda"
	"creditop/my-tools/tablero/server/internal/layout"
	"creditop/my-tools/tablero/server/internal/store"
)

// Note: una entrada de la bitácora, sin lo que es de la medición.
type Note struct {
	Title   string
	Text    string
	Minutes int
}

// Item: lo de una tarea en el día.
type Item struct {
	Slug, Title string
	Jira        []string
	Notes       []Note
	Minutes     int
}

// Input: lo que se le pasa al modelo, y lo que quedó afuera (para decirlo, no para contarlo).
type Input struct {
	Day         string
	Items       []Item
	MinutesOut  int // de tareas de nivel `miguel` y sin tarea
	MinutesIn   int
	EntriesSeen int
}

// Gather junta las entradas de `day` por tarea, sin las de my-tools.
func Gather(st *store.Store, lay layout.Layout, day string) (Input, error) {
	in := Input{Day: day}
	entries, err := st.List(400, 0)
	if err != nil {
		return in, err
	}
	refs := map[int64]store.EffortRef{}
	for _, r := range st.EffortsAll() {
		refs[r.ID] = r
	}
	jira := map[string][]string{}
	for _, t := range agenda.LoadTasks(lay) {
		jira[t.Slug] = t.Jira
	}
	bySlug := map[string]*Item{}
	var order []string
	// List viene de la más nueva a la más vieja: se recorre al revés para contar el día en orden.
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		if e.Day != day {
			continue
		}
		in.EntriesSeen++
		r, ok := refs[e.EffortID]
		if !ok || e.EffortID == 0 || r.Level == "miguel" {
			in.MinutesOut += e.Minutes
			continue
		}
		it := bySlug[r.Slug]
		if it == nil {
			it = &Item{Slug: r.Slug, Title: r.Title, Jira: jira[r.Slug]}
			bySlug[r.Slug] = it
			order = append(order, r.Slug)
		}
		it.Notes = append(it.Notes, Note{Title: e.FreeTitle, Text: cleanNote(e.Note), Minutes: e.Minutes})
		it.Minutes += e.Minutes
		in.MinutesIn += e.Minutes
	}
	for _, s := range order {
		in.Items = append(in.Items, *bySlug[s])
	}
	// Lo que más tiempo llevó, primero: es lo que más hay que contar.
	sort.SliceStable(in.Items, func(i, j int) bool { return in.Items[i].Minutes > in.Items[j].Minutes })
	return in, nil
}

// cleanNote: sin la línea de cómo se midieron los minutos (no es parte de lo hecho).
func cleanNote(n string) string {
	if i := strings.Index(n, "\n\nMINUTOS"); i >= 0 {
		n = n[:i]
	}
	return strings.TrimSpace(n)
}

// System: cómo tiene que escribir. Probado el 2026-11-18 con el registro de ese día: 5 renglones, en 7 s.
const System = `Escribís lo que Miguel va a decir en la daily de su equipo, al día siguiente, en español de Colombia y en primera persona («hice», «quedó»).
Muy simple de leer y de decir en voz alta:
- Arrancá con una línea que diga en qué trabajé (las tareas, por su nombre corto).
- Después, viñetas cortas: qué hice y en qué quedó. Una o dos por tarea, las importantes primero.
- Si algo me bloquea o espero a alguien, una viñeta que empiece con «Me bloquea:» o «Espero:».
- Sin jerga interna, sin nombres de herramientas propias, sin rutas de archivos ni comandos. Las claves de Jira sí, entre paréntesis, al nombrar la tarea.
- Usá SÓLO lo que dice el registro: no inventes nada, no supongas resultados, no agregues próximos pasos que no estén.
- Máximo 7 renglones en total. Sin títulos ni negritas.`

// Spoken: cómo se nombra el día en la daily, que se dice el siguiente día hábil: «Ayer», o «El viernes» si se dice el
// lunes (o más días después). Armada el mismo día (para mañana), también es «Ayer».
func Spoken(day string, now time.Time) string {
	d, err := time.ParseInLocation("2006-01-02", day, now.Location())
	if err != nil {
		return "Ayer"
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !d.Before(today.AddDate(0, 0, -1)) {
		return "Ayer"
	}
	names := []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}
	return "El " + names[d.Weekday()]
}

// Prompt: el registro del día, por tarea.
func Prompt(in Input) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Lo que registré el %s en mi bitácora, por tarea. En la daily ese día se nombra «%s» (arrancá así: «%s trabajé en…»).\n\n",
		in.Day, Spoken(in.Day, time.Now()), Spoken(in.Day, time.Now()))
	for _, it := range in.Items {
		title := strings.Trim(it.Title, `"`)
		if len(it.Jira) > 0 {
			title += " (" + strings.Join(it.Jira, ", ") + ")"
		}
		fmt.Fprintf(&b, "## %s — %d min\n", title, it.Minutes)
		for _, n := range it.Notes {
			fmt.Fprintf(&b, "- %s: %s\n", n.Title, n.Text)
		}
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

// Previous: el último día ANTERIOR a `today` que tiene algo registrado de CreditOp, hasta 10 días atrás. Así el lunes
// toma el viernes, y un festivo o un día sin registro no deja la daily vacía. "" si no hay ninguno.
func Previous(st *store.Store, today time.Time) string {
	entries, err := st.List(14, 0)
	if err != nil {
		return ""
	}
	refs := map[int64]store.EffortRef{}
	for _, r := range st.EffortsAll() {
		refs[r.ID] = r
	}
	days := map[string]bool{}
	for _, e := range entries {
		if r, ok := refs[e.EffortID]; ok && e.EffortID != 0 && r.Level != "miguel" {
			days[e.Day] = true
		}
	}
	for d := 1; d <= 10; d++ {
		day := today.AddDate(0, 0, -d).Format("2006-01-02")
		if days[day] {
			return day
		}
	}
	return ""
}

// Daily: lo escrito, con de dónde salió.
type Daily struct {
	Day       string    `json:"day"`
	Text      string    `json:"text"`
	Model     string    `json:"model"`
	Tasks     []string  `json:"tasks"`
	MinutesIn int       `json:"minutesIn"`
	MadeAt    time.Time `json:"madeAt"`
}

// Make la escribe con el modelo de segundo plano. root es la raíz de my-tools.
func Make(ctx context.Context, root string, in Input) (Daily, error) {
	d := Daily{Day: in.Day, MinutesIn: in.MinutesIn, MadeAt: time.Now()}
	for _, it := range in.Items {
		d.Tasks = append(d.Tasks, strings.Trim(it.Title, `"`))
	}
	if len(in.Items) == 0 {
		return d, fmt.Errorf("el %s no hay nada registrado de CreditOp (sólo de my-tools o sin tarea)", in.Day)
	}
	ans, err := background.Ask(ctx, root, background.Request{Prompt: Prompt(in), System: System})
	if err != nil {
		return d, err
	}
	d.Text, d.Model = strings.TrimSpace(ans.Text), ans.Model
	return d, nil
}

// Write la guarda como Markdown: arriba lo que se dice; abajo, en un comentario, de dónde salió.
func Write(lay layout.Layout, d Daily) (string, error) {
	if err := os.MkdirAll(lay.DailyDir(), 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(lay.DailyDir(), d.Day+".md")
	body := fmt.Sprintf("%s\n\n<!-- daily · %s · %s · %d min de %s · %s -->\n", d.Text, d.Day, d.Model, d.MinutesIn,
		strings.Join(d.Tasks, " · "), d.MadeAt.Format(time.RFC3339))
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

// Saved: una daily guardada, para el tablero.
type Saved struct {
	Day    string `json:"day"`
	Text   string `json:"text"`
	Source string `json:"source"` // el comentario de abajo: modelo, minutos y tareas
}

// List: las guardadas, de la más nueva a la más vieja (hasta n).
func List(lay layout.Layout, n int) []Saved {
	files, _ := filepath.Glob(filepath.Join(lay.DailyDir(), "????-??-??.md"))
	sort.Sort(sort.Reverse(sort.StringSlice(files)))
	var out []Saved
	for _, f := range files {
		if len(out) >= n {
			break
		}
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		text, source := string(raw), ""
		if i := strings.LastIndex(text, "<!-- daily ·"); i >= 0 {
			source = strings.TrimSuffix(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(text[i:]), "<!-- daily ·")), "-->")
			text = text[:i]
		}
		out = append(out, Saved{Day: strings.TrimSuffix(filepath.Base(f), ".md"), Text: strings.TrimSpace(text), Source: strings.TrimSpace(source)})
	}
	return out
}

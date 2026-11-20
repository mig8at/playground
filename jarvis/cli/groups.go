package main

/* Los GRUPOS desde la consola: cada meta en su grupo de pestañas de Chrome (server/groups.go).
 *
 *	bin/jarvis start --group 'VTEX' [--color blue] '<meta>'   la sesión va al grupo VTEX (lo crea si no está)
 *	bin/jarvis start '<meta>'                                 sin --group, Jarvis arma uno con el nombre de la meta
 *	bin/jarvis look --group 'VTEX'                            sin --session: la última sesión de ese grupo
 *	bin/jarvis groups                                         los grupos y sus sesiones
 *	bin/jarvis groups close 'VTEX' [--force]                  cierra todas sus sesiones (y sus pestañas)
 *	bin/jarvis groups move 3 'Shopify'                        pasa la sesión 3 a otro grupo (- = a «Jarvis»)
 *	bin/jarvis groups color 'VTEX' green                      le cambia el color
 *
 * Para trabajar en paralelo sin pisarse: cada trabajo con su --session N (lo imprime start), o con su --group si es
 * el único Claude en ese grupo. Un comando sin ninguno de los dos va a la última sesión que se abrió, que puede ser
 * de otro. */

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"unicode"
)

// groupColors son los colores que acepta Chrome (el violeta es el de «Jarvis»).
var groupColors = []string{"blue", "green", "orange", "pink", "cyan", "red", "yellow", "grey", "purple"}

// autoGroupMax: el nombre automático es corto, para que la tira de pestañas de Chrome lo muestre entero.
const autoGroupMax = 24

// fillerWords no dicen de qué se trata la meta: se saltean al armar el nombre automático.
var fillerWords = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields("el la los las un una de del en y a al que con por para mi su lo se") {
		m[w] = true
	}
	return m
}()

// autoGroupName arma un nombre de grupo con las primeras palabras con sentido de la meta («Validar que Creditop esté
// activo y el pedido X3RMQ3R82 pagado» → «Validar Creditop esté»), hasta autoGroupMax letras.
func autoGroupName(goal string) string {
	var words []string
	n := 0
	for _, w := range strings.FieldsFunc(goal, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '.'
	}) {
		w = strings.Trim(w, "-.")
		if w == "" || (len(words) > 0 && fillerWords[strings.ToLower(w)]) {
			continue
		}
		if n+len([]rune(w))+len(words) > autoGroupMax {
			if len(words) == 0 {
				words = append(words, string([]rune(w)[:autoGroupMax]))
			}
			break
		}
		words = append(words, w)
		n += len([]rune(w))
	}
	name := strings.Join(words, " ")
	if name == "" {
		return "Tarea"
	}
	r := []rune(name)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// sameGroup compara dos nombres de grupo como el servidor (groupKey): sin mayúsculas, tildes ni espacios de más.
func sameGroup(a, b string) bool {
	key := func(s string) string {
		s = strings.ToLower(strings.Join(strings.Fields(s), " "))
		return strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n").Replace(s)
	}
	return a != "" && b != "" && key(a) == key(b)
}

// uniqueAutoGroup: un nombre automático que ya usa otro Claude trabajando se numera («Validar Creditop 2»), para que
// las dos metas no compartan grupo sin que nadie lo haya pedido.
func uniqueAutoGroup(name string, tabs []tabInfo) string {
	taken := func(n string) bool {
		for _, t := range tabs {
			if sameGroup(t.Group, n) && t.Busy {
				return true
			}
		}
		return false
	}
	out := name
	for i := 2; taken(out); i++ {
		out = fmt.Sprintf("%s %d", name, i)
	}
	return out
}

// placeInGroup deja tabID y groupName listos para la meta de `start`:
//   - con --session N: esa sesión; si además vino --group, la pasa a ese grupo;
//   - con --group G (o sin él, el nombre de la meta): la que elige y reserva el servidor (Tabs.Claim).
//
// Devuelve un aviso para la persona, si hace falta.
func placeInGroup(goal, start string) (string, error) {
	tabs, err := listTabs()
	if err != nil {
		return "", err
	}
	explicit := groupName != ""
	if tabID != "" {
		if !explicit {
			for _, t := range tabs {
				if t.ID == tabID {
					groupName = t.Group
				}
			}
			if groupName != "" {
				return "", nil
			}
			groupName = uniqueAutoGroup(autoGroupName(goal), tabs)
		}
		return "", moveToGroup(tabID, groupName, groupColor)
	}
	if !explicit {
		groupName = uniqueAutoGroup(autoGroupName(goal), tabs)
	}
	note := ""
	for _, t := range tabs {
		if sameGroup(t.Group, groupName) && t.Busy {
			note = fmt.Sprintf("en el grupo «%s» ya trabaja Claude (sesión %s: %s): esta meta va en otra sesión del mismo grupo; usá --session, no --group, para no caer en la otra", t.Group, t.ID, t.Goal)
		}
	}
	// La elección es del servidor, de una vez (Tabs.Claim): elegir acá, con la lista de recién, dejaba que dos
	// `start` a la vez tomaran la misma sesión vacía.
	// Con el sitio, el servidor reutiliza una sesión libre que ya está ahí (su pestaña) en vez de abrir otra.
	var nt struct{ ID, Group, Reused, URL string }
	body := map[string]any{"group": groupName, "color": groupColor, "url": start, "auto": !explicit}
	if err := call(http.MethodPost, "/api/tabs/claim", body, &nt); err != nil {
		return "", err
	}
	tabID, groupName = nt.ID, nt.Group
	if nt.Reused == "site" {
		reuse := fmt.Sprintf("reutilizo la sesión %s, que ya estaba en %s (sin abrir otra pestaña)", nt.ID, nt.URL)
		if note != "" {
			return note + "\n" + reuse, nil
		}
		return reuse, nil
	}
	return note, nil
}

// moveToGroup pasa la sesión al grupo (vacío: al «Jarvis» de siempre) y deja groupName como quedó en el servidor.
func moveToGroup(id, name, color string) error {
	var res struct{ Group, Color string }
	if err := call(http.MethodPut, "/api/tabs/"+url.PathEscape(id), map[string]string{"group": name, "color": color}, &res); err != nil {
		return err
	}
	groupName = res.Group
	return nil
}

func groupsCmd(args []string) error {
	// Este comando nombra el grupo en sus argumentos: el --group global no tiene que mandar el pedido a otra sesión.
	groupName = ""
	force := false
	var rest []string
	for _, a := range args {
		if a == "--force" {
			force = true
			continue
		}
		rest = append(rest, a)
	}
	tabs, err := listTabs()
	if err != nil {
		return err
	}
	inGroup := func(g string) []tabInfo {
		var out []tabInfo
		for _, t := range tabs {
			if sameGroup(t.Group, g) {
				out = append(out, t)
			}
		}
		return out
	}
	switch {
	case len(rest) == 0:
		return listGroups(tabs)
	case rest[0] == "close" && len(rest) == 2:
		members := inGroup(rest[1])
		if len(members) == 0 {
			return fmt.Errorf("no hay sesiones en el grupo «%s» (bin/jarvis groups los lista)", rest[1])
		}
		if !force {
			for _, t := range members {
				if t.Busy {
					return fmt.Errorf("en la sesión %s del grupo trabaja Claude (%s): cerrarlo lo frena. Con --force se cierra igual", t.ID, t.Goal)
				}
			}
		}
		for _, t := range members {
			if err := call(http.MethodDelete, "/api/tabs/"+url.PathEscape(t.ID), nil, nil); err != nil {
				return err
			}
		}
		fmt.Printf("grupo «%s» cerrado: %d sesión(es)\n", members[0].Group, len(members))
		return nil
	case rest[0] == "move" && len(rest) == 3:
		name := rest[2]
		if name == "-" {
			name = ""
		}
		if err := moveToGroup(rest[1], name, groupColor); err != nil {
			return err
		}
		if groupName == "" {
			fmt.Printf("sesión %s de vuelta en el grupo «Jarvis»\n", rest[1])
		} else {
			fmt.Printf("sesión %s en el grupo «%s»\n", rest[1], groupName)
		}
		return nil
	case rest[0] == "color" && len(rest) == 3:
		members := inGroup(rest[1])
		if len(members) == 0 {
			return fmt.Errorf("no hay sesiones en el grupo «%s»", rest[1])
		}
		// El color es del grupo: cambiarlo en una sesión lo cambia para todas (server/groups.go).
		if err := moveToGroup(members[0].ID, members[0].Group, rest[2]); err != nil {
			return err
		}
		fmt.Printf("grupo «%s» en %s\n", members[0].Group, rest[2])
		return nil
	}
	usage()
	return errors.New("unreachable")
}

func listGroups(tabs []tabInfo) error {
	type group struct {
		name, color string
		tabs        []tabInfo
	}
	var groups []*group
	var loose []tabInfo
	for _, t := range tabs {
		if t.Group == "" {
			loose = append(loose, t)
			continue
		}
		var g *group
		for _, x := range groups {
			if sameGroup(x.name, t.Group) {
				g = x
			}
		}
		if g == nil {
			g = &group{name: t.Group, color: t.Color}
			groups = append(groups, g)
		}
		g.tabs = append(g.tabs, t)
	}
	if len(groups) == 0 {
		fmt.Println("ningún grupo todavía: bin/jarvis start --group 'Nombre' '<meta>' arma uno (sin --group, con el nombre de la meta)")
	}
	for _, g := range groups {
		fmt.Printf("«%s» (%s)\n", g.name, g.color)
		for _, t := range g.tabs {
			printTabLine("    ", t)
		}
	}
	if len(loose) > 0 {
		fmt.Println("sin grupo (van a «Jarvis»):")
		for _, t := range loose {
			printTabLine("    ", t)
		}
	}
	if os.Getenv("JARVIS_GROUP") == "" {
		fmt.Println("  (un comando con --group G va a la última sesión de G; con --session N, a esa)")
	}
	return nil
}

func printTabLine(indent string, t tabInfo) {
	where := "(vacía)"
	if t.Active {
		where = t.Title + " · " + t.URL
	}
	who := ""
	if t.Busy {
		who = " · Claude: " + t.Goal
	}
	fmt.Printf("%s%s  %s%s\n", indent, t.ID, where, who)
}

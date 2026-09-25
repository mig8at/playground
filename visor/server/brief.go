package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/figma"
	"creditop/playground/visor/render"
)

// EL PAQUETE PARA EL MODELO: todo lo que un modelo necesita para pasar UNA pantalla a Vue o React, en
// un solo texto que se pega en la conversación o en la tarea. Nada se escribe a mano: sale del mapa (dónde
// está la pantalla y a dónde lleva), del nodo (sus textos en orden), de la traducción (el HTML, fiel a
// Figma, con los tokens) y de las hojas del archivo (los tokens y componentes que usa).
//
// `/api/brief?key=<clave>&id=<pantalla>` lo devuelve en Markdown. El botón del detalle lo copia.

// screenPlace es dónde vive una pantalla en el mapa: su carril y su posición.
type screenPlace struct {
	screen   figma.Screen
	lane     string
	index    int
	total    int
	fileName string
}

func (s *server) findScreen(key, id string) (screenPlace, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var found screenPlace
	ok := false
	var walk func(st figma.Structure, file string)
	walk = func(st figma.Structure, file string) {
		for _, l := range st.Lanes {
			for i, sc := range l.Screens {
				if sc.ID == id && !ok {
					found, ok = screenPlace{screen: sc, lane: l.Label, index: i + 1, total: len(l.Screens), fileName: file}, true
				}
			}
		}
		for _, sub := range st.Sections {
			walk(sub, file)
		}
	}
	for k, st := range s.maps {
		if strings.HasPrefix(k, key+"|") {
			walk(st, st.FileName)
		}
	}
	return found, ok
}

// fileInventory es el inventario del mapa del archivo con más componentes (la página de flujo, casi siempre).
func (s *server) fileInventory(key string) []figma.ComponentUse {
	s.mu.Lock()
	defer s.mu.Unlock()
	var best []figma.ComponentUse
	for k, st := range s.maps {
		if strings.HasPrefix(k, key+"|") && len(st.Inventory) > len(best) {
			best = st.Inventory
		}
	}
	return best
}

// projectSlug es el nombre del proyecto en la ruta del visor, como lo arma la UI.
func (s *server) projectSlug(key string) string {
	for _, o := range s.library.read().Opened {
		if o.Key == key && o.Name != "" {
			return slugOf(o.Name)
		}
	}
	return key
}

func (s *server) brief(ctx context.Context, key, id string) (string, error) {
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return "", err
	}
	doc, rep := render.HTML(n, assets(key, s.fileVariants(key, version), s.styleTokens(key)))
	place, placed := s.findScreen(key, id)
	title := n.Name
	if placed && place.screen.Title != "" {
		title = place.screen.Title
	}
	file := place.fileName
	if file == "" {
		file = s.fileName(key)
	}
	dashed := strings.ReplaceAll(id, ":", "-")
	print := ""
	if t, err := s.track(ctx, key, id, ""); err == nil {
		print = t.Print
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# «%s» · %s\n\n", title, file)
	b.WriteString("Para pasar esta pantalla a código (Vue o React). Todo sale de Figma: el HTML de abajo es la traducción fiel del diseño y ya usa los tokens del archivo.\n\n")
	ref := "visor:" + key + "/" + dashed
	if print != "" {
		ref += "@" + print
	}
	fmt.Fprintf(&b, "- **Enlace para la tarea:** [%s](%s)\n", strings.NewReplacer("[", " ", "]", " ").Replace(title), ref)
	fmt.Fprintf(&b, "- **Figma:** https://www.figma.com/design/%s/?node-id=%s\n", key, dashed)
	if placed {
		lane := place.lane
		if lane == "" {
			lane = "fila sin rótulo"
		}
		kind := map[string]string{"mobile": "móvil", "web": "web", "panel": "panel", "textless": "sin texto"}[place.screen.Kind]
		if kind == "" {
			kind = place.screen.Kind
		}
		fmt.Fprintf(&b, "- **Dónde está:** carril «%s», %d de %d · %s %.0f×%.0f\n", lane, place.index, place.total, kind, place.screen.W, place.screen.H)
	}
	fmt.Fprintf(&b, "- **Hoja de tokens del archivo:** `make visor-tokens P=%s` (o `FORMATO=tailwind`)\n", key)

	b.WriteString("\n## Textos, en orden de lectura\n\n")
	for i, t := range render.ScreenTexts(n) {
		fmt.Fprintf(&b, "%d. %s\n", i+1, strings.ReplaceAll(t, "\n", " "))
	}

	b.WriteString("\n## A dónde lleva\n\n")
	if placed && len(place.screen.Hotspots) > 0 {
		for _, h := range place.screen.Hotspots {
			to := h.ToName
			if h.To == "" {
				to += " (fuera de este flujo)"
			}
			fmt.Fprintf(&b, "- %s → %s\n", h.Via, to)
		}
	} else {
		b.WriteString("El prototipo no dice a dónde lleva esta pantalla.\n")
	}

	// Las imágenes, para que el modelo las BAJE en vez de dejar un hueco o pedírselas a diseño: en la
	// bienvenida de Alta, el logo y la foto estaban en Figma y se implementaron con los de otra marca.
	var images []string
	seenImage := map[string]bool{}
	var findImages func(nd render.Node, root bool)
	findImages = func(nd render.Node, root bool) {
		if nd.Visible != nil && !*nd.Visible {
			return
		}
		for _, p := range nd.Fills {
			if p.Type == "IMAGE" && p.ImageRef != "" && (p.Visible == nil || *p.Visible) && !seenImage[p.ImageRef] {
				seenImage[p.ImageRef] = true
				where := ""
				if nd.Box != nil {
					where = fmt.Sprintf(", %.0f×%.0f en pantalla", nd.Box.Width, nd.Box.Height)
				}
				role := ""
				if root {
					role = " (fondo de la pantalla)"
				}
				images = append(images, fmt.Sprintf("- «%s»%s%s", nd.Name, role, where))
			}
		}
		for _, ch := range nd.Children {
			findImages(ch, false)
		}
	}
	findImages(n, true)
	b.WriteString("\n## Imágenes y dibujos\n\n")
	if len(images) > 0 {
		b.WriteString(strings.Join(images, "\n") + "\n")
	} else {
		b.WriteString("La pantalla no tiene imágenes (fotos, logos en bitmap).\n")
	}
	fmt.Fprintf(&b, "- %d dibujo(s) de Figma (íconos, logos vectoriales).\n", len(unique(rep.Drawings)))
	fmt.Fprintf(&b, "\nBajalas en su resolución ORIGINAL, con el nombre de su capa: `make visor-recursos R=%s/%s DIR=<carpeta>` (`SVG=1` suma los dibujos). No hace falta pedírselas a diseño.\n", key, dashed)

	if len(rep.Controls) > 0 {
		b.WriteString("\n## Controles\n\n")
		var parts []string
		for kind, n := range rep.Controls {
			parts = append(parts, fmt.Sprintf("%s ×%d", kind, n))
		}
		sort.Strings(parts)
		b.WriteString("- " + strings.Join(parts, " · ") + "\n")
		b.WriteString("- En el HTML los campos son `<input>`, las casillas `<input type=checkbox|radio>` y los botones `<button>`. Las listas tienen una sola opción: el diseño no trae las demás.\n")
	}

	var comps []figma.ComponentUse
	for _, c := range s.fileInventory(key) {
		for _, sid := range c.Screens {
			if sid == id {
				comps = append(comps, c)
				break
			}
		}
	}
	if len(comps) > 0 {
		b.WriteString("\n## Componentes del sistema de diseño que usa\n\n")
		for _, c := range comps {
			var props []string
			for _, p := range c.Props {
				if p.Type == "TEXT" || len(p.Values) == 0 {
					continue
				}
				var vs []string
				for _, v := range p.Values {
					vs = append(vs, v.Value)
				}
				props = append(props, p.Name+": "+strings.Join(vs, " | "))
			}
			line := "- " + c.Name
			if len(props) > 0 {
				line += " — variantes en el archivo: " + strings.Join(props, " · ")
			}
			b.WriteString(line + "\n")
		}
	}

	if len(rep.Tokens) > 0 || rep.Loose > 0 {
		b.WriteString("\n## Tokens que usa\n\n")
		byName := map[string]string{}
		if t := s.fileTokens(key); t != nil {
			for _, c := range t.Colors {
				byName[c.Name] = fmt.Sprintf("`%s` %s", c.Var, c.Value)
			}
			for _, x := range t.Texts {
				byName[x.Name] = fmt.Sprintf("`.%s` %s %g/%g", x.Class, strings.TrimSuffix(x.Family, " Variable"), x.Size, x.LineHeight)
			}
		}
		names := make([]string, 0, len(rep.Tokens))
		for name := range rep.Tokens {
			names = append(names, name)
		}
		sort.Slice(names, func(i, j int) bool {
			return rep.Tokens[names[i]] > rep.Tokens[names[j]] || rep.Tokens[names[i]] == rep.Tokens[names[j]] && names[i] < names[j]
		})
		for _, name := range names {
			fmt.Fprintf(&b, "- %s — %s ×%d\n", byName[name], name, rep.Tokens[name])
		}
		if rep.Loose > 0 {
			fmt.Fprintf(&b, "- %d color(es) escrito(s) sin estilo en Figma: se salen del sistema de diseño.\n", rep.Loose)
		}
	}

	// La fidelidad, si ya se midió: dice cuánto confiar en el HTML de abajo. No se mide acá —cuesta un
	// Chromium y el paquete tiene que salir rápido—: sin medida, se dice cómo tomarla.
	b.WriteString("\n## Fidelidad del HTML contra Figma\n\n")
	if f, err := s.fidelityOf(ctx, key, id, false, true); err == nil {
		fmt.Fprintf(&b, "%.2f %% igual sin contar el suavizado de las letras (%.1f %% píxel a píxel; medida %s).\n", f.SameReal*100, f.Same*100, f.Measured.Format("2006-01-02 15:04"))
	} else {
		fmt.Fprintf(&b, "Sin medir en esta versión: `make visor-fidelidad R=%s/%s` dice cuánto se parece.\n", key, dashed)
	}

	if len(rep.Missing) > 0 {
		b.WriteString("\n## Lo que el HTML no traduce\n\n")
		var ms []string
		for why, n := range rep.Missing {
			ms = append(ms, fmt.Sprintf("- %s ×%d", why, n))
		}
		sort.Strings(ms)
		b.WriteString(strings.Join(ms, "\n") + "\n")
	}

	b.WriteString("\n## HTML traducido\n\nLas imágenes y los dibujos van por `/api/asset` del visor; los colores, como `var(--token, valor)`.\n\n```html\n")
	b.WriteString(strings.TrimSpace(doc))
	b.WriteString("\n```\n")
	return b.String(), nil
}

func (s *server) handleBrief(w http.ResponseWriter, r *http.Request) {
	key, id := r.URL.Query().Get("key"), r.URL.Query().Get("id")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	text, err := s.brief(ctx, key, id)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	_, _ = w.Write([]byte(text))
}

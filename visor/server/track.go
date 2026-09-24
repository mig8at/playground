package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/figma"
)

// RASTREAR UN ENLACE. La ruta `/<proyecto>/<pantalla>` vive lo que vive el nodo en Figma, pero eso no dice
// si la pantalla que se enlazó en una tarea sigue siendo la que se miró: el diseñador la puede cambiar
// entera sin cambiarle el id. Por eso el enlace que se copia lleva la HUELLA del contenido de ese momento
// (`?huella=`, figma.Fingerprint), y comparar contra la de hoy dice «igual», «cambió» o «la borraron».
// Es el mismo mecanismo que canon usa con el hash del blob de cada fuente.

// Los estados de un enlace. La UI y `make visor-enlaces` los dicen en castellano.
const (
	linkSame     = "same"     // la pantalla es la que se enlazó
	linkChanged  = "changed"  // el diseñador la cambió después
	linkDeleted  = "deleted"  // Figma ya no la tiene
	linkUnsigned = "unsigned" // el enlace no trae huella: sólo se sabe que existe
)

type trackResult struct {
	Key    string `json:"key"`
	ID     string `json:"id"`
	Print  string `json:"print,omitempty"`  // la huella de hoy
	Linked string `json:"linked,omitempty"` // la del enlace
	Status string `json:"status"`
}

// track compara la pantalla de hoy con la huella del enlace. Con una huella que comparar pregunta a Figma
// de nuevo: lo guardado es de la versión que el server vio al leer el mapa, y el cambio que se busca puede
// ser posterior.
func (s *server) track(ctx context.Context, key, id, linked string) (trackResult, error) {
	out := trackResult{Key: key, ID: id, Linked: linked}
	var raw []byte
	var err error
	if linked != "" {
		raw, err = s.nodeJSON(ctx, key, id)
	} else {
		raw, _, err = s.screenRaw(ctx, key, id)
	}
	var fe *figma.Error
	if errors.As(err, &fe) && fe.Status == http.StatusNotFound {
		out.Status = linkDeleted
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if out.Print, err = figma.Fingerprint(raw); err != nil {
		return out, err
	}
	switch {
	case linked == "":
		out.Status = linkUnsigned
	case linked == out.Print:
		out.Status = linkSame
	default:
		out.Status = linkChanged
	}
	return out, nil
}

// handleTrack: `/api/track?key=&id=[&huella=]`. Sin huella devuelve la de hoy (es lo que el botón de copiar
// pone en el enlace); con huella, además, si la pantalla cambió.
func (s *server) handleTrack(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key, id, linked := q.Get("key"), q.Get("id"), q.Get("huella")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) || (linked != "" && !rePrint.MatchString(linked)) {
		fail(w, 400, "clave, id o huella inválidos")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	res, err := s.track(ctx, key, id, linked)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, res)
}

var (
	rePrint = regexp.MustCompile(`^[0-9a-f]{12}$`)
	// Un enlace del visor como se pega en una tarea: `http://localhost:5193/credifamilia/381-1052?huella=…`.
	reVisorLink = regexp.MustCompile(`https?://(?:localhost|127\.0\.0\.1):5193/([A-Za-z0-9-]+)/([0-9]+-[0-9]+)(\?[^\s)\]>"'` + "`" + `]*)?`)
)

// slugOf es el nombre de un proyecto en la ruta, igual que en la UI (App.vue): minúsculas, sin tildes y
// con guiones.
func slugOf(name string) string {
	fold := strings.NewReplacer("á", "a", "à", "a", "ä", "a", "â", "a", "ã", "a", "é", "e", "è", "e", "ë", "e", "ê", "e",
		"í", "i", "ì", "i", "ï", "i", "î", "i", "ó", "o", "ò", "o", "ö", "o", "ô", "o", "õ", "o", "ú", "u", "ù", "u",
		"ü", "u", "û", "u", "ñ", "n", "ç", "c")
	s := fold.Replace(strings.ToLower(name))
	var b strings.Builder
	dash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// keyOfProject resuelve el proyecto de una ruta con la biblioteca de esta máquina: por su nombre de hoy,
// por uno que tuvo antes, o por la clave del archivo.
func (s *server) keyOfProject(project string) string {
	lib := s.library.read()
	for _, o := range lib.Opened {
		if slugOf(o.Name) == project {
			return o.Key
		}
	}
	for _, o := range lib.Opened {
		for _, a := range o.Aliases {
			if slugOf(a) == project {
				return o.Key
			}
		}
	}
	if reFileKey.MatchString(project) {
		return project
	}
	return ""
}

type foundLink struct {
	file, project, id, print string
	line                     int
}

// checkLinks recorre una carpeta (las tareas del tablero), encuentra los enlaces del visor y dice cómo está
// cada pantalla. Sale con 1 si alguna ya no existe o su proyecto no se reconoce: un enlace roto en una
// tarea es lo que esto existe para encontrar. «Cambió» no es un error, es un aviso para releer.
func (s *server) checkLinks(ctx context.Context, root string, w *bufio.Writer) int {
	var links []foundLink
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !(strings.HasSuffix(path, ".md") || strings.HasSuffix(path, ".jsonl")) {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<24)
		for n := 1; sc.Scan(); n++ {
			for _, m := range reVisorLink.FindAllStringSubmatch(sc.Text(), -1) {
				q, _ := url.ParseQuery(strings.TrimPrefix(m[3], "?"))
				rel, _ := filepath.Rel(root, path)
				links = append(links, foundLink{file: rel, line: n, project: m[1], id: strings.ReplaceAll(m[2], "-", ":"), print: q.Get("huella")})
			}
		}
		return nil
	})
	sort.SliceStable(links, func(i, j int) bool { return links[i].file < links[j].file })
	label := map[string]string{linkSame: "igual", linkChanged: "CAMBIÓ", linkDeleted: "BORRADA", linkUnsigned: "sin huella"}
	counts := map[string]int{}
	broken := 0
	seen := map[string]trackResult{}
	for _, l := range links {
		key := s.keyOfProject(l.project)
		where := fmt.Sprintf("%s:%d", l.file, l.line)
		if key == "" {
			fmt.Fprintf(w, "  %-11s %-50s %s/%s — el proyecto no está en la biblioteca del visor\n", "¿PROYECTO?", where, l.project, strings.ReplaceAll(l.id, ":", "-"))
			broken++
			continue
		}
		k := key + "|" + l.id + "|" + l.print
		res, ok := seen[k]
		if !ok {
			var err error
			if res, err = s.track(ctx, key, l.id, l.print); err != nil {
				fmt.Fprintf(w, "  %-11s %-50s %s/%s — %v\n", "ERROR", where, l.project, strings.ReplaceAll(l.id, ":", "-"), err)
				broken++
				continue
			}
			seen[k] = res
		}
		counts[res.Status]++
		note := ""
		switch res.Status {
		case linkChanged:
			note = fmt.Sprintf(" — huella %s → %s: releer la pantalla", l.print, res.Print)
		case linkDeleted:
			note = " — el diseñador la borró"
			broken++
		case linkUnsigned:
			note = " — enlace sin huella: copiarlo de nuevo desde el visor para poder rastrearlo"
		}
		fmt.Fprintf(w, "  %-11s %-50s %s/%s%s\n", label[res.Status], where, l.project, strings.ReplaceAll(l.id, ":", "-"), note)
	}
	fmt.Fprintf(w, "\n  %d enlace(s) · %d igual · %d cambió · %d borrada · %d sin huella\n", len(links),
		counts[linkSame], counts[linkChanged], counts[linkDeleted], counts[linkUnsigned])
	if broken > 0 {
		return 1
	}
	return 0
}

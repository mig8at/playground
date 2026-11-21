// sabueso — encontrar comercios y su contacto para la propuesta, por consola (sabueso/, tarea 136). Habla con la API
// de la app (:5245): lo que hace acá se ve en la app de Cockpit, y al revés. Si la API no contesta, la levanta con
// `bin/cockpit ensure sabueso`.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const api = "http://127.0.0.1:5245"

const usage = `bin/sabueso — encontrar comercios que no trabajan con CreditOp y su contacto para la propuesta

  bin/sabueso hunt [--sector motorcycles] [--count 1] [--tries 3] [--min 5]
        busca en el registro mercantil los comercios del sector que encajan y no son clientes, los agrega y le
        pide a Claude (claude -p, por internet) el canal por el que reciben propuestas; sigue con el siguiente
        hasta tener --count con contacto (o --tries intentos). Cada búsqueda: ~1,5 min y gasta el asiento del plan
        Los que quedan sin canal salen de Sabueso y no se vuelven a buscar.
  bin/sabueso contact <nombre|id>    busca el contacto de un comercio que ya está en Sabueso
  bin/sabueso find [--sector S] [--min 5]   los del registro, sin agregar nada (segundos)
  bin/sabueso list [--json]          los comercios que se siguen, con su contacto
  bin/sabueso sectors                los sectores que sabe buscar

Sectores: dental · phones · home · appliances · motorcycles · cars · health
`

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(usage)
		return 0
	}
	switch args[0] {
	case "hunt", "contact", "find", "list", "sectors":
	default:
		fmt.Fprintf(os.Stderr, "sabueso: no conozco %q (bin/sabueso help)\n", args[0])
		return 2
	}
	if err := ensure(); err != nil {
		fmt.Fprintln(os.Stderr, "sabueso:", err)
		return 1
	}
	var err error
	switch args[0] {
	case "hunt":
		err = hunt(args[1:])
	case "contact":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "bin/sabueso contact <nombre|id>")
			return 2
		}
		err = contact(strings.Join(args[1:], " "))
	case "find":
		err = findCmd(args[1:])
	case "list":
		err = list(len(args) > 1 && args[1] == "--json")
	case "sectors":
		err = sectorsCmd()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "sabueso:", err)
		return 1
	}
	return 0
}

// ── la API ───────────────────────────────────────────────────────────────────────────────────────────────────

func call(method, path string, body, out any, timeout time.Duration) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, api+path, rd)
	req.Header.Set("X-Sabueso", "1")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		var e struct{ Error string }
		_ = json.Unmarshal(raw, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return errors.New(e.Error)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func ensure() error {
	if call("GET", "/api/state", nil, nil, 3*time.Second) == nil {
		return nil
	}
	root := os.Getenv("MY_TOOLS_ROOT")
	if root == "" {
		root, _ = os.Getwd()
	}
	fmt.Fprintln(os.Stderr, "sabueso: la API no contesta; la levanto con bin/cockpit ensure sabueso…")
	cmd := exec.Command(filepath.Join(root, "bin", "cockpit"), "ensure", "sabueso")
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		return errors.New("no pude levantar la API: abrí Sabueso en Cockpit o corré `make sabueso`")
	}
	for i := 0; i < 30; i++ {
		if call("GET", "/api/state", nil, nil, 3*time.Second) == nil {
			return nil
		}
		time.Sleep(time.Second)
	}
	return errors.New("la API no contesta en :5245")
}

type contactT struct{ Channel, Value, Area, Fit, Source string }

type company struct {
	ID, Kind, Name, NIT, Sector, Region, Stage, Website, Email, Phone, HandedTo string
	Points, Fit                                                                 int
	Research                                                                    *struct {
		Matched  bool
		Website  string
		Summary  string
		Contacts []contactT
		Seconds  int
		CostUSD  float64
	}
}

type state struct {
	Companies []company
	Sectors   []struct {
		ID, Name, Ticket string
		Disbursed        int
	}
}

type candidate struct {
	NIT, Name, Region, CIIU, Renewed, Client, Tracked, Sector string
	Points, Fit                                               int
	Inactive, NoChannel                                       bool
}

func load() (*state, error) {
	var st state
	return &st, call("GET", "/api/state", nil, &st, 3*time.Minute)
}

// ── los comandos ─────────────────────────────────────────────────────────────────────────────────────────────

func findCmd(args []string) error {
	fs := flag.NewFlagSet("find", flag.ContinueOnError)
	sector := fs.String("sector", "motorcycles", "")
	min := fs.Int("min", 5, "")
	if err := fs.Parse(args); err != nil {
		return err
	}
	list, err := discover(*sector, *min)
	if err != nil {
		return err
	}
	for _, c := range list {
		mark := ""
		switch {
		case c.Client != "":
			mark = "ya es cliente (" + c.Client + ")"
		case c.Tracked != "":
			mark = "ya en Sabueso"
		case c.Inactive:
			mark = "la empresa no está activa"
		case c.NoChannel:
			mark = "ya se buscó: sin canal público"
		}
		fmt.Printf("%4d puntos  %-48s %-14s %s\n", c.Points, trim(c.Name, 48), c.Region, mark)
	}
	fmt.Printf("\n%d empresas · registro mercantil de Confecámaras (datos.gov.co, CC BY-SA 4.0)\n", len(list))
	return nil
}

func discover(sector string, min int) ([]candidate, error) {
	var out struct{ Candidates []candidate }
	err := call("POST", "/api/discover", map[string]any{"sector": sector, "minPoints": min}, &out, 3*time.Minute)
	return out.Candidates, err
}

func hunt(args []string) error {
	fs := flag.NewFlagSet("hunt", flag.ContinueOnError)
	sector := fs.String("sector", "motorcycles", "")
	count := fs.Int("count", 1, "")
	tries := fs.Int("tries", 3, "")
	min := fs.Int("min", 5, "")
	if err := fs.Parse(args); err != nil {
		return err
	}
	list, err := discover(*sector, *min)
	if err != nil {
		return err
	}
	found, tried := 0, 0
	for _, c := range list {
		if found >= *count || tried >= *tries {
			break
		}
		if c.Client != "" || c.Inactive || c.NoChannel || strings.HasPrefix(c.Name, "NIT ") {
			continue
		}
		id := c.Tracked
		if id != "" {
			st, err := load()
			if err != nil {
				return err
			}
			if co := byID(st, id); co != nil && co.Research != nil {
				continue // ya se buscó: no se gasta otra búsqueda
			}
		} else {
			var out struct{ ID string }
			body := map[string]any{"kind": "merchant", "name": c.Name, "nit": c.NIT, "sector": c.Sector, "ciiu": c.CIIU,
				"region": c.Region, "points": c.Points, "renewed": c.Renewed, "source": "registry"}
			if err := call("POST", "/api/companies", body, &out, time.Minute); err != nil {
				return err
			}
			id = out.ID
		}
		tried++
		fmt.Printf("→ %s (%d puntos, %s): buscando el contacto con Claude…\n", c.Name, c.Points, c.Region)
		ok, err := contactByID(id)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  no pude: %v\n", err)
			continue
		}
		if ok {
			found++
		} else if err := call("POST", "/api/companies/"+id+"/drop", map[string]any{}, nil, time.Minute); err == nil {
			fmt.Println("  sin canal: sale de Sabueso (queda anotada para no volver a buscarla)")
		}
	}
	fmt.Printf("\n%d de %d con contacto. Se ven en Sabueso (Cockpit) y con bin/sabueso list.\n", found, tried)
	return nil
}

func contact(q string) error {
	st, err := load()
	if err != nil {
		return err
	}
	var hit *company
	ql := strings.ToLower(q)
	for i := range st.Companies {
		c := &st.Companies[i]
		if c.ID == q || strings.Contains(strings.ToLower(c.Name), ql) || (c.NIT != "" && c.NIT == q) {
			if hit != nil && hit.ID != c.ID {
				return fmt.Errorf("«%s» coincide con más de uno (%s, %s): usá el id", q, hit.Name, c.Name)
			}
			hit = c
		}
	}
	if hit == nil {
		return fmt.Errorf("«%s» no está en Sabueso: bin/sabueso list", q)
	}
	fmt.Printf("→ %s: buscando el contacto con Claude…\n", hit.Name)
	_, err = contactByID(hit.ID)
	return err
}

var channelName = map[string]string{"email": "correo", "phone": "teléfono", "whatsapp": "WhatsApp", "form": "formulario"}
var fitName = map[string]string{"proposals": "recibe propuestas", "commercial": "comercial", "general": "general"}

// contactByID corre la búsqueda y la imprime. Devuelve si encontró algún canal.
func contactByID(id string) (bool, error) {
	var r struct {
		Matched  bool
		Website  string
		Summary  string
		Contacts []contactT
		Seconds  int
		CostUSD  float64
	}
	if err := call("POST", "/api/companies/"+id+"/contact", map[string]any{}, &r, 8*time.Minute); err != nil {
		return false, err
	}
	if r.Website != "" {
		fmt.Printf("  sitio: %s\n", r.Website)
	}
	for _, c := range r.Contacts {
		fmt.Printf("  %-10s %-28s %s · %s\n             %s\n", channelName[c.Channel], c.Value, c.Area, fitName[c.Fit], c.Source)
	}
	if len(r.Contacts) == 0 {
		fmt.Println("  sin canal público")
	}
	fmt.Printf("  %s\n  (%d s · US$%.2f equivalentes)\n", r.Summary, r.Seconds, r.CostUSD)
	return len(r.Contacts) > 0, nil
}

func byID(st *state, id string) *company {
	for i := range st.Companies {
		if st.Companies[i].ID == id {
			return &st.Companies[i]
		}
	}
	return nil
}

func list(asJSON bool) error {
	st, err := load()
	if err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(st.Companies)
	}
	n := 0
	for _, c := range st.Companies {
		if c.Kind != "merchant" {
			continue
		}
		n++
		reach := "sin buscar"
		if c.Research != nil {
			reach = "sin canal público"
			if len(c.Research.Contacts) > 0 {
				b := c.Research.Contacts[0]
				for _, x := range c.Research.Contacts {
					if x.Fit == "proposals" || (b.Fit == "general" && x.Fit == "commercial") {
						b = x
					}
				}
				reach = channelName[b.Channel] + " " + b.Value + " (" + fitName[b.Fit] + ")"
			}
		}
		fmt.Printf("%3d  %-44s %4d puntos  %s\n", c.Fit, trim(c.Name, 44), c.Points, reach)
	}
	fmt.Printf("\n%d comercios\n", n)
	return nil
}

func sectorsCmd() error {
	st, err := load()
	if err != nil {
		return err
	}
	for _, s := range st.Sectors {
		fmt.Printf("%-12s %-20s %6d desembolsos en 180 días · ticket %s\n", s.ID, s.Name, s.Disbursed, map[string]string{"high": "encaja", "partial": "encaja en parte"}[s.Ticket])
	}
	return nil
}

func trim(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}

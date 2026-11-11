package naming

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

/*
LA DEUDA CONOCIDA: los nombres en español que ya estaban cuando se congeló la lista (`tools/naming-debt.txt`), para que

	el chequeo falle sólo con uno NUEVO. Hasta el 2026-11-11 salía siempre en rojo (217 nombres, y subiendo), y un
	chequeo que siempre falla deja de mirarse: un nombre nuevo se colaba sin que nadie lo notara.

	Una entrada es «archivo nombre», SIN la línea: editar el archivo no la invalida, pero un nombre español distinto en
	el mismo archivo sí falla. La deuda se paga renombrando (tools/rename/); lo que ya no aparece se avisa para sacarlo.
*/
type Debt map[string]bool

var lineSuffix = regexp.MustCompile(`:\d+$`)

// DebtKey: dónde (sin la línea) y qué nombre.
func DebtKey(f Finding) string {
	return lineSuffix.ReplaceAllString(f.Where, "") + " " + f.Name
}

// LoadDebt: sin archivo, deuda vacía.
func LoadDebt(path string) (Debt, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Debt{}, nil
	}
	if err != nil {
		return nil, err
	}
	d := Debt{}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") {
			d[line] = true
		}
	}
	return d, nil
}

// SplitDebt separa lo nuevo (falla) de lo conocido, y dice qué entradas de la deuda ya no aparecen.
func SplitDebt(findings []Finding, debt Debt) (fresh, known []Finding, paid []string) {
	seen := map[string]bool{}
	for _, f := range findings {
		key := DebtKey(f)
		seen[key] = true
		if debt[key] {
			known = append(known, f)
		} else {
			fresh = append(fresh, f)
		}
	}
	for key := range debt {
		if !seen[key] {
			paid = append(paid, key)
		}
	}
	sort.Strings(paid)
	return fresh, known, paid
}

const debtHeader = `# naming-debt.txt — los nombres en español que YA estaban cuando se congeló la lista. Lo genera
# ` + "`make tablero-naming FREEZE=1`" + ` (server/internal/naming/debt.go): no se escribe a mano.
#
# El chequeo no falla por estos; sí por uno nuevo. Se paga renombrando (tablero/tools/rename/) y volviendo a
# congelar, para que la lista sólo baje. ⚠ Congelar para tapar un nombre NUEVO es saltarse el chequeo:
# un nombre nuevo se escribe en inglés.
#
# Una línea: el archivo (sin la línea) y el nombre.
`

// WriteDebt congela los hallazgos de ahora como la deuda conocida.
func WriteDebt(path string, findings []Finding) (int, error) {
	keys := map[string]bool{}
	for _, f := range findings {
		keys[DebtKey(f)] = true
	}
	lines := make([]string, 0, len(keys))
	for k := range keys {
		lines = append(lines, k)
	}
	sort.Strings(lines)
	body := debtHeader + "\n" + strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return 0, fmt.Errorf("no pude escribir la deuda: %w", err)
	}
	return len(lines), nil
}

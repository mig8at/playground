// tiers.go — CUÁNTO DETALLE MERECE CADA ARCHIVO. La alternativa medida a filtrar.
//
// POR QUÉ ESCALONAR Y NO FILTRAR. Medido en legacy-backend: quitar tests, migraciones, seeders y
// config saca el 32% de los archivos y sólo el 21% de los tokens. La razón es que el esqueleto YA es
// un filtro, y filtra mejor que un filtro: `config/` son arrays sin firmas y se comprime 252x sin que
// nadie lo excluya. Lo que queda para ganar no es borrar — es darle a cada clase de archivo la
// representación que sí informa.
//
// Y borrar tiene un costo que no se ve: si los tests no están en el mapa, el seleccionador no puede
// rutear a ellos. Y el nombre de un test es la mejor declaración de intención del repo —
// `test_it_excludes_lender_when_branch_inactive` dice la regla que el service no dice.
//
//	code       firma completa de cada método            el default
//	test       clase + NOMBRES de métodos + casos       el nombre es lo informativo, no la firma
//	migration  el archivo + las TABLAS que toca         las firmas up()/down() son 19.000 tokens de
//	                                                    cero información: el nombre ya dice la acción
package main

import (
	"sort"
	"strings"
)

const (
	tierCode      = "code"
	tierTest      = "test"
	tierMigration = "migration"
)

func classify(path string) string {
	p := strings.ToLower(path)
	switch {
	case strings.Contains(p, "/migrations/"):
		return tierMigration
	case strings.Contains(p, "/tests/") || strings.HasSuffix(p, "test.php"):
		return tierTest
	default:
		return tierCode
	}
}

// render — el texto que el mapa entrega de este archivo. Es la MISMA función que mide `bytes_tier`,
// a propósito: un número que no es lo que se manda de verdad es una mentira con formato de medición.
//
// ⚠ El tier `code` NO emite los `use`: las aristas resueltas ya llevan esa información, con
// procedencia. Es deliberado, no un olvido.
func render(f *sourceFile) string {
	var b strings.Builder
	switch f.Tier {
	case tierMigration:
		b.WriteString(f.Path)
		if len(f.Tables) > 0 {
			b.WriteString("  tables: " + strings.Join(f.Tables, ", "))
		}
		b.WriteByte('\n')

	case tierTest:
		b.WriteString(f.Path)
		if f.Class != "" {
			b.WriteString("  " + shortName(f.Class))
		}
		b.WriteByte('\n')
		var names []string
		for _, m := range f.Methods {
			if m.Name == "setUp" || m.Name == "tearDown" || m.Name == "__construct" {
				continue
			}
			names = append(names, m.Name)
		}
		if len(names) > 0 {
			b.WriteString("  " + strings.Join(names, " · ") + "\n")
		}
		// Pest no declara métodos: declara casos con una descripción en prosa, que dice la regla de
		// negocio mejor que cualquier nombre. Un tier que sólo mirara métodos los perdería enteros — y
		// en este repo conviven los dos estilos.
		for _, c := range f.Cases {
			b.WriteString("  · " + c + "\n")
		}

	default:
		b.WriteString(f.Path + "\n")
		if f.Class != "" {
			b.WriteString("  class " + f.Class)
			if f.Extends != "" {
				b.WriteString(" extends " + f.Extends)
			}
			b.WriteByte('\n')
		}
		if n := len(f.Props) + len(f.CtorProps); n > 0 {
			pairs := make([]string, 0, n)
			seen := map[string]bool{}
			for k, v := range f.Props {
				pairs = append(pairs, k+":"+v)
				seen[k] = true
			}
			for k, v := range f.CtorProps {
				if !seen[k] {
					pairs = append(pairs, k+":"+v)
				}
			}
			sort.Strings(pairs)
			b.WriteString("  injects " + strings.Join(pairs, " ") + "\n")
		}
		for _, m := range f.Methods {
			b.WriteString("  " + m.Signature + "\n")
		}
	}
	return b.String()
}

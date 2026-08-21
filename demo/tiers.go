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
//	codigo     firma completa de cada método            el default
//	test       clase + NOMBRES de los métodos           3x más barato; el nombre es lo informativo
//	migracion  el archivo + las TABLAS que toca         las firmas up()/down() son 18.697 tokens de
//	                                                    cero información: el nombre ya dice la acción
package main

import (
	"sort"
	"strings"
)

const (
	tierCodigo    = "codigo"
	tierTest      = "test"
	tierMigracion = "migracion"
)

func clasificar(ruta string) string {
	r := strings.ToLower(ruta)
	switch {
	case strings.Contains(r, "/migrations/"):
		return tierMigracion
	case strings.Contains(r, "/tests/") || strings.HasSuffix(r, "test.php"):
		return tierTest
	default:
		return tierCodigo
	}
}

// renderizar — el texto que el mapa entrega de este archivo. Es la MISMA función que mide `bytes_esq`,
// a propósito: un número que no es lo que se manda de verdad es una mentira con formato de medición.
func renderizar(a *archivo) string {
	var b strings.Builder
	switch a.Tier {
	case tierMigracion:
		b.WriteString(a.Ruta)
		if len(a.Tablas) > 0 {
			b.WriteString("  tablas: " + strings.Join(a.Tablas, ", "))
		}
		b.WriteByte('\n')

	case tierTest:
		b.WriteString(a.Ruta)
		if a.Clase != "" {
			b.WriteString("  " + corto(a.Clase))
		}
		b.WriteByte('\n')
		var nombres []string
		for _, m := range a.Metodos {
			if m.Nombre == "setUp" || m.Nombre == "tearDown" || m.Nombre == "__construct" {
				continue
			}
			nombres = append(nombres, m.Nombre)
		}
		if len(nombres) > 0 {
			b.WriteString("  " + strings.Join(nombres, " · ") + "\n")
		}
		// Pest no declara métodos: declara casos con una descripción en prosa, que dice la regla de
		// negocio mejor que cualquier nombre. Un test tier que sólo mirara métodos los perdería
		// enteros — y en este repo conviven los dos estilos.
		for _, c := range a.Casos {
			b.WriteString("  · " + c + "\n")
		}

	default:
		b.WriteString(a.Ruta + "\n")
		if a.Clase != "" {
			b.WriteString("  class " + a.Clase)
			if a.Extiende != "" {
				b.WriteString(" extends " + a.Extiende)
			}
			b.WriteByte('\n')
		}
		if n := len(a.Props) + len(a.Ctor); n > 0 {
			claves := make([]string, 0, n)
			vistos := map[string]bool{}
			for k := range a.Props {
				claves = append(claves, k+":"+a.Props[k])
				vistos[k] = true
			}
			for k, v := range a.Ctor {
				if !vistos[k] {
					claves = append(claves, k+":"+v)
				}
			}
			sort.Strings(claves)
			b.WriteString("  inyecta " + strings.Join(claves, " ") + "\n")
		}
		for _, m := range a.Metodos {
			b.WriteString("  " + m.Firma + "\n")
		}
	}
	return b.String()
}

// Package cliflags traduce los nombres de antes de las opciones de un CLI a los de ahora, antes de que los lea el
// paquete `flag`.
//
// Las opciones de los CLI de my-tools pasaron a inglés el 2026-11-18 (`-tarea` → `-task`, `-todas` → `-all`…). Las de
// antes NO se borran: el Makefile, los hooks y los comandos guardados en las tareas las usan. En vez de declarar cada
// opción dos veces —que las mostraría duplicadas en la ayuda—, se traducen los argumentos: `-h` muestra sólo los
// nombres nuevos y los viejos siguen andando. Es lo mismo que hace `harness/pkg/cli-aliases.ts` para el harness.
package cliflags

import "strings"

// Translate devuelve los argumentos con los nombres de antes cambiados por los de ahora. Reconoce `-viejo`,
// `--viejo`, `-viejo=valor` y `--viejo=valor`; lo que no es una opción (un valor, un argumento suelto, lo que va
// después de `--`) queda igual.
func Translate(args []string, legacy map[string]string) []string {
	out := make([]string, 0, len(args))
	for i, a := range args {
		if a == "--" {
			return append(out, args[i:]...)
		}
		dashes := ""
		switch {
		case strings.HasPrefix(a, "--"):
			dashes = "--"
		case strings.HasPrefix(a, "-"):
			dashes = "-"
		}
		if dashes == "" || len(a) == len(dashes) {
			out = append(out, a)
			continue
		}
		name, value, hasValue := strings.Cut(a[len(dashes):], "=")
		if renamed, ok := legacy[name]; ok {
			name = renamed
		}
		if hasValue {
			out = append(out, dashes+name+"="+value)
		} else {
			out = append(out, dashes+name)
		}
	}
	return out
}

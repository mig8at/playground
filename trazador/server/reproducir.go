package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// REPRODUCIR: cada salida dice con qué comando se la vuelve a sacar, y sabe escribirse como anotación.
//
// EL PORQUÉ. Una medición que no trae su comando envejece sin avisar: el número se pega en una tarea,
// tres semanas después nadie sabe cómo volver a tomarlo, y como no se puede repetir tampoco se puede
// desmentir. Es la misma regla que el tablero ya tiene escrita para las anotaciones —una sin su `Cómo`
// es una afirmación, no una medición— y la que aplica `bitacora-add`, que escribe DE DÓNDE salieron
// los minutos dentro de la nota. Acá se cierra del otro lado: la herramienta entrega el `Cómo` hecho,
// en vez de dejarlo a la memoria de quien pega.
//
// TRES DECISIONES, y las tres se pagaron antes:
//
//  1. El pie imprime el comando de `make`, no la bandera del binario. `-ureq 519245` no se puede correr
//     desde la raíz del playground, que es desde donde se corre todo lo demás; `make trazador-ureq
//     UREQ=519245` sí. Lo que una herramienta te pasa tiene que ser pegable donde estás parado — el
//     buscador venía sugiriendo `-ureq <número>` y obligaba a traducirlo a mano.
//
//  2. El TARGET va SIEMPRE, aunque sea el default. `dev` y `qa` comparten stack de Grafana Y base de
//     datos, así que una salida sin ambiente no se puede repetir ni contrastar: es exactamente la
//     trampa que ya costó corridas creyendo que un cambio estaba roto cuando se miraba la otra rama.
//
//  3. La anotación lleva la fecha REAL del día en que se corrió, no una que escriba quien pega. Una
//     medición con fecha inventada es peor que una sin fecha: parece verificable.

// seguroEnShell son los caracteres que el shell no toca. Todo lo demás se entrecomilla: una consulta
// SQL o un selector de LogQL llevan espacios, llaves y comillas, y pegar eso sin comillar da un error
// de sintaxis que se lee como si la herramienta estuviera rota.
var seguroEnShell = regexp.MustCompile(`^[A-Za-z0-9_@%+=:,./-]+$`)

func comillar(v string) string {
	if seguroEnShell.MatchString(v) {
		return v
	}
	// La forma POSIX de meter una comilla simple dentro de comillas simples: cerrar, escapar, abrir.
	return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
}

// cmdMake arma el comando que vuelve a sacar esta salida. Los pares vacíos se omiten —un `TEL=` colgando
// invita a correrlo tal cual y a preguntarse por qué no anda—, y el target se agrega al final siempre.
func cmdMake(nombre, target string, kv ...string) string {
	partes := []string{"make", nombre}
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i+1] == "" {
			continue
		}
		partes = append(partes, kv[i]+"="+comillar(kv[i+1]))
	}
	if target != "" {
		partes = append(partes, "TARGET="+target)
	}
	return strings.Join(partes, " ")
}

// siHay devuelve el número como texto, o vacío si es cero — para que `cmdMake` lo omita. Un `UREQ=0`
// impreso en el pie se copia y se corre igual, y contesta con una solicitud que no existe.
func siHay(n int64) string {
	if n == 0 {
		return ""
	}
	return fmt.Sprint(n)
}

// pie cierra la salida humana con el comando que la reproduce.
func pie(cmd string) {
	fmt.Printf("\n     %s\n", gray("↻ "+cmd))
}

// vecinoDeTraza dice cuándo conviene la OTRA forense y con qué comando, porque las dos contestan
// «¿qué le pasó a esta solicitud?» y hasta ahora se elegía por accidente.
//
// La diferencia no es de gusto: es de DÓNDE ANCLA cada una. Ésta arranca en la BD —el esqueleto son
// hechos: un estado ocurrió o no— y los logs sólo explican; `harness-loki` arranca en los LOGS (el uReq
// como valor de un campo del context, y de ahí expande por `trace_id`). De eso salen sus fuertes:
// aquélla trae la regla con la que se evaluó cada entidad y el `timeline.ndjson` completo con payloads
// y headers; ésta trae las etapas, los 39 pasos, qué VIO el cliente y qué archivos dejaron rastro. Y
// cuando no hay logs, aquélla no puede decir nada y ésta contesta igual.
//
// ⚠ NO se ofrece contra `prod`: `harness-loki` no lo mira, y mandar ahí a alguien que está depurando
// producción es peor que no decir nada.
//
// ⚠ Y los DEFAULTS son OPUESTOS —`harness-loki` cae a `local`, esta herramienta a `prod`—, así que el
// comando se entrega con el target puesto: cambiar de herramienta sin escribirlo te cambia de ambiente
// sin avisar. Es la misma familia de F-234.
func vecinoDeTraza(target string, ureq int64) (cuando, cmd string, ok bool) {
	if target == "prod" || ureq == 0 {
		return "", "", false
	}
	return "las líneas crudas, con la regla que evaluó a cada entidad",
		cmdMake("harness-loki", target, "UREQ", fmt.Sprint(ureq)), true
}

// vecino imprime la sugerencia de la herramienta de al lado. Glifo distinto al del pie a propósito: `↻`
// repite lo mismo, `↔` te lleva a otra cosa.
func vecino(cuando, cmd string) {
	fmt.Printf("     %s\n", gray("↔ "+cuando+": "+cmd))
}

// anotacionMD escribe la medición en la forma que consume el tablero: el marcador con su tipo y su
// fecha, las líneas de evidencia, y el comando como `Cómo se vuelve a comprobar`. Se pega tal cual en
// «Cómo se comprueba» o en «Lo que está decidido» de una tarea, y de ahí la pestaña Hallazgos la lee.
//
// El tipo es siempre MEDICIÓN: esto sale de correr algo. Una DECISIÓN o un RIESGO los escribe una
// persona, y una herramienta que los generara estaría inventando el juicio, que es justo la parte que
// no se automatiza.
func anotacionMD(resumen, cmd string, evidencia ...string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "> **MEDICIÓN · %s** — %s\n", time.Now().Format("2006-01-02"), resumen)
	for _, l := range evidencia {
		if strings.TrimSpace(l) == "" {
			fmt.Fprint(&b, ">\n")
			continue
		}
		fmt.Fprintf(&b, "> %s\n", l)
	}
	fmt.Fprintf(&b, "> **Cómo se vuelve a comprobar:** `%s`\n", cmd)
	return b.String()
}

// tablaMD arma una tabla de markdown con las filas de una consulta.
//
// Va FUERA de la cita de la anotación a propósito: dentro de `>` markdown no la renderiza como tabla y
// la pestaña Hallazgos la muestra como texto crudo con los pipes a la vista. Una medición que se pega
// y se ve peor que escrita a mano no se vuelve a pegar.
func tablaMD(cols []string, filas []Fila) string {
	if len(cols) == 0 || len(filas) == 0 {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "| %s |\n", strings.Join(cols, " | "))
	fmt.Fprintf(&b, "|%s\n", strings.Repeat("---|", len(cols)))
	for _, f := range filas {
		vals := make([]string, len(cols))
		for i, c := range cols {
			// El pipe se escapa: una celda con `|` adentro parte la fila y corre todas las columnas
			// una posición, que es un dato equivocado con cara de dato bueno.
			vals[i] = strings.ReplaceAll(celda(f[c]), "|", `\|`)
		}
		fmt.Fprintf(&b, "| %s |\n", strings.Join(vals, " | "))
	}
	return b.String()
}

// resumenTraza dice en una línea qué pasó con la solicitud: es lo que va a quedar escrito en la tarea,
// así que nombra el desenlace y DÓNDE se rompió, que es la pregunta con la que se abrió el trazador.
func resumenTraza(t Traza, s *Solicitud) string {
	desenlace := map[string]string{
		"aprobado": "aprobada", "roto": "ROTA", "abandonado": "abandonada", "en-curso": "en curso",
	}[t.Outcome]
	if desenlace == "" {
		desenlace = t.Outcome
	}
	var b strings.Builder
	fmt.Fprintf(&b, "uReq %d en `%s`: %s", t.UReq, t.Target, desenlace)
	if t.BrokeAt != "" {
		fmt.Fprintf(&b, ", se rompió en «%s»", t.BrokeAt)
	}
	if s != nil {
		fmt.Fprintf(&b, " · estado %d «%s»", s.Estado, s.EstadoN)
		if s.Comercio != "" {
			fmt.Fprintf(&b, " · %s", s.Comercio)
		}
		if s.Lender != "" {
			fmt.Fprintf(&b, " · %s (rt=%d)", s.Lender, s.LenderRT)
		}
	}
	fmt.Fprint(&b, ".")
	return b.String()
}

// evidenciaTraza son las líneas que acompañan a la medición: los hallazgos primero —que es el resumen
// de auditoría— y después las fuentes que respondieron, porque «sin eventos de PostHog» y «no miramos
// PostHog» se leen igual en una tarea si nadie dice cuáles se consultaron.
func evidenciaTraza(t Traza) []string {
	var ev []string
	for _, h := range t.Hallazgos {
		ev = append(ev, "✘ "+h)
	}
	if len(t.Pantallas) > 0 {
		ev = append(ev, fmt.Sprintf("El cliente vio %d pantalla(s); la última, `%s`.",
			len(t.Pantallas), t.Pantallas[len(t.Pantallas)-1].Que))
	}
	if len(t.Sources) > 0 {
		ev = append(ev, "Fuentes: "+strings.Join(t.Sources, " · ")+".")
	}
	return ev
}

// ─── LA SALIDA COMO BLOQUE DE LA PILA DE UNA TAREA (`-bloque <tarea>`) ─────────────────────────────
//
// Desde el 2026-09-23 la pila de una tarea del tablero es de BLOQUES: un título —la conclusión, en una
// línea— y una descripción donde cada comando va en su caja con su `Resultado:`. Con `-bloque <id|slug>`
// la salida se agrega sola a la pila de esa tarea, con `via: trazador`: la escribió la herramienta al
// correr, no alguien que la copió.
//
// ⚠ El bloque NO se valida acá: entra por `make tarea-bloque`, que lo pasa por el validador del tablero.
// Una copia de sus reglas en este módulo derivaría en silencio.

var (
	marcadoHTML = strings.NewReplacer("<", "‹", ">", "›")
	rutaLocalRe = regexp.MustCompile(`/(?:Users|home)/[^/\s]+/`)
)

// limpiarBloque saca lo que el validador rechazaría por forma y no por contenido: HTML y rutas de esta
// máquina. Un mensaje de error de la corrida no puede dejar a la tarea sin su bloque.
func limpiarBloque(s string) string {
	return rutaLocalRe.ReplaceAllString(marcadoHTML.Replace(strings.Join(strings.Fields(s), " ")), "…/")
}

// tituloBloque: la conclusión en UNA línea de hasta 120 caracteres, que es el resumen de la corrida.
func tituloBloque(resumen string) string {
	t := strings.TrimSuffix(limpiarBloque(resumen), ".")
	if r := []rune(t); len(r) > 120 {
		t = string(r[:119]) + "…"
	}
	return t
}

// bloqueMD arma el Markdown que recibe `make tarea-bloque`: `# título`, y el comando en su caja con lo
// que dio. Sin evidencia, lo que dio es el resumen.
func bloqueMD(resumen, cmd string, evidencia ...string) string {
	var partes []string
	for _, e := range evidencia {
		if l := limpiarBloque(e); l != "" {
			partes = append(partes, l)
		}
	}
	resultado := strings.Join(partes, "; ")
	if resultado == "" {
		resultado = limpiarBloque(resumen)
	}
	if r := []rune(resultado); len(r) > 2000 {
		resultado = string(r[:1999]) + "…"
	}
	return fmt.Sprintf("# %s\n\n```trazador\n%s\n```\nResultado: %s\n", tituloBloque(resumen), cmd, resultado)
}

// raizPlayground: desde dónde se corre `make`, buscando hacia arriba el directorio del tablero.
func raizPlayground() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "tablero", "server", "go.mod")); err == nil {
			return d, nil
		}
		if filepath.Dir(d) == d {
			return "", fmt.Errorf("no encontré la raíz del playground desde %s", dir)
		}
	}
}

// agregarBloque lo manda a la pila de la tarea por la puerta de siempre.
//
// ⚠ Con el entorno de make LIMPIO: esto corre adentro de un target, y un make hijo hereda por MAKEFLAGS
// las variables de la línea de comando del padre (`TARGET=`, `UREQ=`…). Un `N=` que viniera de afuera
// mandaría el bloque a otra tarea sin decirlo.
func agregarBloque(tarea, md string, seco bool) error {
	raiz, err := raizPlayground()
	if err != nil {
		return err
	}
	args := []string{"-s", "-C", raiz, "tarea-bloque", "N=" + tarea, "ARCHIVO=-", "VIA=trazador"}
	if seco {
		args = append(args, "SECO=1")
	}
	cmd := exec.Command("make", args...)
	cmd.Stdin = strings.NewReader(md)
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); k != "MAKEFLAGS" && k != "MFLAGS" && k != "MAKELEVEL" && k != "MAKEOVERRIDES" {
			cmd.Env = append(cmd.Env, kv)
		}
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		lineas := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lineas) > 3 {
			lineas = lineas[len(lineas)-3:]
		}
		return fmt.Errorf("%s", strings.Join(lineas, " · "))
	}
	return nil
}

// emitirBloque agrega el bloque si se pidió y lo dice. Uno que no entra no cambia la salida de la
// herramienta —la traza es la misma—, pero se dice fuerte: «no se agregó» leído como «se agregó» es
// una tarea sin su prueba.
func emitirBloque(tarea, md string) {
	if tarea == "" {
		return
	}
	if err := agregarBloque(tarea, md, false); err != nil {
		fmt.Printf("\n  %s el bloque NO se agregó a la tarea %s: %v\n", paint("31", "✘"), tarea, err)
		return
	}
	fmt.Printf("\n  ▸ bloque agregado a la pila de la tarea %s\n", tarea)
}

// resultadoFilas resume una consulta en una línea: la única fila entera, o las primeras.
func resultadoFilas(cols []string, filas []Fila) string {
	if len(filas) == 0 {
		return "cero filas."
	}
	fila := func(f Fila) string {
		var vals []string
		for _, c := range cols {
			vals = append(vals, c+" = "+celda(f[c]))
		}
		return strings.Join(vals, " · ")
	}
	if len(filas) == 1 {
		return fila(filas[0]) + "."
	}
	var partes []string
	for i, f := range filas {
		if i == 5 {
			partes = append(partes, fmt.Sprintf("y %d más", len(filas)-5))
			break
		}
		partes = append(partes, "("+fila(f)+")")
	}
	return fmt.Sprintf("%d filas: %s.", len(filas), strings.Join(partes, "; "))
}

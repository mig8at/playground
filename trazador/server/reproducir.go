package main

import (
	"fmt"
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

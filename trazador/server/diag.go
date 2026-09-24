package main

// diag.go — una sola pregunta, medible: ¿el `span_id` alcanza para ubicar las líneas que el TEXTO no
// reclama?
//
// POR QUÉ IMPORTA. Hoy 152 de los 153 patrones del mapa matchean la PROSA del mensaje, y por eso siempre
// queda un resto sin ubicar: `Starting RegisterCellPhoneService::…` no matchea un patrón anclado en
// `^RegisterCellPhone` por culpa del verbo, y declarar una variante por cada forma de escribir lo mismo es
// una carrera que no se gana.
//
// El span es otra clase de llave: no es cómo se REDACTÓ la línea, es en qué unidad de trabajo se emitió
// (una acción de controlador, un método de servicio). Si las líneas huérfanas comparten span con líneas que
// sí se ubican, el mapa puede HEREDAR la etapa del span y el hueco se cierra de raíz en vez de patrón por
// patrón.
//
// Este modo MIDE y REPORTA; no cambia el ensamblado. La decisión de cablearlo se toma con el número.

import (
	"creditop/playground/connectors/logs"
	"fmt"
	"os"
	"sort"
	"time"
)

func spansMode(target string, ureq int64) int {
	c, _ := loadConfig(target)
	stageMap, err := Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "  el mapa no carga: %v\n", err)
		return 2
	}
	source, err := openSource(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente para «%s»: %v\n", target, err)
		return 2
	}
	defer source.Close()
	s, err := GetLoanRequest(source, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	if no := c.loki.Missing(); no != "" {
		fmt.Fprintf(os.Stderr, "  sin logs: %s\n", no)
		return 2
	}
	cl := logs.New(c.loki, 60*time.Second)
	lines, _ := fetchLines(cl, s, c.loki.Env)

	// Fase 1: quién ubica qué, y con qué span.
	type infoSpan struct {
		stages   map[string]int // etapas que el TEXTO asignó a líneas de este span
		unplaced int
		total    int
	}
	spans := map[string]*infoSpan{}
	placed, orphans, withoutSpan := 0, 0, 0
	for _, l := range lines {
		sp := spans[l.span]
		if sp == nil {
			sp = &infoSpan{stages: map[string]int{}}
			spans[l.span] = sp
		}
		sp.total++
		if l.span == "" {
			withoutSpan++
		}
		if id := stageMap.StageOf(l.msg, l.ctx); id != "" {
			placed++
			sp.stages[id]++
		} else {
			orphans++
			sp.unplaced++
		}
	}

	// Fase 2: de las huérfanas, ¿cuántas viven en un span que YA tiene etapa por texto?
	recoverable, ambiguous, lost := 0, 0, 0
	for id, sp := range spans {
		if sp.unplaced == 0 {
			continue
		}
		switch {
		case id == "" || len(sp.stages) == 0:
			lost += sp.unplaced // el span no aporta: ninguna hermana está ubicada
		case len(sp.stages) == 1:
			recoverable += sp.unplaced // una sola etapa en el span: heredar es inequívoco
		default:
			ambiguous += sp.unplaced // el span abarca dos etapas: heredar elegiría mal
		}
	}

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── ¿SIRVE EL SPAN COMO LLAVE? · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %d líneas · %d ubicadas por texto · %d sin ubicar\n", len(lines), placed, orphans)
	fmt.Printf("     %d spans distintos · %s\n\n", len(spans),
		gray(fmt.Sprintf("%d líneas sin span_id", withoutSpan)))

	fmt.Printf("     %s\n", bold("de las sin ubicar:"))
	fmt.Printf("       %s %3d  el span tiene UNA sola etapa → heredar es inequívoco\n", green("✔"), recoverable)
	fmt.Printf("       %s %3d  el span abarca DOS o más etapas → heredar elegiría mal\n", paint("33", "~"), ambiguous)
	fmt.Printf("       %s %3d  el span no aporta (sin span_id, o ninguna hermana ubicada)\n", red("✘"), lost)

	if orphans > 0 && len(lines) > 0 {
		fmt.Printf("\n     %s\n", gray(fmt.Sprintf("cobertura hoy %.0f%% → con herencia por span %.0f%%",
			100*float64(placed)/float64(len(lines)),
			100*float64(placed+recoverable)/float64(len(lines)))))
	}

	// Los spans ambiguos son la parte interesante: dicen qué etapas se solapan de verdad.
	type par struct {
		id     string
		stages map[string]int
		n      int
	}
	var ambiguousPairs []par
	for id, sp := range spans {
		if sp.unplaced > 0 && len(sp.stages) > 1 {
			ambiguousPairs = append(ambiguousPairs, par{id, sp.stages, sp.unplaced})
		}
	}
	sort.Slice(ambiguousPairs, func(i, j int) bool { return ambiguousPairs[i].n > ambiguousPairs[j].n })
	if len(ambiguousPairs) > 0 {
		fmt.Printf("\n     %s\n", bold("spans que abarcan más de una etapa (por qué heredar no es automático):"))
		for i, a := range ambiguousPairs {
			if i == 6 {
				fmt.Printf("       %s\n", gray(fmt.Sprintf("… y %d más", len(ambiguousPairs)-6)))
				break
			}
			var ks []string
			for k, n := range a.stages {
				ks = append(ks, fmt.Sprintf("%s×%d", k, n))
			}
			sort.Strings(ks)
			fmt.Printf("       %s  %d sin ubicar · etapas: %v\n", gray(trim(a.id, 16)), a.n, ks)
		}
	}
	fmt.Println()
	return 0
}

// ─── ¿PODEMOS AFIRMAR QUE ESTAS LÍNEAS SON DE ESTA SOLICITUD? ───────────────────────────────────────
//
// La traza se arma en dos fases: se ANCLA (líneas que nombran el uReq o el user_id) y se EXPANDE (todas las
// líneas de los `trace_id` de esas anclas). La expansión es lo que da el 70 % de la evidencia, y también lo
// único que se puede estar suponiendo: si un `trace_id` toca DOS solicitudes, la traza mezcla dos clientes.
//
// Este modo clasifica cada línea por cuánto se puede afirmar de ella:
//
//	CIERTA        su contexto trae `user_request_id` = esta solicitud. No hay nada que suponer.
//	CONTAMINADA   su contexto trae `user_request_id` = OTRA solicitud. Es un error, no una duda.
//	PROBABLE      trae el `user_id` correcto pero no el uReq. El cliente es el nuestro; la solicitud, no
//	              necesariamente (un cliente con 5 solicitudes es el caso peligroso).
//	POR TRAZA     no trae ninguno de los dos: la ubica sólo el `trace_id`.
//
// Y revisa la trampa del ancla: se ancla con `|= "145"` más «algún campo del contexto vale 145», así que una
// línea con `lender_id = 145` entra como ancla del usuario 145. El modo cuenta por QUÉ CAMPO coincidió.
func anchorsMode(target string, ureq int64) int {
	c, _ := loadConfig(target)
	source, err := openSource(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente para «%s»: %v\n", target, err)
		return 2
	}
	defer source.Close()
	s, err := GetLoanRequest(source, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	if no := c.loki.Missing(); no != "" {
		fmt.Fprintf(os.Stderr, "  sin logs: %s\n", no)
		return 2
	}
	cl := logs.New(c.loki, 60*time.Second)
	lines, _ := fetchLines(cl, s, c.loki.Env)

	mine, otherUReq := asTextValue(s.ID), map[string]int{}
	miUser := asTextValue(s.UserID)
	certain, contaminated, probable, byTrace := 0, 0, 0, 0
	anchorField := map[string]int{}
	for _, l := range lines {
		ur := pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"})
		us := pick(l.ctx, []string{"user_id", "userId"})
		switch {
		case ur == mine:
			certain++
		case ur != "" && ur != mine:
			contaminated++
			otherUReq[ur]++
		case us == miUser && us != "":
			probable++
		default:
			byTrace++
		}
		// ¿Por qué campo coincidió el user_id? Si no es `user_id`, el ancla entró por casualidad.
		for k, v := range l.ctx {
			if asTextValue(v) == miUser {
				anchorField[k]++
			}
		}
	}

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── ¿DE QUIÉN SON ESTAS LÍNEAS? · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %s · %s · lender %s (rt=%d) · user_id %s\n",
		gray(s.Merchant), gray(s.Lender), gray(asTextValue(s.LenderID)), s.LenderRT, gray(miUser))
	fmt.Printf("     %d líneas\n\n", len(lines))
	pct := func(n int) string {
		if len(lines) == 0 {
			return ""
		}
		return fmt.Sprintf(" (%.0f%%)", 100*float64(n)/float64(len(lines)))
	}
	fmt.Printf("       %s %4d%s  CIERTA · su contexto trae este user_request_id\n", green("✔"), certain, pct(certain))
	fmt.Printf("       %s %4d%s  PROBABLE · trae el user_id correcto, no el uReq\n", paint("33", "~"), probable, pct(probable))
	fmt.Printf("       %s %4d%s  POR TRAZA · no trae ninguno de los dos\n", gray("·"), byTrace, pct(byTrace))
	fmt.Printf("       %s %4d%s  CONTAMINADA · trae OTRO user_request_id\n", red("✘"), contaminated, pct(contaminated))
	if len(otherUReq) > 0 {
		var ks []string
		for k, n := range otherUReq {
			ks = append(ks, fmt.Sprintf("%s×%d", k, n))
		}
		sort.Strings(ks)
		fmt.Printf("           %s\n", red(fmt.Sprintf("solicitudes ajenas mezcladas: %v", ks)))
	}
	if len(anchorField) > 0 {
		var ks []string
		for k, n := range anchorField {
			ks = append(ks, fmt.Sprintf("%s×%d", k, n))
		}
		sort.Strings(ks)
		fmt.Printf("\n     %s %v\n", gray("campos cuyo valor coincide con el user_id:"), ks)
	}
	fmt.Println()
	return 0
}

// ─── ¿QUÉ CAMPOS TRAEN LAS LÍNEAS? ─────────────────────────────────────────────────────────────────
//
// El mapa matchea PROSA porque nunca se midió qué más viene en el contexto. Este modo cuenta la presencia de
// cada campo sobre las líneas reales de una solicitud: lo que aparece en casi todas es una llave candidata
// para dejar de leer texto.
func fieldsMode(target string, ureq int64) int {
	c, _ := loadConfig(target)
	source, err := openSource(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente: %v\n", err)
		return 2
	}
	defer source.Close()
	s, err := GetLoanRequest(source, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	cl := logs.New(c.loki, 60*time.Second)
	lines, _ := fetchLines(cl, s, c.loki.Env)

	presence := map[string]int{}
	values := map[string]map[string]bool{}
	for _, l := range lines {
		for k, v := range l.ctx {
			presence[k]++
			if values[k] == nil {
				values[k] = map[string]bool{}
			}
			if len(values[k]) < 40 {
				values[k][trim(asTextValue(v), 40)] = true
			}
		}
	}
	type par struct {
		k, sample  string
		n, uniques int
	}
	var ps []par
	for k, n := range presence {
		var one string
		for v := range values[k] {
			one = v
			break
		}
		ps = append(ps, par{k, one, n, len(values[k])})
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].n > ps[j].n })

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── CAMPOS DEL CONTEXTO · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %d líneas · %d campos distintos\n\n", len(lines), len(presence))
	fmt.Printf("     %-30s %6s %5s  %s\n", "campo", "en", "%", "valores distintos / muestra")
	for i, p := range ps {
		if i == 22 {
			fmt.Printf("     %s\n", gray(fmt.Sprintf("… y %d campos más", len(ps)-22)))
			break
		}
		pct := 100 * float64(p.n) / float64(max(1, len(lines)))
		mark := " "
		if pct >= 90 {
			mark = green("★") // candidato a llave: está en casi todas
		}
		fmt.Printf("   %s %-30s %6d %4.0f%%  %s\n", mark, trim(p.k, 30), p.n, pct,
			gray(fmt.Sprintf("%d · %s", p.uniques, p.sample)))
	}
	fmt.Println()
	return 0
}

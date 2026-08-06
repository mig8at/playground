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
	"fmt"
	"net/http"
	"os"
	"sort"
	"time"
)

func modoSpans(target string, ureq int64) int {
	c, _ := loadConfig(target)
	mapa, err := Cargar()
	if err != nil {
		fmt.Fprintf(os.Stderr, "  el mapa no carga: %v\n", err)
		return 2
	}
	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente para «%s»: %v\n", target, err)
		return 2
	}
	defer fuente.Close()
	s, err := GetSolicitud(fuente, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	if no := porQueNoLoki(c); no != "" {
		fmt.Fprintf(os.Stderr, "  sin logs: %s\n", no)
		return 2
	}
	cl := &client{http: &http.Client{Timeout: 60 * time.Second}, cfg: c,
		current: attempt{base: c.base, auth: authDe(c)}}
	lineas, _ := traerLineas(cl, s, c.env)

	// Fase 1: quién ubica qué, y con qué span.
	type infoSpan struct {
		etapas    map[string]int // etapas que el TEXTO asignó a líneas de este span
		sinUbicar int
		total     int
	}
	spans := map[string]*infoSpan{}
	ubicadas, huerfanas, sinSpan := 0, 0, 0
	for _, l := range lineas {
		sp := spans[l.span]
		if sp == nil {
			sp = &infoSpan{etapas: map[string]int{}}
			spans[l.span] = sp
		}
		sp.total++
		if l.span == "" {
			sinSpan++
		}
		if id := mapa.EtapaDe(l.msg, l.ctx); id != "" {
			ubicadas++
			sp.etapas[id]++
		} else {
			huerfanas++
			sp.sinUbicar++
		}
	}

	// Fase 2: de las huérfanas, ¿cuántas viven en un span que YA tiene etapa por texto?
	rescatables, ambiguas, perdidas := 0, 0, 0
	for id, sp := range spans {
		if sp.sinUbicar == 0 {
			continue
		}
		switch {
		case id == "" || len(sp.etapas) == 0:
			perdidas += sp.sinUbicar // el span no aporta: ninguna hermana está ubicada
		case len(sp.etapas) == 1:
			rescatables += sp.sinUbicar // una sola etapa en el span: heredar es inequívoco
		default:
			ambiguas += sp.sinUbicar // el span abarca dos etapas: heredar elegiría mal
		}
	}

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── ¿SIRVE EL SPAN COMO LLAVE? · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %d líneas · %d ubicadas por texto · %d sin ubicar\n", len(lineas), ubicadas, huerfanas)
	fmt.Printf("     %d spans distintos · %s\n\n", len(spans),
		gray(fmt.Sprintf("%d líneas sin span_id", sinSpan)))

	fmt.Printf("     %s\n", bold("de las sin ubicar:"))
	fmt.Printf("       %s %3d  el span tiene UNA sola etapa → heredar es inequívoco\n", green("✔"), rescatables)
	fmt.Printf("       %s %3d  el span abarca DOS o más etapas → heredar elegiría mal\n", paint("33", "~"), ambiguas)
	fmt.Printf("       %s %3d  el span no aporta (sin span_id, o ninguna hermana ubicada)\n", red("✘"), perdidas)

	if huerfanas > 0 && len(lineas) > 0 {
		fmt.Printf("\n     %s\n", gray(fmt.Sprintf("cobertura hoy %.0f%% → con herencia por span %.0f%%",
			100*float64(ubicadas)/float64(len(lineas)),
			100*float64(ubicadas+rescatables)/float64(len(lineas)))))
	}

	// Los spans ambiguos son la parte interesante: dicen qué etapas se solapan de verdad.
	type par struct {
		id     string
		etapas map[string]int
		n      int
	}
	var amb []par
	for id, sp := range spans {
		if sp.sinUbicar > 0 && len(sp.etapas) > 1 {
			amb = append(amb, par{id, sp.etapas, sp.sinUbicar})
		}
	}
	sort.Slice(amb, func(i, j int) bool { return amb[i].n > amb[j].n })
	if len(amb) > 0 {
		fmt.Printf("\n     %s\n", bold("spans que abarcan más de una etapa (por qué heredar no es automático):"))
		for i, a := range amb {
			if i == 6 {
				fmt.Printf("       %s\n", gray(fmt.Sprintf("… y %d más", len(amb)-6)))
				break
			}
			var ks []string
			for k, n := range a.etapas {
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
func modoAnclas(target string, ureq int64) int {
	c, _ := loadConfig(target)
	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente para «%s»: %v\n", target, err)
		return 2
	}
	defer fuente.Close()
	s, err := GetSolicitud(fuente, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	if no := porQueNoLoki(c); no != "" {
		fmt.Fprintf(os.Stderr, "  sin logs: %s\n", no)
		return 2
	}
	cl := &client{http: &http.Client{Timeout: 60 * time.Second}, cfg: c,
		current: attempt{base: c.base, auth: authDe(c)}}
	lineas, _ := traerLineas(cl, s, c.env)

	mio, otroUReq := comoTexto(s.ID), map[string]int{}
	miUser := comoTexto(s.UserID)
	cierta, contaminada, probable, porTraza := 0, 0, 0, 0
	campoAncla := map[string]int{}
	for _, l := range lineas {
		ur := pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"})
		us := pick(l.ctx, []string{"user_id", "userId"})
		switch {
		case ur == mio:
			cierta++
		case ur != "" && ur != mio:
			contaminada++
			otroUReq[ur]++
		case us == miUser && us != "":
			probable++
		default:
			porTraza++
		}
		// ¿Por qué campo coincidió el user_id? Si no es `user_id`, el ancla entró por casualidad.
		for k, v := range l.ctx {
			if comoTexto(v) == miUser {
				campoAncla[k]++
			}
		}
	}

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── ¿DE QUIÉN SON ESTAS LÍNEAS? · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %s · %s · lender %s (rt=%d) · user_id %s\n",
		gray(s.Comercio), gray(s.Lender), gray(comoTexto(s.LenderID)), s.LenderRT, gray(miUser))
	fmt.Printf("     %d líneas\n\n", len(lineas))
	pct := func(n int) string {
		if len(lineas) == 0 {
			return ""
		}
		return fmt.Sprintf(" (%.0f%%)", 100*float64(n)/float64(len(lineas)))
	}
	fmt.Printf("       %s %4d%s  CIERTA · su contexto trae este user_request_id\n", green("✔"), cierta, pct(cierta))
	fmt.Printf("       %s %4d%s  PROBABLE · trae el user_id correcto, no el uReq\n", paint("33", "~"), probable, pct(probable))
	fmt.Printf("       %s %4d%s  POR TRAZA · no trae ninguno de los dos\n", gray("·"), porTraza, pct(porTraza))
	fmt.Printf("       %s %4d%s  CONTAMINADA · trae OTRO user_request_id\n", red("✘"), contaminada, pct(contaminada))
	if len(otroUReq) > 0 {
		var ks []string
		for k, n := range otroUReq {
			ks = append(ks, fmt.Sprintf("%s×%d", k, n))
		}
		sort.Strings(ks)
		fmt.Printf("           %s\n", red(fmt.Sprintf("solicitudes ajenas mezcladas: %v", ks)))
	}
	if len(campoAncla) > 0 {
		var ks []string
		for k, n := range campoAncla {
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
func modoCampos(target string, ureq int64) int {
	c, _ := loadConfig(target)
	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  sin fuente: %v\n", err)
		return 2
	}
	defer fuente.Close()
	s, err := GetSolicitud(fuente, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %v\n", err)
		return 2
	}
	cl := &client{http: &http.Client{Timeout: 60 * time.Second}, cfg: c,
		current: attempt{base: c.base, auth: authDe(c)}}
	lineas, _ := traerLineas(cl, s, c.env)

	presencia := map[string]int{}
	valores := map[string]map[string]bool{}
	for _, l := range lineas {
		for k, v := range l.ctx {
			presencia[k]++
			if valores[k] == nil {
				valores[k] = map[string]bool{}
			}
			if len(valores[k]) < 40 {
				valores[k][trim(comoTexto(v), 40)] = true
			}
		}
	}
	type par struct {
		k, muestra string
		n, únicos  int
	}
	var ps []par
	for k, n := range presencia {
		var uno string
		for v := range valores[k] {
			uno = v
			break
		}
		ps = append(ps, par{k, uno, n, len(valores[k])})
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].n > ps[j].n })

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── CAMPOS DEL CONTEXTO · uReq %d · %s ──", ureq, target)))
	fmt.Printf("     %d líneas · %d campos distintos\n\n", len(lineas), len(presencia))
	fmt.Printf("     %-30s %6s %5s  %s\n", "campo", "en", "%", "valores distintos / muestra")
	for i, p := range ps {
		if i == 22 {
			fmt.Printf("     %s\n", gray(fmt.Sprintf("… y %d campos más", len(ps)-22)))
			break
		}
		pct := 100 * float64(p.n) / float64(max(1, len(lineas)))
		marca := " "
		if pct >= 90 {
			marca = green("★") // candidato a llave: está en casi todas
		}
		fmt.Printf("   %s %-30s %6d %4.0f%%  %s\n", marca, trim(p.k, 30), p.n, pct,
			gray(fmt.Sprintf("%d · %s", p.únicos, p.muestra)))
	}
	fmt.Println()
	return 0
}

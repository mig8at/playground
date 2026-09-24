// slack.go — el canal de #tech-ops como HERRAMIENTA DEL AGENTE, no de la UI.
//
// POR QUÉ NO ESTÁ EN LA VUE, y es una decisión, no una omisión: la Vue es para que un humano mire una
// solicitud. Leer Slack sirve para lo otro — entender QUÉ se rompe seguido y si el trazador sirve para
// eso. Meterlo en la UI invitaría a que la herramienta de soporte empiece a escribir en el canal donde el
// equipo reporta incidentes, y una herramienta que puede escribir ahí algún día escribe.
//
// POR ESO: solo LECTURA y solo por consola. `-slack` lee y clasifica; no hay comando para publicar.
//
// EL TOKEN es `SLACK_BOT_TOKEN`, y lo resuelve `connectors/slack` desde `connectors/.env` (el proceso gana).
// Hasta el 2026-09-24 se exportaba a mano en la shell, para no dejar un token de escritura en un `.env`
// de acá; hoy vive en UN solo archivo gitignoreado para todo el playground, que es menos superficie que uno
// por herramienta.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/slack"
)

// techOpsChannel es donde el equipo reporta incidentes.
const techOpsChannel = "C08UCU5E90S"

// category clasifica un reporte por el SÍNTOMA que describe, y dice si el trazador lo puede contestar.
//
// Las categorías salieron de leer el canal, no de imaginarlas: son los síntomas que el equipo escribe de
// verdad. `cobertura` es lo que hace útil esta clasificación — separa «el trazador contesta esto» de «el
// trazador no tiene nada que decir acá», que es la pregunta que motivó el barrido.
type category struct {
	id       string
	label    string
	re       *regexp.Regexp
	coverage string // directa | parcial | fuera
	because  string
}

var categories = []category{
	{"agregador-estado", "El agregador aprobó pero CT quedó atrás",
		regexp.MustCompile(`(?i)(prami|welli|addi|sistecr).{0,80}(selecc|qued|no cambi|no.{0,10}actualiz|no termin)|` +
			`(selecc\w+ entidad|no termin\w+ proceso).{0,80}(prami|welli|origin)`),
		"parcial", "el trazador prueba que la solicitud NO avanzó y muestra su último estado, pero la causa " +
			"suele estar en el webhook del agregador, que hoy NO está en el mapa de etapas"},
	{"voucher", "Voucher o comprobante que no sale / sale mal",
		regexp.MustCompile(`(?i)voucher|comprobante|soporte de pago|no.{0,15}descargar`),
		"parcial", "hay logs de `Failed to generate PDF` y `voucher_disbursement_notification_failed`, " +
			"pero la generación vive después del cierre y no está mapeada como etapa"},
	{"formulario", "No consultó el buró / resultado raro del buró",
		regexp.MustCompile(`(?i)no consulta|no.{0,12}est\w+ consultando|credifamilia.{0,30}no|aml|datacr[eé]dito|` +
			`experian|no coincide`),
		"directa", "es exactamente el bloque STAGE 0..4 + el árbol de las 12 centrales: dice por qué NO se " +
			"consultó, que es la pregunta"},
	{"perfilamiento", "Perfilamiento, cupo o cuotas mal",
		regexp.MustCompile(`(?i)perfil\w*|cuotas|cupo|probabilidad|tasa|fondo de garant|monto m[aá]ximo`),
		"directa", "`QUOTA_CHECK_REJECTED` trae `reason`, `CATEGORY_RULE_REJECTED` trae `rule_id` y " +
			"`DatacreditoRuleEvaluator` compara `user_score` contra `rule_min_score`: es el porqué literal"},
	{"firma", "Falla al firmar (Netco / Deceval)",
		regexp.MustCompile(`(?i)firm\w+|pagar[eé]|deceval|netco`),
		"parcial", "los errores de Netco y Deceval están en los logs, pero del cierre EXITOSO casi no hay " +
			"log: esa parte se prueba por BD"},
	{"pantalla", "Error en pantalla sin más pistas",
		regexp.MustCompile(`(?i)(este|el) error|error en|sale este|no le cambia|no cambia esta pantalla|` +
			`solicitud cancelada|403`),
		"directa", "los códigos ONB00x con su `error_code`/`subcode` y el epicentro del primer error"},
	{"link-otp", "No llega el link o el OTP",
		regexp.MustCompile(`(?i)no.{0,12}llega.{0,12}(el )?link|twilio|otp`),
		"directa", "la etapa `registro` trae el envío y la validación del OTP con sus reintentos"},
	{"cartera", "Cartera, pagos, fechas o plan de pagos",
		regexp.MustCompile(`(?i)fecha pr[oó]ximo pago|plan de pagos|estado de cuenta|no aparece el cr[eé]dito|` +
			`pago|mora|dispersi[oó]n|liquidar|cobranza`),
		"fuera", "es servicing: ocurre DESPUÉS del Estado 11 y el trazador termina en el desembolso"},
	{"imei", "SmartPay · IMEI · Trustonic",
		regexp.MustCompile(`(?i)imei|trustonic|smartpay|smart pay`),
		"fuera", "el bloqueo de dispositivo lo manejan los crons de MDM, fuera del flujo de originación"},
	{"fraude", "Suplantación o fraude",
		regexp.MustCompile(`(?i)suplantaci[oó]n|no.{0,15}autoriz\w+ dat|c[eé]dula.{0,10}(es )?falsa`),
		"fuera", "es investigación, no diagnóstico técnico: el trazador puede dar la evidencia pero no resuelve"},
}

// slackMessage es el mensaje del conector; el alias conserva el nombre con que lo usa este archivo.
type slackMessage = slack.Message

// hit es un reporte ya clasificado —o sin clasificar, que es el caso que importa acá.
type hit struct {
	cat  string
	text string
	ts   time.Time
}

// classifyReports es la parte PURA: separa los reportes del ruido y los reparte en categorías.
// Está afuera de slackMode para poder probarla sin red, porque lo que se equivocó vivía acá.
//
// ⚠ `withoutCat` NO es un descarte: es lo que ninguna regex reconoció, y hasta el 2026-09-21 se contaba
// y se tiraba. Eso hacía que el veredicto se calculara sobre los clasificados —o sea sobre lo que
// alguien ya había pensado en cubrir— y un canal donde la mitad no matchea se leía igual que uno
// cubierto entero. Es el patrón de siempre: devolver MENOS se lee igual que «no existe». Ahora los
// reportes vuelven con su texto para poder MIRARLOS (`-slack-sin`), que es lo que dice si falta una
// categoría o si es ruido.
func classifyReports(msgs []slackMessage) (hits, withoutCat []hit, byCat map[string]int) {
	byCat = map[string]int{}
	for _, m := range msgs {
		// Un reporte = un mensaje que describe un síntoma. Se descartan los de una línea sin verbo (los
		// «gracias», los «dale», las cédulas sueltas) porque inflarían el conteo sin ser incidentes.
		if m.BotID != "" || len(strings.Fields(m.Text)) < 4 {
			continue
		}
		found := ""
		for _, c := range categories {
			if c.re.MatchString(m.Text) {
				found = c.id
				break
			}
		}
		if found == "" {
			withoutCat = append(withoutCat, hit{"", m.Text, tsAt(m.TS)})
			continue
		}
		byCat[found]++
		hits = append(hits, hit{found, m.Text, tsAt(m.TS)})
	}
	return hits, withoutCat, byCat
}

// slackMode lee el canal y clasifica. Devuelve el exit code.
func slackMode(days int, listUnclassified bool) int {
	token, ok := slackToken()
	if !ok {
		return 2
	}
	since := time.Now().AddDate(0, 0, -days)
	msgs, err := readChannel(token, techOpsChannel, since)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
		return 2
	}

	hits, withoutCat, byCat := classifyReports(msgs)
	unclassified := len(withoutCat)

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── #tech-ops · últimos %d días ──", days)))
	fmt.Printf("     %d mensajes · %d con síntoma clasificable · %d sin clasificar\n",
		len(msgs), len(hits), unclassified)

	// Se ordena por cobertura y después por volumen: lo que más se repite Y el trazador contesta va arriba.
	prio := map[string]int{"directa": 0, "parcial": 1, "fuera": 2}
	order := make([]category, len(categories))
	copy(order, categories)
	sort.SliceStable(order, func(i, j int) bool {
		if prio[order[i].coverage] != prio[order[j].coverage] {
			return prio[order[i].coverage] < prio[order[j].coverage]
		}
		return byCat[order[i].id] > byCat[order[j].id]
	})

	tot := map[string]int{}
	lastOne := ""
	for _, c := range order {
		if c.coverage != lastOne {
			lastOne = c.coverage
			label := map[string]string{
				"directa": green("EL TRAZADOR LO CONTESTA"),
				"parcial": paint("33", "LO CONTESTA A MEDIAS"),
				"fuera":   red("FUERA DE ALCANCE"),
			}[c.coverage]
			fmt.Printf("\n  %s\n", bold("── "+label+" ──"))
		}
		n := byCat[c.id]
		tot[c.coverage] += n
		bar := strings.Repeat("█", min(30, n))
		fmt.Printf("     %2d %-30s %s\n", n, bar, c.label)
		if c.because != "" {
			fmt.Printf("        %s\n", gray(trim(c.because, 130)))
		}
	}

	// ⚠ El denominador son TODOS los reportes, no sólo los clasificados. Con los clasificados, los
	// tres porcentajes sumaban 100 % y el veredicto se leía como una medida del canal cuando era una
	// medida de las regex: un reporte que ninguna reconoce no es «fuera de alcance» —eso es un
	// juicio— sino que NO SE SABE, y esa diferencia es justo la que decide si vale la pena mejorar
	// esto. Por eso «sin clasificar» es un cuarto renglón y no un descarte silencioso.
	sum := tot["directa"] + tot["parcial"] + tot["fuera"] + unclassified
	if sum > 0 {
		fmt.Printf("\n  %s\n", bold("── VEREDICTO ──"))
		pc := func(n int) string { return fmt.Sprintf("%d (%.0f%%)", n, 100*float64(n)/float64(sum)) }
		fmt.Printf("     %s contesta directo · %s a medias · %s fuera de alcance\n",
			green(pc(tot["directa"])), paint("33", pc(tot["parcial"])), red(pc(tot["fuera"])))
		fmt.Printf("     %s sin clasificar — ninguna regex los reconoció, así que de estos NO SE SABE\n", bold(pc(unclassified)))
		fmt.Printf("     %s\n", gray("sobre "+strconv.Itoa(sum)+" reportes; los porcentajes son del canal, no de lo que las regex entendieron"))
	}

	// Lo que no matcheó, a la vista. Va OPT-IN porque es texto real del canal —con cédulas, teléfonos
	// y nombres— y no tiene por qué aparecer en pantalla cada vez que alguien mira el resumen.
	if listUnclassified && unclassified > 0 {
		fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── SIN CLASIFICAR (%d) ──", unclassified)))
		fmt.Printf("     %s\n", gray("o falta una categoría, o no son reportes. Leelos antes de agregar una regex —o un modelo."))
		for _, h := range withoutCat {
			fmt.Printf("     %s  %s\n", gray(h.ts.Format("2006-01-02")), trim(strings.Join(strings.Fields(h.text), " "), 150))
		}
	} else if unclassified > 0 {
		fmt.Printf("\n  %s\n", gray(fmt.Sprintf("los %d sin clasificar, uno por uno: make trazador-slack DIAS=%d SIN=1", unclassified, days)))
	}
	fmt.Println()
	return 0
}

// slackToken es el token del bot, o dice qué falta.
func slackToken() (string, bool) {
	cfg, err := slack.LoadConfig()
	if err == nil && cfg.BotToken != "" {
		return cfg.BotToken, true
	}
	if err == nil {
		err = slack.ErrNoBotToken
	}
	fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
	return "", false
}

func readChannel(token, channel string, since time.Time) ([]slackMessage, error) {
	return slack.New(token).History(context.Background(), channel, since, 12)
}

func tsAt(ts string) time.Time {
	sec, _, _ := strings.Cut(ts, ".")
	n, _ := strconv.ParseInt(sec, 10, 64)
	return time.Unix(n, 0)
}

// readThread trae las respuestas de un mensaje. Es lo que permite contrastar el REPORTE con su RESOLUCIÓN:
// sin esto, medir «¿el trazador contestaría esto?» es una opinión sobre el título del incidente. Con la
// respuesta del humano al lado, la pregunta pasa a ser verificable — ¿el trazador muestra ESE dato?
//
// Sólo lectura, igual que el resto de este archivo: `conversations.replies` no escribe nada.
func readThread(token, channel, ts string) ([]slackMessage, error) {
	return slack.New(token).Replies(context.Background(), channel, ts, 60)
}

// incidentsMode vuelca los reportes CON SU HILO, para leerlos y juzgar de verdad si el trazador los
// contesta. NO clasifica: eso es lo que hace `slackMode` con regex, y ese enfoque tiene un techo — la
// etiqueta `directa|parcial|fuera` está cableada por categoría, o sea que mide MI SUPOSICIÓN sobre el tipo
// de incidente, no el caso. Acá el código sólo junta el material; el juicio lo hace quien lee.
func incidentsMode(days int) int {
	token, ok := slackToken()
	if !ok {
		return 2
	}
	msgs, err := readChannel(token, techOpsChannel, time.Now().AddDate(0, 0, -days))
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
		return 2
	}
	clean := func(s string) string {
		s = strings.ReplaceAll(s, "\n", " ⏎ ")
		return strings.Join(strings.Fields(s), " ")
	}
	n := 0
	fmt.Printf("\n  %s\n\n", bold(fmt.Sprintf("── INCIDENCIAS CON SU HILO · últimos %d días ──", days)))
	for _, m := range msgs {
		// Con hilo y con cuerpo: un reporte sin respuestas no se resolvió acá y no sirve para contrastar.
		if m.BotID != "" || m.ReplyCount == 0 || len(strings.Fields(m.Text)) < 5 {
			continue
		}
		n++
		fmt.Printf("  %s [%s · %d respuestas]\n", bold(fmt.Sprintf("#%d", n)),
			tsAt(m.TS).Format("01-02 15:04"), m.ReplyCount)
		fmt.Printf("     %s %s\n", paint("36", "PREGUNTA:"), clean(m.Text))
		rs, err := readThread(token, techOpsChannel, m.TS)
		if err != nil {
			fmt.Printf("     %s\n", gray("(no pude leer el hilo: "+err.Error()+")"))
		}
		for _, r := range rs {
			if r.BotID != "" || len(strings.Fields(r.Text)) < 2 {
				continue
			}
			fmt.Printf("     %s %s\n", paint("32", "→"), clean(r.Text))
		}
		fmt.Println()
	}
	fmt.Printf("  %s\n\n", gray(fmt.Sprintf("%d reportes CON hilo, de %d mensajes leídos", n, len(msgs))))
	return 0
}

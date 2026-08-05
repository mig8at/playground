// slack.go — el canal de #tech-ops como HERRAMIENTA DEL AGENTE, no de la UI.
//
// POR QUÉ NO ESTÁ EN LA VUE, y es una decisión, no una omisión: la Vue es para que un humano mire una
// solicitud. Leer Slack sirve para lo otro — entender QUÉ se rompe seguido y si el trazador sirve para
// eso. Meterlo en la UI invitaría a que la herramienta de soporte empiece a escribir en el canal donde el
// equipo reporta incidentes, y una herramienta que puede escribir ahí algún día escribe.
//
// POR ESO: solo LECTURA y solo por consola. `-slack` lee y clasifica; no hay comando para publicar.
//
// EL TOKEN se toma de `SLACK_BOT_TOKEN` (el mismo nombre que usa `tablero/server/cmd/slack-mcp`, para no
// tener dos convenciones) y NO se guarda en ningún `.env` de acá: se exporta en la shell cuando se usa.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// canalTechOps es donde el equipo reporta incidentes.
const canalTechOps = "C08UCU5E90S"

// categoria clasifica un reporte por el SÍNTOMA que describe, y dice si el trazador lo puede contestar.
//
// Las categorías salieron de leer el canal, no de imaginarlas: son los síntomas que el equipo escribe de
// verdad. `cobertura` es lo que hace útil esta clasificación — separa «el trazador contesta esto» de «el
// trazador no tiene nada que decir acá», que es la pregunta que motivó el barrido.
type categoria struct {
	id        string
	label     string
	re        *regexp.Regexp
	cobertura string // directa | parcial | fuera
	porque    string
}

var categorias = []categoria{
	{"agregador-estado", "El agregador aprobó pero CT quedó atrás",
		regexp.MustCompile(`(?i)(prami|welli|addi|sistecr).{0,80}(selecc|qued|no cambi|no.{0,10}actualiz|no termin)|` +
			`(selecc\w+ entidad|no termin\w+ proceso).{0,80}(prami|welli|origin)`),
		"parcial", "el trazador prueba que la solicitud NO avanzó y muestra su último estado, pero la causa " +
			"suele estar en el webhook del agregador, que hoy NO está en el mapa de etapas"},
	{"voucher", "Voucher o comprobante que no sale / sale mal",
		regexp.MustCompile(`(?i)voucher|comprobante|soporte de pago|no.{0,15}descargar`),
		"parcial", "hay logs de `Failed to generate PDF` y `voucher_disbursement_notification_failed`, " +
			"pero la generación vive después del cierre y no está mapeada como etapa"},
	{"buro", "No consultó el buró / resultado raro del buró",
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

type mensajeSlack struct {
	TS   string `json:"ts"`
	User string `json:"user"`
	Text string `json:"text"`
	Bot  string `json:"bot_id"`
}

// modoSlack lee el canal y clasifica. Devuelve el exit code.
func modoSlack(dias int) int {
	token := strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN"))
	if token == "" {
		fmt.Fprintf(os.Stderr, "\n  %s falta SLACK_BOT_TOKEN.\n", paint("31", "✘"))
		fmt.Fprintf(os.Stderr, "  Es el mismo nombre que usa tablero/server/cmd/slack-mcp. Exportalo en la shell:\n")
		fmt.Fprintf(os.Stderr, "  no vive en ningún .env de acá a propósito — un token de escritura en un archivo\n")
		fmt.Fprintf(os.Stderr, "  es un token que algún día se commitea.\n\n")
		return 2
	}
	desde := time.Now().AddDate(0, 0, -dias)
	msgs, err := leerCanal(token, canalTechOps, desde)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
		return 2
	}

	// Un reporte = un mensaje que describe un síntoma. Se descartan los de una línea sin verbo (los
	// «gracias», los «dale», las cédulas sueltas) porque inflarían el conteo sin ser incidentes.
	type hit struct {
		cat  string
		text string
		ts   time.Time
	}
	var hits []hit
	porCat := map[string]int{}
	sinClasificar := 0
	for _, m := range msgs {
		if m.Bot != "" || len(strings.Fields(m.Text)) < 4 {
			continue
		}
		encontrada := ""
		for _, c := range categorias {
			if c.re.MatchString(m.Text) {
				encontrada = c.id
				break
			}
		}
		if encontrada == "" {
			sinClasificar++
			continue
		}
		porCat[encontrada]++
		hits = append(hits, hit{encontrada, m.Text, tsAt(m.TS)})
	}

	fmt.Printf("\n  %s\n", bold(fmt.Sprintf("── #tech-ops · últimos %d días ──", dias)))
	fmt.Printf("     %d mensajes · %d con síntoma clasificable · %d sin clasificar\n",
		len(msgs), len(hits), sinClasificar)

	// Se ordena por cobertura y después por volumen: lo que más se repite Y el trazador contesta va arriba.
	prio := map[string]int{"directa": 0, "parcial": 1, "fuera": 2}
	orden := make([]categoria, len(categorias))
	copy(orden, categorias)
	sort.SliceStable(orden, func(i, j int) bool {
		if prio[orden[i].cobertura] != prio[orden[j].cobertura] {
			return prio[orden[i].cobertura] < prio[orden[j].cobertura]
		}
		return porCat[orden[i].id] > porCat[orden[j].id]
	})

	tot := map[string]int{}
	ultima := ""
	for _, c := range orden {
		if c.cobertura != ultima {
			ultima = c.cobertura
			etiqueta := map[string]string{
				"directa": green("EL TRAZADOR LO CONTESTA"),
				"parcial": paint("33", "LO CONTESTA A MEDIAS"),
				"fuera":   red("FUERA DE ALCANCE"),
			}[c.cobertura]
			fmt.Printf("\n  %s\n", bold("── "+etiqueta+" ──"))
		}
		n := porCat[c.id]
		tot[c.cobertura] += n
		barra := strings.Repeat("█", min(30, n))
		fmt.Printf("     %2d %-30s %s\n", n, barra, c.label)
		if c.porque != "" {
			fmt.Printf("        %s\n", gray(trim(c.porque, 130)))
		}
	}

	sum := tot["directa"] + tot["parcial"] + tot["fuera"]
	if sum > 0 {
		fmt.Printf("\n  %s\n", bold("── VEREDICTO ──"))
		pc := func(n int) string { return fmt.Sprintf("%d (%.0f%%)", n, 100*float64(n)/float64(sum)) }
		fmt.Printf("     %s contesta directo · %s a medias · %s fuera de alcance\n",
			green(pc(tot["directa"])), paint("33", pc(tot["parcial"])), red(pc(tot["fuera"])))
	}
	fmt.Println()
	return 0
}

func leerCanal(token, canal string, desde time.Time) ([]mensajeSlack, error) {
	var todos []mensajeSlack
	cursor := ""
	hc := &http.Client{Timeout: 30 * time.Second}
	for pagina := 0; pagina < 12; pagina++ {
		q := url.Values{
			"channel": {canal},
			"limit":   {"200"},
			"oldest":  {strconv.FormatInt(desde.Unix(), 10)},
		}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		req, _ := http.NewRequest("GET", "https://slack.com/api/conversations.history?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := hc.Do(req)
		if err != nil {
			return nil, err
		}
		var body struct {
			OK       bool           `json:"ok"`
			Error    string         `json:"error"`
			Messages []mensajeSlack `json:"messages"`
			Meta     struct {
				Next string `json:"next_cursor"`
			} `json:"response_metadata"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if !body.OK {
			return nil, fmt.Errorf("slack: %s", body.Error)
		}
		todos = append(todos, body.Messages...)
		cursor = body.Meta.Next
		if cursor == "" {
			break
		}
	}
	return todos, nil
}

func tsAt(ts string) time.Time {
	sec, _, _ := strings.Cut(ts, ".")
	n, _ := strconv.ParseInt(sec, 10, 64)
	return time.Unix(n, 0)
}

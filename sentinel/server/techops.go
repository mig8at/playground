package main

// LOS CASOS DE #tech-ops EN LA MEMORIA. Idea de Miguel (2026-11-26): que el informe cruce lo que reporta operaciones
// (los casos del canal #tech-ops, C08UCU5E90S) con lo que mide Sentinel. Cada caso lo abre el bot «Casos» con un
// mensaje (número, descripción, prioridad) y un formulario en la primera respuesta del hilo (tipo de caso, comercio,
// entidad, línea de negocio, canal); el resto del hilo es la conversación de soporte.
//
// Del formulario NUNCA se toman la cédula ni el celular; la descripción y la última respuesta pasan por `scrub` (sin
// números largos ni correos) y se les sacan las menciones a personas. Va al resumen del día (digest.go), así queda en la
// memoria y entra al paquete.
//
// ⚠ Necesita que el token de Slack de `connectors/.env` pueda leer el historial (`channels:history`, o
// `groups:history` si el canal es privado). Medido el 26/11/2026: ni el del bot ni el de usuario lo tenían
// (`missing_scope`); hasta que se agregue, el resumen lo dice y sigue sin los casos.

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	slack "creditop/my-tools/connectors/slack"
)

const techopsChannel = "C08UCU5E90S"

// TechopsCase: un caso, sin datos de la persona.
type TechopsCase struct {
	Number   int
	At       time.Time
	Priority string
	Type     string
	Merchant string
	Lender   string
	Line     string
	Channel  string
	Text     string // la descripción, filtrada
	Replies  int    // respuestas de soporte (sin el formulario)
	Last     string // la última respuesta, filtrada y corta: suele decir cómo se resolvió
}

var (
	reCaseNumber = regexp.MustCompile(`#\s*Caso:\s*(\d+)`)
	reCaseField  = regexp.MustCompile(`\*([^*\n]+?):\*[ \t]*([^\n]*)`)
	reMention    = regexp.MustCompile(`<@[A-Z0-9]+(?:\|[^>]*)?>`)
	reMailto     = regexp.MustCompile(`<mailto:[^|>]*\|[^>]*>|<mailto:[^>]*>`)
	reSlackLink  = regexp.MustCompile(`<(https?://[^|>]*)(?:\|[^>]*)?>`)
	reEmoji      = regexp.MustCompile(`:[a-z0-9_+\-]+:`)
)

// cleanSlack: el texto de Slack sin menciones, correos, enlaces largos ni emojis, filtrado.
func cleanSlack(s string, max int) string {
	s = reMention.ReplaceAllString(s, "@alguien")
	s = reMailto.ReplaceAllString(s, "<correo>")
	s = reSlackLink.ReplaceAllString(s, "<enlace>")
	s = reEmoji.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&gt;", "")
	s = strings.Join(strings.Fields(strings.ReplaceAll(s, ">", " ")), " ")
	s = scrub(s)
	if r := []rune(s); len(r) > max {
		s = string(r[:max]) + "…"
	}
	return s
}

// caseFields: los campos «*Nombre:* valor» de un texto, con el nombre en minúsculas y sin «(si aplica)».
func caseFields(text string) map[string]string {
	out := map[string]string{}
	for _, m := range reCaseField.FindAllStringSubmatch(text, -1) {
		key := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(m[1], "(Si aplica)", "")))
		key = strings.Join(strings.Fields(key), " ")
		out[key] = strings.TrimSpace(m[2])
	}
	return out
}

// techopsCases: los casos abiertos en [from, to), del más viejo al más nuevo.
func techopsCases(ctx context.Context, from, to time.Time) ([]TechopsCase, error) {
	cfg, err := slack.LoadConfig()
	if err != nil {
		return nil, err
	}
	c, err := cfg.User()
	if err != nil {
		if c, err = cfg.Bot(); err != nil {
			return nil, err
		}
	}
	msgs, err := c.History(ctx, techopsChannel, from, 3)
	if err != nil {
		return nil, err
	}
	var out []TechopsCase
	for _, m := range msgs {
		num := reCaseNumber.FindStringSubmatch(m.Text)
		if num == nil {
			continue
		}
		sec, _ := strconv.ParseFloat(m.TS, 64)
		at := time.Unix(int64(sec), 0).In(bogota)
		if !at.Before(to) {
			continue
		}
		n, _ := strconv.Atoi(num[1])
		f := caseFields(m.Text)
		tc := TechopsCase{Number: n, At: at, Priority: cleanSlack(f["prioridad"], 20), Text: cleanSlack(f["descripción de caso"], 240)}
		if m.ReplyCount > 0 {
			if replies, err := c.Replies(ctx, techopsChannel, m.TS, 50); err == nil && len(replies) > 0 {
				form := caseFields(replies[0].Text)
				// Sólo estos campos: la cédula y el celular del formulario no se leen.
				tc.Type, tc.Merchant, tc.Lender = cleanSlack(form["tipo de caso"], 60), cleanSlack(form["comercio"], 40), cleanSlack(form["entidad"], 40)
				tc.Line, tc.Channel = cleanSlack(form["línea de negocio"], 40), cleanSlack(form["canal"], 40)
				tc.Replies = len(replies) - 1
				if tc.Replies > 0 {
					tc.Last = cleanSlack(replies[len(replies)-1].Text, 200)
				}
			}
		}
		out = append(out, tc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out, nil
}

// techopsSection: los casos del día para el resumen.
func techopsSection(from, to time.Time) string {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cases, err := techopsCases(ctx, from, to)
	var b strings.Builder
	b.WriteString("## Casos de soporte en #tech-ops (lo que reporta operaciones)\n\n")
	if err != nil {
		reason := err.Error()
		if strings.Contains(reason, "missing_scope") {
			reason = "el token de Slack no tiene permiso de leer el historial del canal (falta channels:history o groups:history)"
		}
		fmt.Fprintf(&b, "Sin los casos: %s.\n\n", reason)
		return b.String()
	}
	if len(cases) == 0 {
		b.WriteString("Ninguno.\n\n")
		return b.String()
	}
	byType, byMerchant := map[string]int{}, map[string]int{}
	for _, c := range cases {
		if c.Type != "" {
			byType[c.Type]++
		}
		if c.Merchant != "" {
			byMerchant[c.Merchant]++
		}
	}
	fmt.Fprintf(&b, "%d casos. Por tipo: %s. Por comercio: %s.\n\n", len(cases), countText(byType), countText(byMerchant))
	for _, c := range cases {
		meta := []string{}
		for _, x := range []string{c.Priority, c.Type, c.Merchant, c.Lender, c.Line, c.Channel} {
			if x != "" && !strings.EqualFold(x, "otro") {
				meta = append(meta, x)
			}
		}
		fmt.Fprintf(&b, "- Caso %d · %s · %s: %s", c.Number, c.At.Format("15:04"), strings.Join(meta, " · "), c.Text)
		if c.Replies > 0 {
			fmt.Fprintf(&b, " — %d respuestas; la última: «%s»", c.Replies, c.Last)
		} else {
			b.WriteString(" — sin respuestas")
		}
		b.WriteString("\n")
	}
	b.WriteString("\n")
	return b.String()
}

func countText(m map[string]int) string {
	if len(m) == 0 {
		return "—"
	}
	type kv struct {
		k string
		v int
	}
	var list []kv
	for k, v := range m {
		list = append(list, kv{k, v})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].v > list[j].v })
	var parts []string
	for _, x := range list {
		parts = append(parts, fmt.Sprintf("%s %d", x.k, x.v))
	}
	return strings.Join(parts, ", ")
}

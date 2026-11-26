package main

import (
	"strings"
	"testing"
)

// El caso 259 de #tech-ops (26/11/2026) tal como lo manda el bot, y su formulario.
const techopsMsg = "<@U08U4V0PKTN> <@U091E2P5NTH> Nuevo caso reportado :point_down:\n*# Caso: 259*\n*Caso suscrito por:* <@U0B7M01TRC0>\n*Descripción de caso:* Equipo me ayudan a validar por que a este asesor le dice que no tiene un comercio asignado, valido en BO y esta en pullman <mailto:yayobig1994@gmail.com|yayobig1994@gmail.com>\n*Prioridad:* Media:large_yellow_circle:"
const techopsForm = "*Cédula (Si aplica):* 1020744247\n*Celular (Si aplica):* 3044208718\n*Tipo de caso:* Validación de identidad\n*Comercio (Si aplica):* Motai\n*Línea de negocio:* Creditop X\n*Canal:* Punto de venta (POS)\n*Entidad  (Si aplica):* Otro"

func TestTechopsParse(t *testing.T) {
	if m := reCaseNumber.FindStringSubmatch(techopsMsg); m == nil || m[1] != "259" {
		t.Fatalf("número del caso: %v", m)
	}
	f := caseFields(techopsMsg)
	desc := cleanSlack(f["descripción de caso"], 240)
	if strings.Contains(desc, "yayobig") || strings.Contains(desc, "gmail") || !strings.Contains(desc, "comercio asignado") {
		t.Errorf("descripción: %q", desc)
	}
	if p := cleanSlack(f["prioridad"], 20); p != "Media" {
		t.Errorf("prioridad: %q", p)
	}
	form := caseFields(techopsForm)
	if form["tipo de caso"] != "Validación de identidad" || form["comercio"] != "Motai" || form["entidad"] != "Otro" || form["canal"] != "Punto de venta (POS)" {
		t.Errorf("formulario: %v", form)
	}
	// La sección del caso arma su texto sólo con estos campos: la cédula y el celular quedan afuera aunque se lean.
	tc := TechopsCase{Number: 259, Type: form["tipo de caso"], Merchant: form["comercio"], Text: desc}
	line := strings.Join([]string{tc.Type, tc.Merchant, tc.Text}, " ")
	for _, leak := range []string{"1020744247", "3044208718", "<@U"} {
		if strings.Contains(line, leak) {
			t.Errorf("se coló %q", leak)
		}
	}
}

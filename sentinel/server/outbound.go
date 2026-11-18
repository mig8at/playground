package main

// LOS PROVEEDORES EXTERNOS: cada llamada que legacy-backend hace hacia afuera (Experian, Nequi, Mareigua, Netco, las
// entidades, los servicios internos) queda en producción como una línea «Llamada saliente» con su proveedor, su estado
// HTTP, su duración y su DESENLACE (`context["saliente.desenlace"]`): ok · rechazo · error_del_proveedor ·
// sin_conexion · limite_de_tasa. Medido el 2026-11-18: ~27.000 llamadas por día, de ~50 proveedores.
//
// Señal `out:<proveedor>`. En lo guardado, por bloque de 5 minutos:
//
//	Total   las llamadas
//	Denied  las que fallaron POR EL PROVEEDOR: error_del_proveedor, sin_conexion o limite_de_tasa
//
// «rechazo» (un 4xx) no es falla: es el proveedor diciendo que no (pre_approvals rechaza ~300 por día, todos los días).
// Lo malo es que la TASA de falla suba contra la de siempre a esa hora, como las pantallas del wizard (steps.go): una
// prueba binomial, con un mínimo de llamadas y de fallas para hablar. Así se habría visto lo de Netco del 17/11 en dev
// (404 en el login durante 7 horas), si hubiera pasado en producción.

import (
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	outCallsLogQL = `sum by (prov) (count_over_time({service_name="legacy-backend"} |= "Llamada saliente" | json prov="context[\"saliente.proveedor\"]" | prov!="" [5m]))`
	outFailsLogQL = `sum by (prov) (count_over_time({service_name="legacy-backend"} |= "Llamada saliente" | json prov="context[\"saliente.proveedor\"]", des="context[\"saliente.desenlace\"]" | prov!="" | des=~"error_del_proveedor|sin_conexion|limite_de_tasa" [5m]))`
)

// Lo mínimo para hablar de la falla de un proveedor: con menos llamadas o fallas, cualquier tasa es azar.
const (
	outMinCalls  = 20
	outMinFails  = 10
	outFailFloor = 0.05
)

func outSignalOf(m map[string]string) Signal {
	if p := strings.TrimSpace(m["prov"]); p != "" {
		return "out:" + p
	}
	return ""
}

// providerName: el nombre para mostrar. Los que vienen como host (`pdf-mapper-service.inertia-production:8080`) se
// quedan con la primera parte.
func providerName(key string) string {
	if strings.Contains(key, ".") {
		key, _, _ = strings.Cut(key, ".")
	}
	key, _, _ = strings.Cut(key, ":")
	return strings.ReplaceAll(key, "_", " ")
}

// OutEval: la falla de un proveedor en la ventana, contra la de siempre a esa hora.
type OutEval struct {
	Calls    int     `json:"calls"`
	Fails    int     `json:"fails"`
	FailRate float64 `json:"failRate"`
	BaseFail float64 `json:"baseFail"` // la mediana de la tasa en los días comparables
}

func (e evaluator) evalOut(sig Signal, se *series, t time.Time) Eval {
	var ev Eval
	minutes := e.rules.WindowMinutes
	// Un proveedor de pocas llamadas mira más tiempo, hasta juntar las que hacen falta para hablar.
	for _, m := range append([]int{minutes}, e.rules.FollowedWindows...) {
		minutes = m
		if window(se.total, t, m) >= outMinCalls {
			break
		}
	}
	ev.Minutes = minutes
	o := &OutEval{Calls: window(se.total, t, minutes), Fails: window(se.denied, t, minutes)}
	ev.Out, ev.Now = o, o.Calls
	var rates []float64
	for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
		c, f := window(se.total, past, minutes), window(se.denied, past, minutes)
		ev.Samples = append(ev.Samples, float64(c))
		ev.Dates = append(ev.Dates, past.Format("2006-01-02"))
		if c >= 10 {
			rates = append(rates, float64(f)/float64(c))
		}
	}
	ev.Median = median(ev.Samples)
	if o.Calls > 0 {
		o.FailRate = float64(o.Fails) / float64(o.Calls)
	}
	o.BaseFail = median(rates)
	name := providerName(sig[len("out:"):])
	switch {
	case o.Calls < outMinCalls:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("%d llamadas a %s en %s: poco para comparar", o.Calls, name, span(minutes))
		return ev
	case len(rates) < e.rules.MinSamples:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("poca historia para comparar (%d días con llamadas)", len(rates))
		return ev
	}
	exp := float64(o.Calls) * o.BaseFail
	ev.Z = (float64(o.Fails) - exp) / math.Sqrt(math.Max(exp*(1-o.BaseFail), 1))
	factor := 1.0
	if e.afterDeploy(t) {
		factor = e.rules.AfterDeployFactor
	}
	// El piso: con lo normal en 0 %, el doble de 1 % daba alerta con 2 % (otp_service, 7 alertas por semana con 2-6 %
	// de falla, medido el 2026-11-18). Con 5 %, la alerta pide ≥ 10 % de llamadas fallando.
	floor := math.Max(o.BaseFail, outFailFloor)
	switch {
	case o.Fails >= outMinFails && ev.Z >= 4.5*factor && o.FailRate >= 2*floor:
		ev.Level = levelAlert
	case o.Fails >= outMinFails && ev.Z >= 3*factor && o.FailRate >= 1.5*floor:
		ev.Level = levelWarn
	default:
		ev.Level = levelOK
	}
	ev.Why = fmt.Sprintf("fallaron %d de %d llamadas a %s en %s (%s); lo normal, %s", o.Fails, o.Calls, name, span(minutes), pctText(o.FailRate), pctText(o.BaseFail))
	if dn, ok := e.deployBefore(t); ok && factor != 1 {
		ev.Why += afterDeployNote + dn
	}
	return ev
}

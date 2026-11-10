package main

/* El dictado a las centrales: el mock de centrales de la empresa (`Creditop-SAS/risk-services-mockery-lambda`, un
 * Mockoon en un lambda) contesta por cédula lo que se le dicte. Sin dictarle, contesta su persona por defecto
 * (JUAN CARLOS PEREZ GOMEZ) y la identidad del cliente no coincide.
 *
 * Se dictan dos centrales y se confirma leyendo:
 *   · Ágil Data: el nombre y el empleo (de ahí salen la ocupación, el ingreso y la continuidad);
 *   · Experian HDCplus: el reporte entero (~250 KB). El lambda no entiende un perfil suelto, así que se le pide su
 *     reporte para esa cédula, se le cambia lo que miran las categorías y se le dicta de vuelta.
 *
 * ⚠ Lo dictado vive en la MEMORIA de cada contenedor del lambda: un POST llega a uno solo. Por eso se dicta muchas
 * veces a la vez y se confirma con muchas lecturas a la vez (spread). Aun así, un contenedor nuevo nace vacío:
 * conviene dictar justo antes de lanzar la compra. */

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// El token del admin de Mockoon es fijo y público (Mockoon no arranca el admin sin uno): no es un secreto.
const mockAdminToken = "Bearer mock-admin"

var lambdaHTTP = &http.Client{Timeout: 25 * time.Second}

// dictateLambda le dicta el perfil a Ágil Data y a Experian, y dice qué quedó.
func dictateLambda(base string, p Profile) (bool, []string) {
	var lines []string
	agilURL := base + "/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/CC/" + p.Document
	agil := spread(
		func() { dictate(base, p.Document, "agildata", agildataAnswer(p)) },
		func() *bool {
			body, ok := httpGet(agilURL)
			if !ok {
				return nil
			}
			hit := strings.Contains(body, p.Name) && strings.Contains(body, fmt.Sprint(p.Income))
			return &hit
		}, 12, 12)
	if agil.ok {
		lines = append(lines, fmt.Sprintf("Ágil Data ✓ %s · %s · %d · %d meses · %d/%d lecturas", p.Name, p.Occupation, p.Income, p.Months, agil.hits, agil.reads))
	} else {
		lines = append(lines, fmt.Sprintf("Ágil Data ✗ sólo %d/%d lecturas contestan lo dictado: el resto, su default", agil.hits, agil.reads))
	}

	var report map[string]any
	for i := 0; i < 4 && report == nil; i++ {
		report = experianReport(base, p)
	}
	if report == nil {
		lines = append(lines, "Experian ✗ no se pudo leer su reporte para dictarlo")
		return false, lines
	}
	exp := spread(
		func() { dictate(base, p.Document, "experian", report) },
		func() *bool {
			back := hdcplus(base, p.Document)
			if back == nil {
				return nil
			}
			r, _ := back["ReportHDCplus"].(map[string]any)
			hit := fmt.Sprint(dig(r, "models", 0, "scoreValue")) == fmt.Sprint(p.Score) &&
				fmt.Sprint(dig(r, "agregatedInfo", "overview", "principals", "consultedLast6Months")) == "1"
			return &hit
		}, 4, 4)
	if exp.ok {
		lines = append(lines, fmt.Sprintf("Experian ✓ score %d · 1 consulta · 1 tarjeta · mora 0 · negativos 0 · %d/%d lecturas", p.Score, exp.hits, exp.reads))
	} else {
		lines = append(lines, fmt.Sprintf("Experian ✗ sólo %d/%d lecturas contestan lo dictado: el resto, su reporte de siempre", exp.hits, exp.reads))
	}
	return agil.ok && exp.ok, lines
}

type spreadResult struct {
	ok          bool
	hits, reads int
}

// spread dicta `writes` veces a la vez y lee `reads` veces a la vez, hasta 6 rondas. Queda dictado cuando ninguna
// lectura contesta otra cosa y al menos la mitad contestó (una lectura que falla por el límite de concurrencia del
// lambda no cuenta como «contestó la default»).
func spread(write func(), read func() *bool, writes, reads int) spreadResult {
	var res spreadResult
	for round := 0; round < 6; round++ {
		var wg sync.WaitGroup
		for i := 0; i < writes; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); write() }()
		}
		wg.Wait()
		got := make([]*bool, reads)
		for i := 0; i < reads; i++ {
			wg.Add(1)
			go func(i int) { defer wg.Done(); got[i] = read() }(i)
		}
		wg.Wait()
		res = spreadResult{}
		for _, g := range got {
			if g != nil {
				res.reads++
				if *g {
					res.hits++
				}
			}
		}
		if res.hits == res.reads && res.reads*2 >= reads {
			res.ok = true
			return res
		}
	}
	return res
}

// dictate le pide al mock que conteste `value` a esa central para esa cédula.
func dictate(base, doc, central string, value any) bool {
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	body, _ := json.Marshal(map[string]string{"key": central + "_" + doc, "value": string(raw)})
	req, _ := http.NewRequest(http.MethodPost, base+"/mockoon-admin/global-vars", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", mockAdminToken)
	res, err := lambdaHTTP.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode < 300
}

func httpGet(url string) (string, bool) {
	res, err := lambdaHTTP.Get(url)
	if err != nil {
		return "", false
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return string(raw), res.StatusCode < 300
}

// agildataAnswer es la respuesta de Ágil Data: la persona y sus pagos de los últimos meses, contados desde hoy
// (una serie vieja da `employed: false`). El período es YYYYMM y se calcula por meses, no restando enteros.
// La ocupación no se dicta: el backend la deduce del empleador. Empleador = la persona → Independiente.
func agildataAnswer(p Profile) map[string]any {
	now := time.Now()
	payments := []map[string]any{}
	for k := 0; k < p.Months; k++ {
		months := now.Year()*12 + int(now.Month()) - 1 - k
		y, m := months/12, months%12+1
		payments = append(payments, map[string]any{
			"id": k + 1, "ibc": p.Income, "periodo": y*100 + m,
			"fechaPago": fmt.Sprintf("%d-%02d-15 00:00:00", y, m), "diasCotizados": 30,
			"valorCotizacionObligatoria": int(float64(p.Income)*0.115 + 0.5),
		})
	}
	employer := "STANGERSON SAS"
	if strings.EqualFold(p.Occupation, "independiente") {
		employer = p.Name
	}
	return map[string]any{
		"usuario": nil, "codRespuesta": "01", "observaciones": "Consulta Exitosa.", "codConsulta": 14744568681490196,
		"respuesta": map[string]any{
			"type": "aorg.asofondos.agildata.domain.AfiliadoDetalladoa", "fechaVinculacion": nil,
			"datosBasicos": map[string]any{"edad": 25, "type": "org.asofondos.agildata.domain.AfiliadoDatosBasicos",
				"genero": "M", "nombre": p.Name, "tipoId": "CC", "numeroId": p.Document, "viabilidad": nil},
			"detalladoEmpleos": []map[string]any{{
				"id": 1, "pagos": payments, "nombreEmpleador": employer, "telefonoEmpleador": nil,
				"direccionEmpleador": nil, "identifiacionEmpleador": "900101010", "tipoIdentifiacionEmpleador": "NI",
			}},
		},
	}
}

// hdcplus pide el reporte de Experian de una cédula, o nil si no contestó.
func hdcplus(base, doc string) map[string]any {
	body, _ := json.Marshal(map[string]any{"identifyingUser": map[string]any{"person": map[string]any{"personId": map[string]any{"personIdNumber": doc}}}})
	res, err := lambdaHTTP.Post(base+"/experian/cs/credit-history/v1/hdcplus", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil
	}
	var out map[string]any
	dec := json.NewDecoder(res.Body)
	dec.UseNumber()
	if dec.Decode(&out) != nil {
		return nil
	}
	return out
}

// experianReport toma el reporte del mock y le pone lo que miran las categorías: el score, una consulta en seis
// meses, sin mora ni negativos, una tarjeta activa y el ingreso estimado (Quanto, productCode 62, en miles).
func experianReport(base string, p Profile) map[string]any {
	got := hdcplus(base, p.Document)
	r, _ := got["ReportHDCplus"].(map[string]any)
	model, _ := dig(r, "models", 0).(map[string]any)
	principals, _ := dig(r, "agregatedInfo", "overview", "principals").(map[string]any)
	if model == nil || principals == nil {
		return nil
	}
	model["scoreValue"] = p.Score
	principals["consultedLast6Months"] = 1
	principals["currentNegativeCredits"] = 0
	principals["negativeHistoricalLast12Months"] = 0
	principals["maturationSince"] = "2015-03-26"
	r["creditCard"] = []map[string]any{{
		"idNumber":          "CC-SYNTH-1",
		"status":            map[string]any{"account": map[string]any{"businessAccountStatus": "01"}, "payment": map[string]any{"businessBureauEvent": "01"}},
		"creditCardAccount": map[string]any{"businessBehaviourVectorProduct": "NNNNNNNNNNNN"},
		"values":            []map[string]any{{"availableBalance": 1000, "debtBalance": 0, "valueMonthlyPayment": 0}},
	}}
	if list, ok := dig(r, "productValueList", 0).([]any); ok {
		avg := (p.Income + 500) / 1000
		values := []int{avg, avg * 7 / 10, avg * 13 / 10}
		k := 0
		for _, item := range list {
			prod, _ := item.(map[string]any)
			if prod != nil && fmt.Sprint(prod["productCode"]) == "62" && k < len(values) {
				prod["value"] = values[k]
				k++
			}
		}
	}
	return got
}

// dig baja por mapas (claves string) y listas (índices int); nil si el camino no existe.
func dig(v any, path ...any) any {
	for _, step := range path {
		switch s := step.(type) {
		case string:
			m, ok := v.(map[string]any)
			if !ok {
				return nil
			}
			v = m[s]
		case int:
			l, ok := v.([]any)
			if !ok || s >= len(l) {
				return nil
			}
			v = l[s]
		}
	}
	return v
}

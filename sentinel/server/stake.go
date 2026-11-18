package main

// LA PLATA EN JUEGO: cuánto pesa en lo desembolsado lo que está fallando. Una alerta de una entidad que coloca 9
// créditos al día no es lo mismo que una de la que coloca la cuarta parte de todo; sin esto, «Para mirar» las ponía en
// el mismo renglón. Ordena lo que pide atención (a igual estado, primero lo que más plata mueve) y el porqué lo nombra.
//
// Es lo desembolsado, no el revenue. El revenue (lo que le queda a CreditOp) lo calcula forecast, el panel comercial del
// repo compartido: SaaS + la comisión de cada pareja comercio–entidad sobre lo que pase de su base mínima + la tasa
// general del comercio (`revenue.js`, `incomeOf`). Pero esas tasas viven en la base PROPIA de forecast (`lender_rates`,
// `merchant_config`), cargadas a mano, y no en producción: Sentinel no tiene cómo leerlas, y copiar las de octubre
// (`seeds/tarifas-*.sql`) sería un índice que envejece sin avisar. Para ordenar alcanza con lo desembolsado.
//
// De producción, cada 30 minutos: lo desembolsado de los últimos 28 días por entidad y por comercio (por `disbursed_at`,
// con `COALESCE(final_amount, amount)` como forecast), sólo de comercios de Colombia (pesos). Medido el 18/11/2026:
// 4.948 desembolsos y $13.775 millones en 28 días; Perú, 21 desembolsos que suman 0.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const stakeDays = 28

// Stake: lo que pesa una entidad o un comercio en lo desembolsado.
type Stake struct {
	Share  float64 `json:"share"`  // de lo desembolsado en pesos de los últimos 28 días
	PerDay float64 `json:"perDay"` // pesos desembolsados por día, en promedio
	Count  int     `json:"count"`  // desembolsos en los 28 días
}

// Stakes: lo de todas, para la pasada.
type Stakes struct {
	Total    float64
	Count    int
	Lenders  map[int]Stake
	Merchant map[int]Stake
}

func (r reader) stakes() (Stakes, error) {
	out := Stakes{Lenders: map[int]Stake{}, Merchant: map[int]Stake{}}
	rows, err := r.rows(fmt.Sprintf(`SELECT u.lender_id AS l, u.allied_id AS a, COUNT(*) AS n, SUM(COALESCE(u.final_amount, u.amount)) AS amount
FROM user_requests u JOIN allieds al ON al.id = u.allied_id
WHERE u.disbursed_at >= CURDATE() - INTERVAL %d DAY AND al.country_id = 47 GROUP BY 1, 2`, stakeDays))
	if err != nil {
		return out, err
	}
	lenders, merchants := map[int][2]float64{}, map[int][2]float64{}
	for _, row := range rows {
		amount, n := float64(num(row["amount"])), float64(num(row["n"]))
		out.Total += amount
		out.Count += int(n)
		l, a := lenders[num(row["l"])], merchants[num(row["a"])]
		lenders[num(row["l"])] = [2]float64{l[0] + amount, l[1] + n}
		merchants[num(row["a"])] = [2]float64{a[0] + amount, a[1] + n}
	}
	if out.Total <= 0 {
		return out, nil
	}
	mk := func(x [2]float64) Stake {
		return Stake{Share: x[0] / out.Total, PerDay: x[0] / stakeDays, Count: int(x[1])}
	}
	for id, x := range lenders {
		out.Lenders[id] = mk(x)
	}
	for id, x := range merchants {
		out.Merchant[id] = mk(x)
	}
	return out, nil
}

// stakeOf: lo que pesa la señal. Lo de todo el flujo (toda la originación, el embudo, las pantallas del wizard entero,
// el rechazo de todas) pesa todo; un servicio, nada que se pueda decir (no se sabe a quién afecta).
func (s Stakes) stakeOf(kind string, id int, sig Signal) *Stake {
	if s.Total <= 0 {
		return nil
	}
	whole := &Stake{Share: 1, PerDay: s.Total / stakeDays, Count: s.Count}
	switch kind {
	case "all", "funnel":
		return whole
	case "lender", "lerr":
		if x, ok := s.Lenders[id]; ok {
			return &x
		}
	case "reject":
		if strings.HasSuffix(sig, ":all") {
			return whole
		}
		if x, ok := s.Lenders[id]; ok {
			return &x
		}
	case "merchant":
		if x, ok := s.Merchant[id]; ok {
			return &x
		}
	case "step":
		if _, m := stepParts(sig); m == "" {
			return whole
		}
		if x, ok := s.Merchant[id]; ok {
			return &x
		}
	}
	return nil
}

// moneyText: «$1.234 millones», «$85 millones», «$950 mil».
func moneyText(x float64) string {
	switch {
	case x >= 1e9:
		return "$" + thousands(int(x/1e6+0.5)) + " millones"
	case x >= 1e6:
		return fmt.Sprintf("$%s millones", strings.Replace(fmt.Sprintf("%.1f", x/1e6), ".", ",", 1))
	default:
		return "$" + thousands(int(x/1e3+0.5)) + " mil"
	}
}

func thousands(n int) string {
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "." + s[i:]
	}
	return s
}

// stakeText: «mueve el 18 % de lo desembolsado (~$90 millones por día)».
func stakeText(st *Stake) string {
	if st == nil || st.Share >= 1 {
		return ""
	}
	pct := st.Share * 100
	share := fmt.Sprintf("%.0f %%", pct)
	if pct < 1 {
		share = "menos del 1 %"
	}
	return fmt.Sprintf("mueve %s de lo desembolsado (~%s por día)", share, moneyText(st.PerDay))
}

func stakeShare(st *Stake) float64 {
	if st == nil {
		return 0
	}
	return st.Share
}

// Se guarda en `sentinel/.data/stakes.json`: la consola (`bin/sentinel`) no hace pasadas y lee lo que dejó la API.
func (s *sentinel) stakesPath() string { return filepath.Join(s.store.dir, "stakes.json") }

func (s *sentinel) saveStakes() {
	raw, err := json.Marshal(s.stakeList)
	if err == nil && os.WriteFile(s.stakesPath()+".tmp", raw, 0o644) == nil {
		_ = os.Rename(s.stakesPath()+".tmp", s.stakesPath())
	}
}

func (s *sentinel) loadStakes() {
	if raw, err := os.ReadFile(s.stakesPath()); err == nil {
		_ = json.Unmarshal(raw, &s.stakeList)
	}
}

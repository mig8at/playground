package main

import (
	"context"
	"fmt"
	"io"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/radar/scan"
)

/* recheck vuelve a correr contra canon las búsquedas que dieron vacío: si hoy encuentran algo, el hueco
 * se cerró. Es `/api/search` —gratis, sin modelo— y sólo se hace a pedido (`-recheck`), porque radar
 * funciona sin red. Una búsqueda que falla deja el hueco como estaba y lo dice. */
func recheck(g *scan.Gaps, client *canon.Client) {
	for i := range g.Gaps {
		gap := &g.Gaps[i]
		if gap.Signal != scan.SignalEmpty || gap.Query == "" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		res, err := client.Search(ctx, gap.Query)
		cancel()
		switch {
		case err != nil:
			gap.Recheck = "no se pudo volver a buscar"
		case len(res.Prose)+len(res.Map) > 0:
			gap.Recheck = "cubierto"
		default:
			gap.Recheck = "sigue vacío"
		}
	}
}

var signalText = map[string]string{
	scan.SignalEmpty:        "sin resultados",
	scan.SignalSearchedCode: "buscó y se fue al código",
	scan.SignalReadCode:     "leyó y se fue al código",
}

func printGaps(w io.Writer, g scan.Gaps) {
	fmt.Fprintf(w, "── consultas a canon para trabajar: %d · piezas escritas o ensayadas: %d · desarrollo de canon (no cuenta): %d\n\n",
		g.Lookups, g.Writes, g.Dev)
	if len(g.Gaps) == 0 {
		fmt.Fprintln(w, "   ningún hueco en el período (con pocas consultas, eso no dice mucho)")
		return
	}
	for _, s := range []string{scan.SignalEmpty, scan.SignalSearchedCode, scan.SignalReadCode} {
		var rows []scan.Gap
		for _, gap := range g.Gaps {
			if gap.Signal == s {
				rows = append(rows, gap)
			}
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Fprintf(w, "── %s (%d)\n", signalText[s], len(rows))
		for _, gap := range rows {
			q := gap.Query
			if q == "" {
				q = "(sin consulta legible)"
			}
			line := fmt.Sprintf("   %2d× %2d ses · %s · «%s»", gap.Times, gap.Sessions, gap.Last.Local().Format("2006-01-02"), clip(q, 70))
			if len(gap.Repos) > 0 {
				line += " → " + fmt.Sprint(gap.Repos)
			}
			if gap.Recheck != "" {
				line += " · hoy: " + gap.Recheck
			}
			fmt.Fprintln(w, line)
		}
		fmt.Fprintln(w)
	}
	fmt.Fprintln(w, "   un hueco que se repite va a canon: se verifica en main y se dicta (skill canon). -recheck mira si las vacías ya encuentran algo.")
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

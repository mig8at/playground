package main

import (
	"fmt"
	"io"

	"creditop/my-tools/radar/scan"
)

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
	fmt.Fprintln(w, "   historia: de cuando canon se consultaba desde my-tools. Un hueco que se repite es para knowledge/.")
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

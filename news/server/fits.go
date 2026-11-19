package main

// ¿CORRE ACÁ? El repo se usa en dos máquinas (lib/machine): la Mac, donde se probaron los favoritos, y el PC con Linux.
// `mac` en favorites.json es lo que se sabe de la Mac (lo dice la ficha del modelo o se probó); para el PC casi nada
// está escrito todavía, así que sale de una cuenta: cuánto ocupa el modelo contra la memoria de la GPU y la RAM.
//
// Es una ESTIMACIÓN y se muestra como tal (basis: «estimated»): no reemplaza a probarlo. Cuando algo se prueba en el
// PC se escribe `pc` en el archivo (yes · no · unknown) y eso manda sobre la cuenta, igual que `mac` en la Mac.

import (
	"fmt"
	"regexp"
	"strings"

	"creditop/my-tools/lib/machine"
)

// Fit: si un modelo corre en la máquina donde está abierto News.
type Fit struct {
	Status string `json:"status"` // yes · slow (corre, pero en CPU) · no · unknown
	Basis  string `json:"basis"`  // declared (lo dice el archivo) · estimated (la cuenta de abajo)
	Why    string `json:"why"`
}

// formatos que sólo corren en Apple Silicon: el nombre del repo lo dice (mlx-community/…, …-mlx, …-coreml)
var appleOnly = regexp.MustCompile(`(?i)(^mlx-community/|[-_/]mlx([-_/]|$)|core-?ml)`)

const gib = 1 << 30

// fitFor: lo declarado para esa máquina si lo hay; si no, la cuenta.
func fitFor(m machine.Info, f Favorite) Fit {
	if declared := map[string]string{"mac": f.Mac, "pc": f.PC}[m.ID]; declared != "" {
		why := "según su ficha o su tamaño"
		if f.TriedOn != "" && triedIn(f) == m.ID {
			why = "se probó en " + m.Here
		}
		return Fit{Status: declared, Basis: "declared", Why: why}
	}
	return estimate(m, f)
}

// triedIn: en qué máquina se probó. Todo lo anterior al 2026-11-19 se probó en la Mac, y no lo decía.
func triedIn(f Favorite) string {
	if f.TriedIn != "" {
		return f.TriedIn
	}
	return "mac"
}

// estimate: la cuenta. Un parámetro ocupa 2 bytes en media precisión (como se publican casi todos) y ~0,6 cuantizado a
// 4 bits; se deja un 20 % de margen para el contexto y lo que el motor pide de más. Sin el número de parámetros no hay
// cuenta: «unknown», no un sí optimista.
func estimate(m machine.Info, f Favorite) Fit {
	est := func(status, why string) Fit { return Fit{Status: status, Basis: "estimated", Why: why} }
	if m.OS != "darwin" && appleOnly.MatchString(f.ID) {
		return est("no", "el formato es de Apple Silicon (MLX o Core ML): acá hay que bajar la versión original")
	}
	if f.Params == nil || *f.Params <= 0 {
		if f.Group == "gpu" && m.Accel == "cuda" {
			return est("unknown", fmt.Sprintf("pide GPU NVIDIA y %s la tiene (%s), pero la ficha no dice cuánto ocupa", m.Here, gb(m.VRAM)))
		}
		return est("unknown", "la ficha no dice cuánto ocupa")
	}
	half := int64(float64(*f.Params) * 2 * 1.2)
	quant := int64(float64(*f.Params) * 0.6 * 1.2)
	switch {
	case m.VRAM > 0 && half <= m.VRAM:
		return est("yes", fmt.Sprintf("entra en la GPU: ~%s de %s", gb(half), gb(m.VRAM)))
	case m.VRAM > 0 && quant <= m.VRAM:
		return est("yes", fmt.Sprintf("entra en la GPU cuantizado a 4 bits: ~%s de %s (entero pide ~%s)", gb(quant), gb(m.VRAM), gb(half)))
	case quant <= m.RAM*7/10:
		return est("slow", fmt.Sprintf("no entra en la GPU (%s): corre en la RAM, lento (~%s cuantizado de %s)", gb(m.VRAM), gb(quant), gb(m.RAM)))
	default:
		return est("no", fmt.Sprintf("no entra con margen: pide ~%s cuantizado, y hay %s de GPU y %s de RAM (se usa hasta el 70 %%)", gb(quant), gb(m.VRAM), gb(m.RAM)))
	}
}

func gb(b int64) string {
	g := float64(b) / gib
	if g >= 10 || g == float64(int64(g)) {
		return fmt.Sprintf("%.0f GB", g)
	}
	return strings.Replace(fmt.Sprintf("%.1f GB", g), ".", ",", 1) // coma decimal, como el resto de la interfaz
}

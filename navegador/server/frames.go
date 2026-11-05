package main

/* Los iframes: un formulario de pago, una encuesta o un widget de terceros suele vivir en un documento aparte, y
 * desde la página principal no se ve. Por cada iframe visible se corre el mismo analyze.js ADENTRO, y sus
 * elementos se suman a la lista con el localizador prefijado por page.frameLocator(…) —que es como lo escribe
 * una prueba— y su cuadro corrido a donde está el iframe en la página.
 */

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/playwright-community/playwright-go"
)

// frameSelector arma un selector estable para el iframe: por título, nombre, id o src, en ese orden.
func frameSelector(fe playwright.ElementHandle, index int) string {
	for _, attr := range []string{"title", "name", "id"} {
		if v, _ := fe.GetAttribute(attr); v != "" {
			if attr == "id" {
				return "#" + v
			}
			return fmt.Sprintf(`iframe[%s="%s"]`, attr, strings.ReplaceAll(v, `"`, `\"`))
		}
	}
	if v, _ := fe.GetAttribute("src"); v != "" && !strings.HasPrefix(v, "data:") {
		return fmt.Sprintf(`iframe[src="%s"]`, strings.ReplaceAll(v, `"`, `\"`))
	}
	return fmt.Sprintf("iframe >> nth=%d", index)
}

// frameControls analiza los iframes de primer nivel y devuelve sus elementos, numerados desde `next`.
func frameControls(p playwright.Page, next int) []Control {
	var out []Control
	scroll, _ := p.Evaluate("() => [scrollX, scrollY]")
	sx, sy := 0.0, 0.0
	if xy, ok := scroll.([]any); ok && len(xy) == 2 {
		sx, _ = toFloat(xy[0])
		sy, _ = toFloat(xy[1])
	}
	main := p.MainFrame()
	for i, f := range main.ChildFrames() {
		fe, err := f.FrameElement()
		if err != nil {
			continue
		}
		box, err := fe.BoundingBox()
		if err != nil || box == nil || box.Width < 2 || box.Height < 2 {
			continue // un iframe invisible (de seguimiento, por ejemplo) no tiene nada para tocar
		}
		sel := frameSelector(fe, i)
		raw, err := f.Evaluate(analyzeJS)
		if err != nil {
			continue
		}
		str, _ := raw.(string)
		var a struct {
			Controls []Control `json:"controls"`
		}
		if json.Unmarshal([]byte(str), &a) != nil {
			continue
		}
		prefix := fmt.Sprintf("page.frameLocator('%s').", jsQuote(sel))
		for _, c := range a.Controls {
			c.FrameID = c.ID
			c.ID = next
			next++
			c.Frame = sel
			c.Form = -1
			c.Box.X += int(box.X + sx)
			c.Box.Y += int(box.Y + sy)
			for j := range c.Locators {
				c.Locators[j].Code = prefix + strings.TrimPrefix(c.Locators[j].Code, "page.")
			}
			out = append(out, c)
		}
	}
	return out
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	}
	return 0, false
}

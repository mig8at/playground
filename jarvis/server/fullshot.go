package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"time"

	"github.com/playwright-community/playwright-go"
)

// LA CAPTURA DE PÁGINA COMPLETA. `shot` sacaba lo que se ve, y en muchas apps lo que se desplaza no es la página: es un
// panel adentro (Gmail, un admin con barra lateral fija). El 2026-11-13 no se pudo capturar entero un correo de Gmail:
// el scroll de la ventana no movía nada y `fullPage` de Playwright tampoco, porque el documento mide lo mismo que la
// ventana. Acá se elige el elemento que de verdad se desplaza —el que más se ve entre los que tienen contenido
// escondido, o la página—, se lo baja de a una pantalla y cada foto, recortada a su rectángulo, es UNA PÁGINA
// (`captura-01.png`, `-02`…). Al terminar, el elemento vuelve a donde estaba.
//
// Páginas y no una tira (Miguel, 2026-11-13): la primera versión pegaba todo en una imagen de 1132×19 560 px, que no se
// puede leer, y a 1x se veía borrosa. Ahora cada página va a la resolución real de la pantalla (2x en retina) y entre
// una y la siguiente se repiten `fullShotOverlap` px: una línea que el corte parte sale entera en alguna de las dos.

// fullShotMaxHeight corta lo que se recorre: una página infinita (un feed) no tiene fondo.
const fullShotMaxHeight = 20000

// fullShotOverlap: cuánto (en px CSS) se repite arriba de cada página lo último de la anterior.
const fullShotOverlap = 48

// scroller es el elemento que se desplaza, medido en px CSS de la ventana.
type scroller struct {
	Found        bool    `json:"found"`
	Document     bool    `json:"document"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	W            float64 `json:"w"`
	H            float64 `json:"h"`
	ScrollHeight float64 `json:"scrollHeight"`
	Top          float64 `json:"top"`
	ViewportW    float64 `json:"vw"` // para pasar de px CSS a los de la foto (2x en retina)
}

// pickScrollerJS elige el elemento a recorrer y lo marca con data-jarvis-scroller. El rectángulo es la parte visible
// (recortada a la ventana). La página gana si su contenido sobra; si no, el panel con más área a la vista.
const pickScrollerJS = `() => {
  document.querySelectorAll('[data-jarvis-scroller]').forEach(e => e.removeAttribute('data-jarvis-scroller'));
  const vw = innerWidth, vh = innerHeight;
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > vh + 4) {
    doc.setAttribute('data-jarvis-scroller', '');
    return { found: true, document: true, x: 0, y: 0, w: vw, h: vh, scrollHeight: doc.scrollHeight, top: doc.scrollTop, vw };
  }
  let best = null, bestArea = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 80) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(vw, r.right) - x, h = Math.min(vh, r.top + el.clientHeight) - y;
    if (w <= 0 || h <= 0) continue;
    if (w * h > bestArea) { bestArea = w * h; best = { el, x, y, w, h }; }
  }
  if (!best || bestArea < vw * vh * 0.15) return { found: false };
  best.el.setAttribute('data-jarvis-scroller', '');
  return { found: true, document: false, x: best.x, y: best.y, w: best.w, h: best.h,
           scrollHeight: best.el.scrollHeight, top: best.el.scrollTop, vw };
}`

// hideFloatingJS esconde lo que flota (sticky o fixed): una barra pegada al fondo de un panel (la de «Responder» de
// Gmail) o un encabezado fijo saldría en cada foto y TAPARÍA el contenido de abajo, que la foto siguiente ya no
// toma. En un panel se esconden las suyas desde la primera foto; en la página, desde la segunda (el encabezado sale
// una vez, arriba). restoreFloatingJS las devuelve como estaban.
const hideFloatingJS = `(insideOnly) => {
  const root = insideOnly ? document.querySelector('[data-jarvis-scroller]') : document.body;
  if (!root) return 0;
  let n = 0;
  for (const el of root.querySelectorAll('*')) {
    if (el.hasAttribute('data-jarvis-hidden')) continue;
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    el.setAttribute('data-jarvis-hidden', el.style.visibility || '');
    el.style.visibility = 'hidden';
    n++;
  }
  return n;
}`

const restoreFloatingJS = `() => {
  for (const el of document.querySelectorAll('[data-jarvis-hidden]')) {
    el.style.visibility = el.getAttribute('data-jarvis-hidden');
    el.removeAttribute('data-jarvis-hidden');
  }
}`

// scrollToJS lleva el elemento marcado a `top` y devuelve dónde quedó (el navegador lo recorta al final).
const scrollToJS = `(top) => {
  const el = document.querySelector('[data-jarvis-scroller]');
  if (!el) return -1;
  el.scrollTop = top;
  return el.scrollTop;
}`

// LiveShotFull devuelve en PNG las páginas de todo el contenido del elemento que se desplaza. Si nada se desplaza, una
// sola: lo que se ve.
func (r *Runner) LiveShotFull() ([][]byte, error) {
	l := r.liveSession()
	if l == nil {
		return nil, errors.New("no hay sesión en vivo")
	}
	raw, err := l.page.Evaluate(pickScrollerJS)
	if err != nil {
		return nil, fmt.Errorf("no se pudo medir la página: %w", err)
	}
	var sc scroller
	if b, err := json.Marshal(raw); err == nil {
		_ = json.Unmarshal(b, &sc)
	}
	shoot := func() ([]byte, error) {
		return l.page.Screenshot(playwright.PageScreenshotOptions{Scale: playwright.ScreenshotScaleDevice, Timeout: playwright.Float(10000)})
	}
	if !sc.Found {
		one, err := shoot()
		return [][]byte{one}, err
	}
	defer func() {
		_, _ = l.page.Evaluate(restoreFloatingJS)
		_, _ = l.page.Evaluate(scrollToJS, sc.Top)
		_, _ = l.page.Evaluate(`() => document.querySelectorAll('[data-jarvis-scroller]').forEach(e => e.removeAttribute('data-jarvis-scroller'))`)
	}()

	total := sc.ScrollHeight
	if total > fullShotMaxHeight {
		total = fullShotMaxHeight
	}
	if !sc.Document {
		_, _ = l.page.Evaluate(hideFloatingJS, true)
	}
	step := sc.H - fullShotOverlap
	if step < sc.H/2 {
		step = sc.H / 2
	}
	var shots []piece
	for want := 0.0; ; want += step {
		if sc.Document && len(shots) == 1 {
			_, _ = l.page.Evaluate(hideFloatingJS, false)
		}
		v, err := l.page.Evaluate(scrollToJS, want)
		if err != nil {
			return nil, err
		}
		top, _ := v.(float64)
		if n, ok := v.(int); ok {
			top = float64(n)
		}
		if top < 0 {
			return nil, errors.New("el elemento que se desplaza desapareció de la página")
		}
		time.Sleep(300 * time.Millisecond) // lo que carga al aparecer (imágenes, filas)
		shot, err := shoot()
		if err != nil {
			return nil, err
		}
		shots = append(shots, piece{png: shot, top: top})
		if top+sc.H >= total || top < want-1 { // llegó al fondo (o al tope de alto)
			break
		}
	}
	return pages(shots, sc)
}

// piece es una foto de la ventana con el elemento bajado hasta `top`.
type piece struct {
	png []byte
	top float64
}

// pages recorta de cada foto el rectángulo del elemento: cada una es una página. La última, que el navegador frena
// contra el fondo, repetiría casi entera la anterior: se recorta a lo nuevo (más el solape).
func pages(shots []piece, sc scroller) ([][]byte, error) {
	if len(shots) == 0 {
		return nil, errors.New("no se sacó ninguna foto")
	}
	var out [][]byte
	prevEnd := -1.0 // hasta dónde (px CSS del contenido) llegó la página anterior
	for _, p := range shots {
		img, err := png.Decode(bytes.NewReader(p.png))
		if err != nil {
			return nil, err
		}
		k := 1.0 // px de la foto por px CSS
		if sc.ViewportW > 0 {
			k = float64(img.Bounds().Dx()) / sc.ViewportW
		}
		from := 0.0 // desde dónde del rectángulo se toma (px CSS)
		if prevEnd >= 0 && p.top+fullShotOverlap < prevEnd {
			from = prevEnd - fullShotOverlap - p.top
		}
		src := image.Rect(int(sc.X*k), int((sc.Y+from)*k), int((sc.X+sc.W)*k), int((sc.Y+sc.H)*k)).Intersect(img.Bounds())
		if src.Dy() <= 0 {
			continue
		}
		page := image.NewRGBA(image.Rect(0, 0, src.Dx(), src.Dy()))
		draw.Draw(page, page.Bounds(), img, src.Min, draw.Src)
		var buf bytes.Buffer
		if err := png.Encode(&buf, page); err != nil {
			return nil, err
		}
		out = append(out, buf.Bytes())
		prevEnd = p.top + sc.H
	}
	return out, nil
}

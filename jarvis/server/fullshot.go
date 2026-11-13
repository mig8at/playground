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
// escondido, o la página—, se lo baja de a una pantalla, se recorta cada foto a su rectángulo y se pegan en una sola
// imagen. Al terminar, el elemento vuelve a donde estaba.

// fullShotMaxHeight corta lo que se pega: una página infinita (un feed) no tiene fondo.
const fullShotMaxHeight = 20000

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
}

// pickScrollerJS elige el elemento a recorrer y lo marca con data-jarvis-scroller. El rectángulo es la parte visible
// (recortada a la ventana). La página gana si su contenido sobra; si no, el panel con más área a la vista.
const pickScrollerJS = `() => {
  document.querySelectorAll('[data-jarvis-scroller]').forEach(e => e.removeAttribute('data-jarvis-scroller'));
  const vw = innerWidth, vh = innerHeight;
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > vh + 4) {
    doc.setAttribute('data-jarvis-scroller', '');
    return { found: true, document: true, x: 0, y: 0, w: vw, h: vh, scrollHeight: doc.scrollHeight, top: doc.scrollTop };
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
           scrollHeight: best.el.scrollHeight, top: best.el.scrollTop };
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

// LiveShotFull devuelve en PNG todo el contenido del elemento que se desplaza. Si nada se desplaza, es lo mismo que
// LiveShot.
func (r *Runner) LiveShotFull() ([]byte, error) {
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
		return l.page.Screenshot(playwright.PageScreenshotOptions{Scale: playwright.ScreenshotScaleCss, Timeout: playwright.Float(10000)})
	}
	if !sc.Found {
		return shoot()
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
	var pieces []piece
	for want := 0.0; ; want += sc.H {
		if sc.Document && len(pieces) == 1 {
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
		pieces = append(pieces, piece{png: shot, top: top})
		if top+sc.H >= total || top < want-1 { // llegó al fondo (o al tope de alto)
			break
		}
	}
	return stitch(pieces, sc, total)
}

// piece es una foto de la ventana con el elemento bajado hasta `top`.
type piece struct {
	png []byte
	top float64
}

// stitch recorta de cada foto el rectángulo del elemento y lo pega a la altura de su `top`. Lo que se pisa entre dos
// fotos es el mismo contenido: gana la última.
func stitch(pieces []piece, sc scroller, total float64) ([]byte, error) {
	if len(pieces) == 0 {
		return nil, errors.New("no se sacó ninguna foto")
	}
	w, h := int(sc.W), int(total)
	if last := pieces[len(pieces)-1]; int(last.top+sc.H) < h {
		h = int(last.top + sc.H)
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	for _, p := range pieces {
		img, err := png.Decode(bytes.NewReader(p.png))
		if err != nil {
			return nil, err
		}
		src := image.Rect(int(sc.X), int(sc.Y), int(sc.X)+w, int(sc.Y+sc.H))
		dst := image.Rect(0, int(p.top), w, int(p.top)+src.Dy())
		draw.Draw(out, dst, img, src.Min, draw.Src)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

package main

/* LA VENTANA APARTE para el trabajo de fondo: `bin/jarvis start --aside '<meta>'` abre la pestaña de la sesión en una
 * ventana propia de Jarvis, que nace sin foco, en vez de en la ventana de la persona. Así Claude trabaja (y varias
 * sesiones en paralelo) sin ensuciarle la barra de pestañas ni robarle la vista; la sesión se mira igual en la
 * interfaz web (la vista «Todas») o yendo a esa ventana.
 *
 * Es la misma ventana que ya usaba el pool de AI Studio de Wally (la extensión la reusa mientras exista:
 * createInAsideWindow). Su grupo de pestañas se arma DENTRO de esa ventana: la extensión no la muda a la de la
 * persona aunque ahí haya un grupo con el mismo nombre. */

import (
	"errors"
	"fmt"
	"time"

	"github.com/playwright-community/playwright-go"
)

func (r *Runner) SetAside(on bool) {
	r.mu.Lock()
	r.aside = on
	r.mu.Unlock()
}

func (r *Runner) Aside() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.aside
}

// selfClient es la conexión de Playwright del propio servidor (la de las sesiones de Jarvis), si está.
func (b *ChromeBridge) selfClient() *pwClient {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, c := range b.clients {
		if c.self {
			return c
		}
	}
	return nil
}

// asideChromePage abre una pestaña en la ventana aparte y devuelve su página de Playwright y su pestaña de Chrome.
// Playwright no sabe pedir «en otra ventana» (newPage no tiene esa opción): se le pide la pestaña al puente, que la
// engancha para el cliente del servidor, y Playwright la ve llegar como una página nueva.
func asideChromePage(bctx playwright.BrowserContext) (playwright.Page, int, error) {
	c := chromeBridge.selfClient()
	if c == nil {
		return nil, 0, errors.New("la conexión de Jarvis con Chrome no está lista")
	}
	res, err := chromeBridge.createTarget(c, "about:blank", true, false)
	if err != nil {
		return nil, 0, err
	}
	targetID, _ := res["targetId"].(string)
	tab := chromeBridge.tabForTarget(targetID)
	if tab == 0 {
		return nil, 0, fmt.Errorf("la pestaña aparte (%s) no quedó enganchada", targetID)
	}
	for i := 0; i < 100; i++ { // hasta 10 s
		for _, p := range bctx.Pages() {
			if chromeTabOf(bctx, p) == tab {
				return p, tab, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, 0, fmt.Errorf("Playwright no vio la pestaña aparte %d en 10 s", tab)
}

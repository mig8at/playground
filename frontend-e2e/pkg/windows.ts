import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

/**
 * windows — fuente ÚNICA del manejo de ventanas A/B del suite e2e (preview/headed).
 *
 * Convención unificada que usan TODAS las pruebas:
 *   • A = columna IZQUIERDA (col 0). Es la ÚNICA ventana cuando la prueba usa 1 sola.
 *   • B = columna DERECHA   (col 1). Solo en pruebas de 2 dispositivos (split-view).
 *   • La pantalla se divide SIEMPRE en 2 mitades → el tamaño/posición de A (y de B) es
 *     el MISMO en todos los specs: las mismas pantallas se ven con el mismo ancho y lugar.
 *
 *   1 ventana  → A           (mitad izquierda, derecha libre)
 *   2 ventanas → A ⟷ B       (A izquierda, B derecha)
 *
 * Uso:
 *   - spec con fixture `page` (1 ventana): `await tileWindow(page, COLS.A)` al arrancar
 *     (test.use({ ...PREVIEW_VP }) para que la ventana mande sobre el viewport del device).
 *   - spec con fixture `browser` (1+ ventanas): `const { context, page } = await openA(browser, {...})`
 *     y `openB(...)` para la segunda.
 *
 * Tiling vía CDP (Browser.setWindowBounds): solo Chromium headed. En headless / sin --preview
 * tileWindow corta temprano (PREVIEW=false) y no hace nada.
 */

// preview (headed): acomodar las ventanas en columnas para verlas lado a lado sin taparse. Lo setea bin/asesor.
export const PREVIEW = process.env.E2E_PREVIEW === '1';

// UA de iPhone: el wizard gatea la validación / loan-approved por `onlyMobileValidation` (con UA de escritorio
// responde 403 → loader en blanco). El flujo ecommerce es MÓVIL; A y B usan este UA para que esas pantallas
// gated rendericen. El loader SSR reenvía el UA del navegador, así que pasa el gate.
export const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

// viewport:null en preview → la ventana se puede redimensionar (tileWindow la pone en su columna). Hay que
// ANULAR las opciones del device 'Desktop Chrome' (config) que exigen viewport, si no newContext tira
// "deviceScaleFactor not supported with null viewport". En headless queda {} (conserva el viewport del device).
export const PREVIEW_VP = PREVIEW
    ? { viewport: null, deviceScaleFactor: undefined, isMobile: undefined, hasTouch: undefined }
    : {};

// Columnas fijas: A izquierda (asesor/PC), B derecha (cliente/celular).
export const COLS = { A: 0, B: 1 } as const;

// Ancho de la ventana del CELULAR (B). El cliente usa el móvil → ventana ANGOSTA (ancho tipo teléfono);
// el asesor (A) trabaja en PC y se queda con el RESTO de la pantalla. Antes se partía 50/50, pero el
// wizard del asesor tiene más UI y el del cliente es una vista mobile — esto es más fiel y le da aire a A.
// Subilo/bajalo si querés B más o menos ancha.
export const PHONE_W = 480;

// Acomoda la ventana de `page` en su columna, 100% de alto: A = ancha (izquierda) · B = angosta (derecha,
// ancho de teléfono). Best-effort vía CDP (Chromium headed). En headless / sin preview no hace nada.
export async function tileWindow(page: Page, col: number): Promise<void> {
    if (!PREVIEW) return;
    try {
        const s = await page.evaluate(() => ({
            w: window.screen.availWidth, h: window.screen.availHeight,
            x: (window.screen as unknown as { availLeft?: number }).availLeft ?? 0,
            y: (window.screen as unknown as { availTop?: number }).availTop ?? 0,
        }));
        // B = ancho de teléfono (topado a media pantalla por si es chica); A = lo que sobra. B se pega a la
        // derecha, A arranca en la izquierda. Con 1 sola ventana (A) queda ancha y deja libre el hueco del móvil.
        const phoneW = Math.min(PHONE_W, Math.floor(s.w / 2));
        const isB = col === COLS.B;
        const width = isB ? phoneW : s.w - phoneW;
        const left = isB ? s.x + (s.w - phoneW) : s.x;
        const cdp = await page.context().newCDPSession(page);
        const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
        // 1º restaurar a 'normal' (CDP no mueve/redimensiona una ventana maximizada). 2º fijar los bounds.
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left, top: s.y, width, height: s.h } });
    } catch (e) {
        console.log(`  ▸ ⚠ tileWindow (no se pudo acomodar la ventana): ${e instanceof Error ? e.message : String(e)}`);
    }
}

export interface OpenWindowOpts {
    baseURL?: string;
    userAgent?: string;
    storageState?: BrowserContextOptions['storageState'];
}

// Abre un contexto + page y lo acomoda en la columna `col`. Devuelve ambos (el context para storageState/cierre).
export async function openWindow(browser: Browser, col: number, opts: OpenWindowOpts = {}): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
        baseURL: opts.baseURL,
        userAgent: opts.userAgent,
        storageState: opts.storageState,
        ...PREVIEW_VP,
    });
    const page = await context.newPage();
    await tileWindow(page, col);
    return { context, page };
}

// A = ventana IZQUIERDA (la única si la prueba usa 1 sola). B = ventana DERECHA (pruebas de 2 dispositivos).
export const openA = (browser: Browser, opts: OpenWindowOpts = {}) => openWindow(browser, COLS.A, opts);
export const openB = (browser: Browser, opts: OpenWindowOpts = {}) => openWindow(browser, COLS.B, opts);

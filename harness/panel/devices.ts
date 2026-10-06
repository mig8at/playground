// devices.ts — los celulares del panel como navegadores DE VERDAD, cada uno aislado.
//
// Un solo Chromium sin ventana, levantado al primer uso, y un CONTEXTO por celular (`client`, más adelante
// `advisor` y `lender`). Cada contexto tiene sus propias cookies, `localStorage`, sesión y caché: dos
// celulares no se pisan la cookie de propiedad de la solicitud ni la sesión de Cognito, que es lo que no
// se puede lograr con iframes dentro del panel (comparten el almacenamiento del navegador).
//
// Cada contexto emula un teléfono (viewport, `isMobile`, táctil, user-agent móvil), así el wizard se
// sirve en su versión móvil y las redirecciones (302 del checkout, `/auto/…`, el `return_url`) pasan
// solas, como en el celular del comprador.
import { chromium, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { blockDevOverlays } from '../pkg/dev-overlays.ts';

export type DeviceId = 'client' | 'advisor' | 'lender';

interface Device { context: BrowserContext; page: Page; openedAt: number }

// Un Android de gama media: la mayoría de los compradores entra desde uno.
const PHONE = devices['Pixel 7'];

let browser: Promise<Browser> | null = null;
const open = new Map<DeviceId, Device>();

function getBrowser(): Promise<Browser> {
    if (!browser) {
        browser = chromium.launch({ headless: true });
        // Si el arranque falla, el próximo intento vuelve a probar en vez de heredar la promesa rota.
        browser.catch(() => { browser = null; });
    }
    return browser;
}

/** Abre (o reabre limpio) el celular en `url`. Un contexto nuevo cada vez: nada de la corrida anterior. */
export async function openDevice(id: DeviceId, url: string): Promise<{ url: string; title: string }> {
    await closeDevice(id);
    const context = await (await getBrowser()).newContext({ ...PHONE, locale: 'es-CO', timezoneId: 'America/Bogota' });
    await blockDevOverlays(context);
    const page = await context.newPage();
    open.set(id, { context, page, openedAt: Date.now() });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return { url: page.url(), title: await page.title().catch(() => '') };
}

/** Dónde está el celular ahora: la URL después de las redirecciones. */
export function deviceState(id: DeviceId): { open: boolean; url?: string; since?: number } {
    const d = open.get(id);
    return d ? { open: true, url: d.page.url(), since: d.openedAt } : { open: false };
}

/** Una foto de la pantalla del celular (PNG). Es la vista hasta que esté el screencast. */
export async function deviceShot(id: DeviceId): Promise<Buffer | null> {
    const d = open.get(id);
    return d ? d.page.screenshot({ type: 'png' }) : null;
}

export async function closeDevice(id: DeviceId): Promise<void> {
    const d = open.get(id);
    open.delete(id);
    await d?.context.close().catch(() => { });
}

/** Cierra todo, incluido Chromium. Lo llama el panel al salir: un Chromium huérfano queda corriendo. */
export async function closeAllDevices(): Promise<void> {
    for (const id of [...open.keys()]) await closeDevice(id);
    const b = browser;
    browser = null;
    await (await b?.catch(() => null))?.close().catch(() => { });
}

// devices.ts — los celulares del panel como navegadores DE VERDAD, cada uno aislado.
//
// Cada celular (el del cliente y el del asesor) es su propio navegador, con sus cookies, `localStorage`,
// sesión y caché: dos celulares no se pisan la cookie de propiedad de la solicitud ni la sesión de
// Cognito, que es lo que no se puede
// lograr con iframes dentro del panel (comparten el almacenamiento del navegador; además el wizard
// prohíbe que lo embeban: `X-Frame-Options: DENY`).
//
// Cada celular corre en su propio contenedor de `selenium/standalone-chromium`: un Chromium con ventana que
// se USA a mano por su noVNC (que sí se deja embeber), mientras Playwright maneja ESE MISMO navegador por
// CDP (para abrir el flujo, el bypass y la sesión del asesor). Se ve la ventana real, también los menús
// nativos que un screencast no captura.
//
// Las redirecciones (302 del checkout, `/auto/…`, el `return_url`) pasan solas, como en el celular del
// comprador.
import { execFile } from 'node:child_process';
import { chromium, devices, type BrowserContext, type Page } from '@playwright/test';
import { blockDevOverlays } from '../pkg/dev-overlays.ts';

export type DeviceId = 'client' | 'advisor';

interface Device {
    context: BrowserContext;
    page: Page;
    openedAt: number;
    /** URL del visor mínimo del panel (`/device-view`) para embeber el noVNC del celular. */
    view?: string;
    close: () => Promise<void>;
}

// Un Android de gama media: la mayoría de los compradores entra desde uno.
const PHONE = devices['Pixel 7'];
const open = new Map<DeviceId, Device>();

// ── Motor selenium ───────────────────────────────────────────────────────────────────────────────
// Un contenedor por celular, cada uno con su navegador y sus puertos: el cliente y el asesor no comparten
// nada. Puertos sólo en 127.0.0.1: el noVNC no tiene contraseña.
const SELENIUM_IMAGE = 'selenium/standalone-chromium:latest';
// La pantalla del contenedor ES la del teléfono: el noVNC la escala al marco.
const SCREEN = { width: 412, height: 892 };   // 412 × 19,5 / 9: la proporción del marco del panel
interface SeleniumBox { container: string; gridPort: number; vncPort: number; grid: string }
const box = (container: string, gridPort: number, vncPort: number): SeleniumBox =>
    ({ container, gridPort, vncPort, grid: `http://127.0.0.1:${gridPort}` });
export const SELENIUM_BOXES: Record<DeviceId, SeleniumBox> = {
    client: box('harness-device-client', 4444, 7900),
    advisor: box('harness-device-advisor', 4445, 7901),
};
const docker = (args: string[]) => new Promise<string>((ok, fail) =>
    execFile('docker', args, { timeout: 120_000 }, (err, out, errOut) => err ? fail(new Error(String(errOut || err.message).trim())) : ok(String(out).trim())));

async function gridReady(b: SeleniumBox): Promise<boolean> {
    try { return (await (await fetch(b.grid + '/status', { signal: AbortSignal.timeout(2000) })).json())?.value?.ready === true; } catch { return false; }
}

/** El contenedor arriba y con su único lugar libre. Lo levanta si no existe; si quedó una sesión
 *  colgada de antes, la cierra. */
async function ensureSelenium(b: SeleniumBox): Promise<void> {
    const running = await docker(['inspect', '-f', '{{.State.Running}}', b.container]).catch(() => 'missing');
    if (running !== 'true') {
        if (running !== 'missing') await docker(['rm', '-f', b.container]).catch(() => '');
        await docker(['run', '-d', '--name', b.container, '--shm-size=2g',
            '-p', `127.0.0.1:${b.gridPort}:4444`, '-p', `127.0.0.1:${b.vncPort}:7900`,
            '-e', 'SE_VNC_NO_PASSWORD=true', '-e', `SE_SCREEN_WIDTH=${SCREEN.width}`, '-e', `SE_SCREEN_HEIGHT=${SCREEN.height}`,
            '-e', 'SE_SCREEN_DEPTH=24', '-e', 'SE_NODE_SESSION_TIMEOUT=3600', SELENIUM_IMAGE]);
    }
    for (let i = 0; i < 60 && !(await gridReady(b)); i++) {
        // Ocupado = una sesión vieja (de un panel que se cerró mal): se cierra para liberar el lugar.
        const st = await (await fetch(b.grid + '/status').catch(() => null))?.json().catch(() => null);
        for (const n of st?.value?.nodes ?? []) for (const s of n.slots ?? []) {
            if (s.session?.sessionId) await fetch(`${b.grid}/session/${s.session.sessionId}`, { method: 'DELETE' }).catch(() => { });
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    if (!(await gridReady(b))) throw new Error(`el contenedor ${b.container} no quedó listo (docker logs ${b.container})`);
}

async function openSelenium(b: SeleniumBox): Promise<Omit<Device, 'openedAt'>> {
    await ensureSelenium(b);
    const caps = {
        capabilities: {
            alwaysMatch: {
                browserName: 'chrome',
                'goog:chromeOptions': {
                    // Sin la franja «Un software de prueba automatizado está controlando…»: ocupa la pantalla.
                    excludeSwitches: ['enable-automation'],
                    args: [
                        // Adentro del contenedor `localhost` no es la Mac: el wizard (:5174), el backend (:80) y
                        // los mocks se alcanzan por el host de Docker. Mapear el NOMBRE deja intactas las URLs y
                        // las cookies (siguen siendo de `localhost`).
                        '--host-resolver-rules=MAP localhost host.docker.internal',
                        // Kiosco: la ventana ocupa la pantalla entera y sin barras. Con `--window-size` Chrome no
                        // baja de ~500 px de ancho, y en una pantalla de teléfono quedaba cortada.
                        '--kiosk', '--window-position=0,0', `--window-size=${SCREEN.width},${SCREEN.height}`,
                        `--user-agent=${PHONE.userAgent}`, '--lang=es-CO',
                    ],
                },
            },
        },
    };
    const r = await (await fetch(b.grid + '/session', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(caps),
    })).json();
    const sessionId: string | undefined = r?.value?.sessionId;
    const cdp: string | undefined = r?.value?.capabilities?.['se:cdp'];
    if (!sessionId || !cdp) throw new Error('Selenium no abrió la sesión: ' + JSON.stringify(r?.value?.message ?? r).slice(0, 200));
    // `se:cdp` trae la IP interna del contenedor; desde la Mac se entra por el puerto publicado.
    const remote = await chromium.connectOverCDP(cdp.replace(/^ws:\/\/[^/]+/, b.grid.replace('http', 'ws')));
    const context = remote.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    // Vista de teléfono: el wizard decide su diseño por el viewport y el táctil, no sólo por el user-agent.
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => { });
    return {
        context, page,
        // El visor mínimo del panel (`/device-view`): sólo la pantalla, sin las barras de noVNC.
        view: `/device-view?vnc=${b.vncPort}`,
        close: async () => {
            await remote.close().catch(() => { });
            await fetch(`${b.grid}/session/${sessionId}`, { method: 'DELETE' }).catch(() => { });
        },
    };
}

// ── La API del panel ─────────────────────────────────────────────────────────────────────────────
const ENGINE: Record<DeviceId, () => Promise<Omit<Device, 'openedAt'>>> = {
    client: () => openSelenium(SELENIUM_BOXES.client), advisor: () => openSelenium(SELENIUM_BOXES.advisor),
};

/** Una sesión guardada (la del conector del asesor): cookies y `localStorage` por origen, como
 *  `storageState` de Playwright. */
export interface DeviceSession {
    cookies: Parameters<BrowserContext['addCookies']>[0];
    origins?: { origin: string; localStorage: { name: string; value: string }[] }[];
}

/** Abre (o reabre limpio) el celular en `url`. Un navegador nuevo cada vez: nada de la corrida anterior.
 *  Con `session`, el navegador arranca con esa sesión puesta (el asesor entra sin loguearse). */
export async function openDevice(id: DeviceId, url: string, session?: DeviceSession,
    /** Algo más para hacer sobre la página ya abierta (p. ej. entrar con el asesor de prueba). */
    then?: (page: Page) => Promise<void>): Promise<{ url: string; title: string; view?: string }> {
    await closeDevice(id);
    const d = await ENGINE[id]();
    await blockDevOverlays(d.context);
    if (session) {
        if (session.cookies?.length) await d.context.addCookies(session.cookies);
        // El `localStorage` se escribe ANTES de que cargue la página de su origen, como hace `storageState`,
        // y UNA vez: el script corre en cada navegación y si no pisaría lo que la app escriba después.
        if (session.origins?.length) {
            await d.context.addInitScript((origins: NonNullable<DeviceSession['origins']>) => {
                const o = origins.find((x) => x.origin === location.origin);
                try {
                    if (!o || localStorage.getItem('harness.session-seeded')) return;
                    for (const { name, value } of o.localStorage) localStorage.setItem(name, value);
                    localStorage.setItem('harness.session-seeded', '1');
                } catch { }
            }, session.origins);
        }
    }
    open.set(id, { ...d, openedAt: Date.now() });
    await d.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (then) await then(d.page);
    return { url: d.page.url(), title: await d.page.title().catch(() => ''), view: d.view };
}

/** Los celulares abiertos: mientras haya uno, nadie debe reiniciar el wizard que está mostrando. */
export function openDevices(): DeviceId[] { return [...open.keys()]; }

/** Dónde está el celular ahora: la URL después de las redirecciones, y su visor si tiene. */
export function deviceState(id: DeviceId): { open: boolean; url?: string; since?: number; view?: string } {
    const d = open.get(id);
    return d ? { open: true, url: d.page.url(), since: d.openedAt, view: d.view } : { open: false };
}

/** Una foto de la pantalla del celular (PNG). */
export async function deviceShot(id: DeviceId): Promise<Buffer | null> {
    const d = open.get(id);
    return d ? d.page.screenshot({ type: 'png' }) : null;
}

export async function closeDevice(id: DeviceId): Promise<void> {
    const d = open.get(id);
    open.delete(id);
    await d?.close().catch(() => { });
}

/** Cierra todo, contenedores incluidos. Lo llama el panel al salir. */
export async function closeAllDevices(): Promise<void> {
    for (const id of [...open.keys()]) await closeDevice(id);
    for (const b of Object.values(SELENIUM_BOXES)) await docker(['stop', b.container]).catch(() => '');
}

/** Lo que el panel le reenvía a un celular SIN visor: un toque, una tecla, texto o la rueda. Las
 *  coordenadas llegan NORMALIZADAS (0–1 sobre la pantalla) y acá se pasan al viewport del teléfono. */
export type DeviceInput =
    | { type: 'click'; x: number; y: number }
    | { type: 'key'; key: string }
    | { type: 'text'; text: string }
    | { type: 'wheel'; x: number; y: number; dy: number };

export async function deviceInput(id: DeviceId, ev: DeviceInput): Promise<boolean> {
    const d = open.get(id);
    if (!d) return false;
    const vp = d.page.viewportSize() ?? { width: PHONE.viewport.width, height: PHONE.viewport.height };
    const at = (x: number, y: number) => [Math.round(Math.min(1, Math.max(0, x)) * vp.width), Math.round(Math.min(1, Math.max(0, y)) * vp.height)] as const;
    if (ev.type === 'click') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.click(x, y); }
    else if (ev.type === 'key') await d.page.keyboard.press(ev.key);
    else if (ev.type === 'text') await d.page.keyboard.type(ev.text);
    else if (ev.type === 'wheel') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.move(x, y); await d.page.mouse.wheel(0, ev.dy); }
    return true;
}

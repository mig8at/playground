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
import { installAutofill, type AutofillData } from '../pkg/autofill.ts';
import { chooseEntity } from '../pkg/wizard-browser.ts';

/* LOS CARRILES: varias pestañas pueden correr A LA VEZ, cada una con su par de celulares. El carril A son los de siempre
 * (`advisor`, `client`) y los demás los mismos con su letra (`advisor-b`, `client-c`…). El resto del panel no cambia: cada
 * mapa por celular ya iba por id, así que un carril nuevo es un id nuevo. `admin` es uno solo (la PC).
 * CUÁNTOS: `HARNESS_LANES` (4 por defecto, de 1 a 8). Eran dos fijos hasta el 2026-10-21; el techo de verdad no es
 * Chromium —cada celular es un contexto del MISMO navegador— sino el backend local (6 workers de PHP: con más corridas
 * a la vez que workers, hacen fila) y la memoria (~100-200 MB por celular abierto). */
const LANE_NAMES = 'abcdefgh';
export type Lane = string;   // 'a' … 'h'
export const LANES: Lane[] = LANE_NAMES.slice(0, Math.max(1, Math.min(LANE_NAMES.length, Number(process.env.HARNESS_LANES) || 4))).split('');
export type Role = 'client' | 'advisor' | 'admin';
export type DeviceId = 'admin' | 'client' | 'advisor' | `client-${string}` | `advisor-${string}`;
const LANE_SUFFIX = /-([b-h])$/;
export const laneOf = (id: string): Lane => LANE_SUFFIX.exec(id)?.[1] ?? 'a';
export const roleOf = (id: string): Role => id.replace(LANE_SUFFIX, '') as Role;
/** El celular de ese ROL en ese CARRIL (`inLane('client', 'b')` → `client-b`). */
export const inLane = (role: Role, lane: Lane): DeviceId => (lane === 'a' || role === 'admin' ? role : `${role}-${lane}`) as DeviceId;
/** El número del carril (A = 0): de ahí salen su celular y su cédula sintéticos. */
export const laneIndex = (lane: Lane): number => Math.max(0, LANE_NAMES.indexOf(lane));
/** ¿Es un celular que este panel atiende? (`admin`, o un rol en un carril que existe). */
export const isDeviceId = (s: string): s is DeviceId => s === 'admin' || (/^(client|advisor)(-[b-h])?$/.test(s) && LANES.includes(laneOf(s)));
/** Los CELULARES del carril A con su contenedor de Selenium; `admin` es la PC de la vista «Admin» (ver `openDesktop`). */
type PhoneId = 'client' | 'advisor';

interface Device {
    context: BrowserContext;
    page: Page;
    openedAt: number;
    /** URL del visor mínimo del panel (`/device-view`) para embeber el noVNC del celular. */
    view?: string;
    close: () => Promise<void>;
    /** ¿La sesión sigue viva para Selenium? (un comando de WebDriver, con plazo corto). */
    alive?: () => Promise<boolean>;
}

// Un Android de gama media: la mayoría de los compradores entra desde uno.
const PHONE = devices['Pixel 7'];
const DEVICE_SCALE = Math.min(3, Math.max(1, Number(process.env.HARNESS_DEVICE_SCALE) || 3));
const open = new Map<DeviceId, Device>();

/** A dónde va lo que pasa en cada celular (el panel lo escribe en la consola de la corrida). */
type DeviceLogger = (id: DeviceId, line: string) => void;
let deviceLogger: DeviceLogger = () => { };
export function setDeviceLogger(fn: DeviceLogger): void { deviceLogger = fn; }

/* ── EL RUIDO DE LA CONSOLA ────────────────────────────────────────────────────────────────────────────────────
 * Avisos que salen en CADA corrida local y no dicen nada del caso: tapaban lo que sí importaba (el 422 de la firma
 * quedó entre una docena de WebSocket fallidos, 2026-10-13). Se muestran UNA vez, marcados, y no se repiten.
 *  - el tiempo real del wizard intenta `wss://ws.credito…`, que fuera de la nube no resuelve (cada ~15 s);
 *  - React avisa que el HTML del servidor y el del navegador no coinciden en algún atributo (hidratación).
 * Cualquier otro aviso repetido se muestra la primera vez y después sólo como cuenta (5, 25, 100…), para que lo
 * nuevo no quede enterrado bajo lo que ya se vio. */
const KNOWN_NOISE: { re: RegExp; why: string }[] = [
    { re: /WebSocket connection to 'wss:\/\/ws\.credito/, why: 'el tiempo real del wizard no resuelve fuera de la nube' },
    { re: /A tree hydrated but some attributes/, why: 'aviso de hidratación de React' },
];
const REPEAT_MARKS = new Set([5, 25, 100, 500]);

/** Lo que el NAVEGADOR de un celular hace solo y conviene ver en orden: adónde navega, los errores de JS y de
 *  consola, y las respuestas ≥ 400 de documentos y llamadas (no de imágenes ni fuentes: son ruido). */
function narrate(id: DeviceId, d: Omit<Device, 'openedAt'>, isCurrent: () => boolean): void {
    const emit = (line: string) => { if (isCurrent()) deviceLogger(id, line); };
    const seen = new Map<string, number>();
    // Los avisos (no las navegaciones) pasan por acá: el ruido conocido sale una vez y lo repetido, como cuenta.
    const log = (line: string) => {
        const key = line.replace(/\d{3,}/g, '#');   // ids y referencias distintos no lo vuelven «otro» aviso
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        const noise = KNOWN_NOISE.find((k) => k.re.test(line));
        if (noise) { if (n === 1) emit(`${line} · ruido conocido (${noise.why}): no se vuelve a mostrar`); return; }
        if (n === 1) emit(line);
        else if (REPEAT_MARKS.has(n)) emit(`${line.slice(0, 120)}… · se repitió ${n} veces`);
    };
    let lastUrl = '';
    d.page.on('framenavigated', (frame) => {
        if (frame !== d.page.mainFrame()) return;
        const u = frame.url();
        if (u === lastUrl || u === 'about:blank') return;
        lastUrl = u;
        emit(`→ ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    });
    d.page.on('pageerror', (e) => log(`✗ error de JS: ${e.message.split('\n')[0].slice(0, 220)}`));
    d.page.on('console', (m) => { if (m.type() === 'error') log(`⚠ consola: ${m.text().split('\n')[0].slice(0, 220)}`); });
    d.page.on('response', (r) => {
        if (r.status() < 400) return;
        const kind = r.request().resourceType();
        if (!['document', 'fetch', 'xhr'].includes(kind)) return;
        log(`⚠ HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, '').slice(0, 160)}`);
    });
}

// ── Motor selenium ───────────────────────────────────────────────────────────────────────────────
// Un contenedor por celular, cada uno con su navegador y sus puertos: el cliente y el asesor no comparten
// nada. Puertos sólo en 127.0.0.1: el noVNC no tiene contraseña.
const SELENIUM_IMAGE = 'selenium/standalone-chromium:latest';
// La pantalla del contenedor ES la del teléfono: el noVNC la escala al marco.
const SCREEN = { width: 412, height: 892 };   // 412 × 19,5 / 9: la proporción del marco del panel
interface SeleniumBox { container: string; gridPort: number; vncPort: number; grid: string }
const box = (container: string, gridPort: number, vncPort: number): SeleniumBox =>
    ({ container, gridPort, vncPort, grid: `http://127.0.0.1:${gridPort}` });
// `HARNESS_DEVICES_SLOT=N` da OTRO par de contenedores (nombre `-N`, puertos +10·N): un segundo panel —uno de
// prueba en otro puerto— tiene sus propios celulares en vez de quedarse con los del panel de verdad.
const SLOT = Number(process.env.HARNESS_DEVICES_SLOT || 0) || 0;
const slotName = (n: string) => (SLOT ? `${n}-${SLOT}` : n);
export const SELENIUM_BOXES: Record<PhoneId, SeleniumBox> = {
    client: box(slotName('harness-device-client'), 4444 + SLOT * 10, 7900 + SLOT * 10),
    advisor: box(slotName('harness-device-advisor'), 4445 + SLOT * 10, 7901 + SLOT * 10),
};
// Los contenedores que ESTE panel usó: al salir apaga sólo ésos.
const usedBoxes = new Set<SeleniumBox>();
const docker = (args: string[]) => new Promise<string>((ok, fail) =>
    execFile('docker', args, { timeout: 120_000 }, (err, out, errOut) => err ? fail(new Error(String(errOut || err.message).trim())) : ok(String(out).trim())));

async function gridReady(b: SeleniumBox): Promise<boolean> {
    try { return (await (await fetch(b.grid + '/status', { signal: AbortSignal.timeout(2000) })).json())?.value?.ready === true; } catch { return false; }
}

/** El contenedor arriba y con su único lugar libre. Lo levanta si no existe; si quedó una sesión
 *  colgada de antes, la cierra. */
async function ensureSelenium(b: SeleniumBox): Promise<void> {
    usedBoxes.add(b);
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
    // ⚠ EL LATIDO. Selenium mata una sesión que pasa `SE_NODE_SESSION_TIMEOUT` (1 h) sin un comando de WEBDRIVER, y lo
    // que hace el panel va por CDP, y los toques por el visor, por VNC: ninguno cuenta. Así murió el 2026-10-06 la
    // reserva del cliente (creada 16:07, «timed out» 17:07) y al otro día el traspaso la tomó y se colgó sin avisar.
    // Un GET de la URL cada 5 min la mantiene viva, tanto de reserva como abierta.
    const webdriver = (ms: number) => fetch(`${b.grid}/session/${sessionId}/url`, { signal: AbortSignal.timeout(ms) });
    const heartbeat = setInterval(() => { void webdriver(10_000).catch(() => { }); }, 5 * 60_000);
    heartbeat.unref?.();
    return {
        context, page,
        // El visor mínimo del panel (`/device-view`): sólo la pantalla, sin las barras de noVNC.
        view: `/device-view?vnc=${b.vncPort}`,
        close: async () => {
            clearInterval(heartbeat);
            await remote.close().catch(() => { });
            await fetch(`${b.grid}/session/${sessionId}`, { method: 'DELETE' }).catch(() => { });
        },
        alive: async () => (await webdriver(2_000).catch(() => null))?.ok === true && remote.isConnected(),
    };
}

// ── Motor chromium (el de siempre desde 2026-10-13) ────────────────────────────────────────────────
// UN Chromium sin ventana dentro del propio panel, y cada celular es un CONTEXTO suyo: cookies, sesión de Cognito
// y almacenamiento propios, igual de aislados que dos navegadores. La pantalla se ve como imagen (`deviceShot`) y
// se avanza con los botones de abajo («Siguiente», «Hasta el final»): ya no se tipea en el celular, lo llena el
// autorrelleno. Sin contenedores, no queda una sesión ocupada al reiniciar el panel (se trabó tres veces el
// 2026-10-09), corre con la VPN de la Mac y abrir uno cuesta un contexto, no un navegador.
// `HARNESS_DEVICE_ENGINE=selenium` vuelve al motor de antes (ventana real por noVNC, para manejarlo a mano).
const ENGINE_NAME = (process.env.HARNESS_DEVICE_ENGINE || 'chromium').toLowerCase() === 'selenium' ? 'selenium' : 'chromium';
let sharedBrowser: Promise<import('@playwright/test').Browser> | null = null;
function browserForDevices(): Promise<import('@playwright/test').Browser> {
    if (!sharedBrowser) {
        // ⚠ LA NITIDEZ SE PIDE AL LANZAR, NO AL TRANSMITIR. El screencast manda el cuadro al tamaño de la página (412 px de
        // ancho) aunque el celular emule 2,625× y aunque se pida un `maxWidth` mayor: en una pantalla retina se veía
        // blando. Con `--force-device-scale-factor` Chromium dibuja la página a esa escala y el cuadro sale a 824 px
        // (2×) o 1236 (3×), con el diseño intacto en 412 (medido el 2026-10-13: `innerWidth` sigue en 412).
        // Por defecto 3× (lo eligió Miguel: se ve nítido y corre fluido en local); `HARNESS_DEVICE_SCALE=2` lo baja.
        sharedBrowser = chromium.launch({ headless: true, args: ['--lang=es-CO', `--force-device-scale-factor=${DEVICE_SCALE}`] });
        // Si se cae, el próximo celular lanza otro.
        void sharedBrowser.then((b) => b.on('disconnected', () => { sharedBrowser = null; })).catch(() => { sharedBrowser = null; });
    }
    return sharedBrowser;
}
/* ── EL `<select>` NATIVO SE DIBUJA EN LA PÁGINA ─────────────────────────────────────────────────────────────────
 * Chromium abre la lista de un `<select>` nativo como una ventana del sistema, fuera de la página: el screencast y la
 * foto no la ven, así que al tocarlo en el panel «no pasa nada» aunque la lista esté abierta (medido el 2026-10-13: el
 * valor sí cambia con las flechas). Los de Radix (las fechas) no tienen el problema: su lista es parte de la página.
 * Este script, inyectado en cada celular, intercepta el toque sobre un `<select>` nativo y muestra sus opciones como
 * una lista DENTRO de la página, que el video sí ve y se toca. Elegir fija el valor con el setter nativo y dispara
 * `input` y `change`, que es lo que escucha React. Escape o tocar afuera la cierra. */
function nativeSelectInPage(): void {
    const ID = '__harness_select';
    const close = () => document.getElementById(ID)?.remove();
    document.addEventListener('mousedown', (e) => {
        const target = e.target as Element | null;
        if (target?.closest?.(`#${ID}`)) return;
        close();
        const sel = target?.closest?.('select') as HTMLSelectElement | null;
        if (!sel || sel.multiple || sel.size > 1 || sel.disabled) return;
        e.preventDefault();
        sel.focus();
        const r = sel.getBoundingClientRect();
        const list = document.createElement('div');
        list.id = ID;
        const below = window.innerHeight - r.bottom, maxH = Math.max(160, Math.min(320, Math.max(below, r.top) - 12));
        Object.assign(list.style, {
            position: 'fixed', left: `${Math.max(8, r.left)}px`, width: `${Math.max(r.width, 180)}px`, maxHeight: `${maxH}px`,
            overflowY: 'auto', zIndex: '2147483647', background: '#fff', color: '#1f1f3a', borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,.18)', font: '15px system-ui, sans-serif', padding: '4px 0',
            ...(below >= maxH || below >= r.top ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
        });
        for (const opt of Array.from(sel.options)) {
            const row = document.createElement('div');
            row.textContent = opt.text;
            Object.assign(row.style, { padding: '10px 14px', cursor: 'pointer', opacity: opt.disabled ? '.4' : '1',
                background: opt.selected ? '#ece9ff' : 'transparent', fontWeight: opt.selected ? '600' : '400' });
            if (!opt.disabled) row.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                setter ? setter.call(sel, opt.value) : (sel.value = opt.value);
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                close();
            });
            list.appendChild(row);
        }
        document.body.appendChild(list);
        list.querySelector<HTMLElement>('div[style*="font-weight: 600"]')?.scrollIntoView({ block: 'nearest' });
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
    window.addEventListener('scroll', (e) => { if (!(e.target as Element)?.closest?.(`#${ID}`)) close(); }, true);
}

async function openChromium(): Promise<Omit<Device, 'openedAt'>> {
    const browser = await browserForDevices();
    // La pantalla del marco del panel (la misma proporción que tenía el noVNC) con lo demás del Pixel 7: user-agent,
    // táctil y móvil, que es como el wizard decide su diseño.
    const context = await browser.newContext({ ...PHONE, viewport: SCREEN, screen: SCREEN, locale: 'es-CO' });
    await context.addInitScript(nativeSelectInPage);
    const page = await context.newPage();
    return {
        context, page,
        close: async () => { await context.close().catch(() => { }); },
        alive: async () => browser.isConnected() && !page.isClosed(),
    };
}

/* ── LA PC DEL ADMIN ─────────────────────────────────────────────────────────────────────────────────────────────
 * El admin de `legacy-application` es de escritorio: en un viewport de teléfono se ve la versión apretada que nadie usa.
 * Es su propio Chromium sin ventana y no un contexto del de los celulares, porque aquél se lanza forzando la escala 3×
 * (`DEVICE_SCALE`) y una pantalla de 1366 px a 3× son cuadros de 4.098 px que no se ven mejor y pesan nueve veces más.
 * ⚠ La escala se pide al lanzar por la misma razón que en los celulares: el screencast ignora `deviceScaleFactor`.
 * Siempre este motor, también con `HARNESS_DEVICE_ENGINE=selenium`: la ventana real por noVNC era para tocar menús
 * nativos de un celular, y el admin no tiene contenedor propio. */
export const DESKTOP = { width: 1366, height: 768 };
const DESKTOP_SCALE = Math.min(2, Math.max(1, Number(process.env.HARNESS_DESKTOP_SCALE) || 1.5));
let desktopBrowser: Promise<import('@playwright/test').Browser> | null = null;
async function openDesktop(): Promise<Omit<Device, 'openedAt'>> {
    if (!desktopBrowser) {
        desktopBrowser = chromium.launch({ headless: true, args: ['--lang=es-CO', `--force-device-scale-factor=${DESKTOP_SCALE}`] });
        void desktopBrowser.then((b) => b.on('disconnected', () => { desktopBrowser = null; })).catch(() => { desktopBrowser = null; });
    }
    const browser = await desktopBrowser;
    const context = await browser.newContext({ viewport: DESKTOP, screen: DESKTOP, locale: 'es-CO' });
    await context.addInitScript(nativeSelectInPage);   // los `<select>` nativos del admin tampoco salen en el screencast
    const page = await context.newPage();
    return {
        context, page,
        close: async () => { await context.close().catch(() => { }); },
        alive: async () => browser.isConnected() && !page.isClosed(),
    };
}
/** El tamaño de la pantalla de cada dispositivo, para pedir el screencast. */
const screenOf = (id: DeviceId) => (id === 'admin' ? { ...DESKTOP, scale: DESKTOP_SCALE } : { ...SCREEN, scale: DEVICE_SCALE });

// ── La API del panel ─────────────────────────────────────────────────────────────────────────────
/** Con qué se abre cada celular. Los de los carriles que no son el A van siempre con Chromium: el motor de Selenium tiene
 *  UN par de contenedores por panel. */
const engineFor = (id: DeviceId): (() => Promise<Omit<Device, 'openedAt'>>) =>
    id === 'admin' ? openDesktop
        : ENGINE_NAME === 'selenium' && laneOf(id) === 'a' ? () => openSelenium(SELENIUM_BOXES[roleOf(id) as PhoneId])
            : openChromium;
/** Con qué motor corren los celulares (lo muestra el panel). */
export const DEVICE_ENGINE = ENGINE_NAME;

/* ── EL NAVEGADOR DE RESERVA ─────────────────────────────────────────────────────────────────────────
 * Abrir un celular era: contenedor (frío, ~3 s) + sesión de Chromium (0,3–0,8 s) + CDP + la página. Medido el
 * 2026-10-06 en un contenedor aparte. Lo único que depende de QUÉ se abre es la página; lo demás se adelanta:
 * con el celular cerrado, su contenedor ya tiene un Chromium nuevo esperando, y abrir sólo lo toma y navega.
 * Cada reserva es un navegador SIN USAR (perfil limpio, como antes): se toma una vez y al cerrar el celular se
 * prepara la siguiente. Sólo con el celular cerrado: el contenedor tiene un lugar y la pantalla es una sola. */
const spare = new Map<DeviceId, Promise<Omit<Device, 'openedAt'> | null>>();
function refillSpare(id: DeviceId): void {
    // La PC no deja reserva: se abre de vez en cuando y un Chromium esperando por ella es memoria que casi nunca se usa.
    if (id === 'admin' || open.has(id) || spare.has(id)) return;
    spare.set(id, engineFor(id)().catch(() => null));
}
async function takeSpare(id: DeviceId): Promise<{ d: Omit<Device, 'openedAt'>; reused: boolean }> {
    const pending = spare.get(id);
    spare.delete(id);
    // Una reserva que tarda más de 20 s en estar lista se da por perdida: mejor un navegador nuevo que colgarse.
    const d = pending ? await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]) : null;
    // Una reserva que se murió mientras esperaba (sesión vencida, contenedor reiniciado) no sirve: se abre otra.
    // Se le PREGUNTA a Selenium (`alive`): la conexión CDP puede seguir abierta con la sesión ya muerta.
    if (d && !d.page.isClosed() && (await d.alive?.().catch(() => false) ?? true)) return { d, reused: true };
    if (d) await d.close().catch(() => { });
    return { d: await engineFor(id)(), reused: false };
}
/** Prepara los dos celulares en segundo plano (el contenedor y su navegador de reserva). Lo llama el panel al
 *  arrancar; y `warmDevice`, antes de las consultas que preceden a abrir uno, para que corran en paralelo. */
export function prewarmDevices(): void { for (const id of Object.keys(SELENIUM_BOXES) as DeviceId[]) refillSpare(id); }
export function warmDevice(id: DeviceId): void { refillSpare(id); }

/** Una sesión guardada (la del conector del asesor): cookies y `localStorage` por origen, como
 *  `storageState` de Playwright. */
export interface DeviceSession {
    cookies: Parameters<BrowserContext['addCookies']>[0];
    origins?: { origin: string; localStorage: { name: string; value: string }[] }[];
}

/** Abre (o reabre limpio) el celular en `url`. Un navegador nuevo cada vez: nada de la corrida anterior.
 *  Con `session`, el navegador arranca con esa sesión puesta (el asesor entra sin loguearse). */
export async function openDevice(id: DeviceId, url: string, opts: {
    session?: DeviceSession;
    /** Algo más para hacer sobre la página ya abierta (p. ej. entrar con el asesor de prueba). */
    then?: (page: Page) => Promise<void>;
    /** Los datos del caso para el AUTORRELLENO (`pkg/autofill.ts`): cada pantalla del wizard se llena sola, sin
     *  pisar lo que escribas y sin apretar «Continuar». */
    autofill?: AutofillData;
} = {}): Promise<{ url: string; title: string; view?: string }> {
    const { session, then, autofill } = opts;
    const started = performance.now();
    await closeDevice(id);
    const { d, reused } = await takeSpare(id);
    const browserMs = performance.now() - started;
    await blockDevOverlays(d.context);
    if (autofill) {
        // En un celular la tarjeta «harness» del autorrelleno tapa la pantalla y su estado de BD no aplica (no hay
        // una corrida que la alimente): arranca CERRADA. El autorrelleno sigue llenando igual; ⌥H la vuelve a
        // abrir. Su estado vive en `sessionStorage`; si ya la abriste, se respeta.
        await d.context.addInitScript(() => {
            try { if (!sessionStorage.getItem('__harness_card')) sessionStorage.setItem('__harness_card', JSON.stringify({ closed: true })); } catch { }
        });
        await installAutofill(d.context, autofill);
    }
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
    const openedAt = Date.now();
    open.set(id, { ...d, openedAt });
    // Si el navegador muere por fuera (el contenedor se borró o se reinició, Selenium venció la sesión), el
    // celular deja de figurar como abierto. Sin esto el panel seguía mostrando la sesión vieja como viva y el
    // traspaso al cliente no volvía a abrir nada: el visor quedaba en «El celular del cliente» (2026-10-06).
    d.context.on('close', () => {
        if (open.get(id)?.openedAt !== openedAt) return;
        open.delete(id);
        deviceLogger(id, '✗ el navegador del celular se cerró');
    });
    d.context.browser()?.on('disconnected', () => {
        if (open.get(id)?.openedAt !== openedAt) return;
        open.delete(id);
        deviceLogger(id, '✗ el navegador se cerró por fuera (contenedor borrado o sesión vencida)');
    });
    narrate(id, d, () => open.get(id)?.openedAt === openedAt);
    const pageAt = performance.now();
    await d.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const s = (x: number) => (x / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 });
    deviceLogger(id, `✓ abierto en ${s(performance.now() - started)} s (navegador ${s(browserMs)}${reused ? ' · de reserva' : ' · nuevo'} · página ${s(performance.now() - pageAt)})`);
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

/** La sesión del celular (cookies y `localStorage`), para retomarlo después de reiniciar el panel. */
export async function deviceStorage(id: DeviceId): Promise<DeviceSession | null> {
    const d = open.get(id);
    if (!d) return null;
    const s = await d.context.storageState().catch(() => null);
    return s ? { cookies: s.cookies, origins: s.origins } : null;
}

/** Una foto de la pantalla del celular (PNG). */
export async function deviceShot(id: DeviceId): Promise<Buffer | null> {
    const d = open.get(id);
    // JPEG: la pantalla se refresca cada medio segundo y un PNG del celular pesa ~5 veces más.
    return d ? d.page.screenshot({ type: 'jpeg', quality: 70 }) : null;
}

/* ── LA PANTALLA EN VIVO (CDP screencast) ──────────────────────────────────────────────────────────────────────
 * Chromium manda un cuadro cada vez que la pantalla CAMBIA (no cada X segundos), así que se ve fluido y no se paga
 * nada con la pantalla quieta. Reemplaza a la foto cada 0,6 s (2026-10-13). Un iframe no sirve: el wizard no se deja
 * embeber (`X-Frame-Options: DENY`) y abriría otra sesión en el navegador de quien mira, fuera del aislamiento y del
 * control del harness. La transmisión arranca con el primero que mira y para con el último que se va. */
type Frame = (jpeg: Buffer) => void;
const casts = new Map<DeviceId, { openedAt: number; viewers: Set<{ frame: Frame; end: () => void }>; last?: Buffer; stop: () => Promise<void> }>();
export async function deviceStream(id: DeviceId, frame: Frame, end: () => void): Promise<(() => void) | null> {
    const d = open.get(id);
    if (!d) return null;
    let cast = casts.get(id);
    if (cast && cast.openedAt !== d.openedAt) { await cast.stop(); cast = undefined; }   // es otro celular: se reinicia
    if (!cast) {
        const cdp = await d.context.newCDPSession(d.page);
        const c = { openedAt: d.openedAt, viewers: new Set<{ frame: Frame; end: () => void }>(), last: undefined as Buffer | undefined,
            stop: async () => {
                casts.delete(id);
                for (const v of c.viewers) v.end();
                await cdp.send('Page.stopScreencast').catch(() => { });
                await cdp.detach().catch(() => { });
            } };
        cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
            void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => { });
            c.last = Buffer.from(f.data, 'base64');
            for (const v of c.viewers) v.frame(c.last);
        });
        // A la escala con que se lanzó Chromium (`DEVICE_SCALE`; la PC, `DESKTOP_SCALE`): nítido en una pantalla retina sin mandar más de lo que se ve.
        const sc = screenOf(id);
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: Math.round(sc.width * sc.scale), maxHeight: Math.round(sc.height * sc.scale) });
        d.context.on('close', () => { void c.stop(); });
        // Después de navegar —también dentro de la app, que no dispara `load`—, Chromium no siempre repinta (una página que
        // se dibuja igual o que termina de cargar sin cambios no manda cuadro): se fuerza una foto para que el panel no quede en la pantalla anterior.
        d.page.on('framenavigated', (fr) => {
            if (fr !== d.page.mainFrame()) return;
            setTimeout(() => {
                if (casts.get(id) !== c) return;
                void d.page.screenshot({ type: 'jpeg', quality: 70 }).then((shot) => { c.last = shot; for (const v of c.viewers) v.frame(shot); }).catch(() => { });
            }, 800);
        });
        casts.set(id, c);
        cast = c;
    }
    const viewer = { frame, end };
    cast.viewers.add(viewer);
    // Quien llega ve ya la pantalla de ahora: con la pantalla quieta Chromium no manda nada nuevo.
    if (cast.last) frame(cast.last);
    else { const shot = await d.page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null); if (shot) frame(shot); }
    const mine = cast;
    return () => {
        mine.viewers.delete(viewer);
        if (!mine.viewers.size && casts.get(id) === mine) void mine.stop();
    };
}

/* ── ¿EL CELULAR ESTÁ CARGANDO? ─────────────────────────────────────────────────────────────────────────────────
 * Avisa cuando hay una navegación o un `.data` del wizard en vuelo (el cambio de pantalla de React Router pide el
 * `.data` de la ruta nueva antes de pintarla): sin aviso, el celular parece congelado justo cuando más espera. Sólo
 * avisa si la espera pasa de 250 ms, para que un cambio rápido no parpadee. Devuelve cómo dejar de mirar. */
export function deviceBusyWatch(id: DeviceId, cb: (busy: boolean) => void): (() => void) | null {
    const d = open.get(id);
    if (!d) return null;
    const pending = new Set<unknown>();
    let shown = false, timer: NodeJS.Timeout | null = null;
    const counts = (req: { isNavigationRequest(): boolean; frame(): unknown; url(): string; resourceType(): string }) =>
        (req.isNavigationRequest() && req.frame() === d.page.mainFrame()) || (req.resourceType() === 'fetch' && /\.data(\?|$)/.test(req.url()));
    const update = () => {
        if (pending.size && !shown && !timer) timer = setTimeout(() => { timer = null; if (pending.size) { shown = true; cb(true); } }, 250);
        if (!pending.size) { if (timer) { clearTimeout(timer); timer = null; } if (shown) { shown = false; cb(false); } }
    };
    const onRequest = (req: Parameters<typeof counts>[0]) => { if (counts(req)) { pending.add(req); update(); } };
    const onDone = (req: unknown) => { if (pending.delete(req)) update(); };
    const onNav = () => { pending.clear(); update(); };   // una navegación nueva deja huérfanas las de la página anterior
    d.page.on('request', onRequest);
    d.page.on('requestfinished', onDone);
    d.page.on('requestfailed', onDone);
    d.page.on('load', onNav);
    return () => {
        if (timer) clearTimeout(timer);
        d.page.off('request', onRequest);
        d.page.off('requestfinished', onDone);
        d.page.off('requestfailed', onDone);
        d.page.off('load', onNav);
    };
}

export async function closeDevice(id: DeviceId): Promise<void> {
    const d = open.get(id);
    open.delete(id);
    await d?.close().catch(() => { });
    // El lugar quedó libre: la próxima apertura ya tiene navegador. Sólo en el carril A: con N carriles, una reserva por
    // celular de cada uno serían hasta 16 Chromium esperando; los otros lo preparan al abrir (`warmDevice`).
    if (d && laneOf(id) === 'a') refillSpare(id);
}

/** Cierra todo, contenedores incluidos. Lo llama el panel al salir. */
export async function closeAllDevices(): Promise<void> {
    for (const id of [...open.keys()]) { const d = open.get(id); open.delete(id); await d?.close().catch(() => { }); }
    for (const [id, p] of [...spare]) { spare.delete(id); await (await p)?.close().catch(() => { }); }
    for (const b of usedBoxes) await docker(['stop', b.container]).catch(() => '');
    if (sharedBrowser) { const b = await sharedBrowser.catch(() => null); sharedBrowser = null; await b?.close().catch(() => { }); }
    if (desktopBrowser) { const b = await desktopBrowser.catch(() => null); desktopBrowser = null; await b?.close().catch(() => { }); }
}

/** Lo que el panel le reenvía a un celular SIN visor: un toque, una tecla, texto o la rueda. Las
 *  coordenadas llegan NORMALIZADAS (0–1 sobre la pantalla) y acá se pasan al viewport del teléfono. */
export type DeviceInput =
    | { type: 'click'; x: number; y: number }
    | { type: 'key'; key: string }
    | { type: 'text'; text: string }
    | { type: 'wheel'; x: number; y: number; dy: number }
    // Arrastrar y mantener presionado: el dedo baja, se mueve y sube. Un toque corto es down + up en el mismo lugar.
    | { type: 'down' | 'move' | 'up'; x: number; y: number };

// El tamaño de la página se pregunta una vez por segundo como mucho: un arrastre manda decenas de `move` y preguntarlo
// en cada uno agregaba una vuelta a la página por evento.
const viewportCache = new Map<DeviceId, { at: number; vp: { width: number; height: number } }>();

export async function deviceInput(id: DeviceId, ev: DeviceInput): Promise<boolean> {
    const d = open.get(id);
    if (!d) return false;
    // ⚠ EL TAMAÑO REAL, NO EL DE FÁBRICA. Conectado por CDP a un navegador que ya existe, `viewportSize()` es null y caía
    // al Pixel 7 (412×839), pero la ventana del contenedor mide 412×892: cada clic quedaba ~6% más arriba y erraba los
    // botones (medido el 2026-10-08: «Validar pre aprobado» en 700–746 px, el clic en 680). Se mide en la página.
    const cached = viewportCache.get(id);
    const vp = cached && Date.now() - cached.at < 1000 ? cached.vp
        : (await d.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null)
            ?? d.page.viewportSize() ?? (id === 'admin' ? DESKTOP : { width: PHONE.viewport.width, height: PHONE.viewport.height }));
    viewportCache.set(id, { at: cached && cached.vp === vp ? cached.at : Date.now(), vp });
    const at = (x: number, y: number) => [Math.round(Math.min(1, Math.max(0, x)) * vp.width), Math.round(Math.min(1, Math.max(0, y)) * vp.height)] as const;
    if (ev.type === 'click') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.click(x, y); }
    else if (ev.type === 'key') await d.page.keyboard.press(ev.key);
    else if (ev.type === 'text') await d.page.keyboard.type(ev.text);
    else if (ev.type === 'wheel') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.move(x, y); await d.page.mouse.wheel(0, ev.dy); }
    else if (ev.type === 'down') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.move(x, y); await d.page.mouse.down(); }
    else if (ev.type === 'move') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.move(x, y); }
    else if (ev.type === 'up') { const [x, y] = at(ev.x, ev.y); await d.page.mouse.move(x, y); await d.page.mouse.up(); }
    return true;
}

/* ── MANEJAR EL CELULAR POR TEXTO, NO POR COORDENADAS ─────────────────────────────────────────────────────────────
 * Para avanzar una corrida había que sacar una captura, ubicar el botón y calcular la fracción de la pantalla; cada
 * reacomodo (un aviso que desaparece) movía el botón y el clic caía al lado (2026-10-08). Acá se busca el control
 * como lo buscaría una persona: por lo que DICE. */

/** El primer control VISIBLE que dice `text`: botón, enlace o, si no hay, cualquier elemento con ese texto. */
async function visibleControl(page: Page, text: string) {
    for (const loc of [page.getByRole('button', { name: text }), page.getByRole('link', { name: text }), page.getByText(text, { exact: true })]) {
        for (const el of await loc.all()) if (await el.isVisible().catch(() => false)) return el;
    }
    return null;
}

/** Toca el control que dice `text`. */
export async function deviceTap(id: DeviceId, text: string): Promise<{ ok: boolean; detail: string }> {
    const d = open.get(id);
    if (!d) return { ok: false, detail: 'el celular no está abierto' };
    const el = await visibleControl(d.page, text);
    if (!el) return { ok: false, detail: `no hay nada visible que diga «${text}»` };
    if (await el.isDisabled().catch(() => false)) return { ok: false, detail: `«${text}» está deshabilitado` };
    await el.click({ timeout: 10_000 });
    return { ok: true, detail: `tocó «${text}»` };
}

/** Los botones que hacen AVANZAR el recorrido, en orden: si hay varios, gana el primero de la lista. Nunca se tocan
 *  «Cancelar», «No corresponde» ni «Regresar al comercio»: no están acá. */
// Los primeros del ASESOR (monto, código, validación) salen de los botones del wizard (`<Loader /> : "…"`, medido el
// 2026-10-13): sin ellos «Siguiente» se quedaba en el monto. Afuera, a propósito: «Iniciar otra solicitud» (empieza de
// nuevo) y «Reintentar validación» (podría girar en falso).
const ADVANCE = ['Validar Pre aprobado', 'Iniciar solicitud', 'Confirmar código', 'Confirmar', 'Continuar', 'Elegir fecha de pago', 'Firmar',
    'Validar ahora', 'Enviar solicitud', 'Enviar', 'Siguiente', 'Aceptar'];

/**
 * Un MONTO vacío (la cuota inicial) se llena con el mínimo, que la pantalla trae de placeholder. Va SIEMPRE, no sólo con
 * el botón deshabilitado: en la cuota inicial «Continuar» está habilitado y la validación salta recién al tocarlo
 * (medido el 2026-10-08: quince toques seguidos sin salir de la pantalla).
 */
async function fillAmounts(page: Page): Promise<string[]> {
    const did: string[] = [];
    for (const input of await page.locator('input:visible').all()) {
        const [value, placeholder] = [await input.inputValue().catch(() => ''), await input.getAttribute('placeholder').catch(() => '')];
        const digits = String(placeholder ?? '').replace(/\D/g, '');
        if (!value && /\$/.test(String(placeholder ?? '')) && digits) { await input.fill(digits); did.push(`escribió ${placeholder}`); }
    }
    return did;
}

/** Un OTP vacío (el de entrada o el de la firma) se llena con el código del bypass, si quien llama lo sabe. El
 *  componente compartido (`input-otp`) es UN input con `autocomplete="one-time-code"` debajo de las casillas. */
async function fillOtp(page: Page, otp?: string): Promise<string[]> {
    if (!otp) return [];
    for (const input of await page.locator('input[autocomplete="one-time-code"], input[data-input-otp]').all()) {
        if (!(await input.inputValue().catch(() => 'x'))) { await input.fill(otp); return [`escribió el código ${otp}`]; }
    }
    return [];
}

/**
 * Lo que traba al botón principal cuando está DESHABILITADO, destrabado como lo haría quien prueba:
 *  · un DOCUMENTO (la firma) se baja hasta el final, que es lo que habilita «Firmar»;
 *  · una CASILLA de confirmación sin marcar (la fecha de expedición: «¿Confirmas que eres…?») se marca.
 * Devuelve qué hizo, para decirlo en la consola.
 */
async function unlock(page: Page): Promise<string[]> {
    const did: string[] = [];
    const scrolled = await page.evaluate(() => {
        let n = 0;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
            if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
                el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); n++;
            }
        }
        return n;
    }).catch(() => 0);
    if (scrolled) did.push('bajó hasta el final del documento');
    // «Confirmación de cupo» SIN contestar: «No», el flujo entero, como la corrida guiada (`preferirRadio`). El
    // autorrelleno no la toca porque «Sí» firma otro flujo (F-214); acá ya se pidió avanzar, y si alguien eligió
    // antes, se respeta.
    if (await page.getByText('Confirmación de cupo').first().isVisible().catch(() => false)) {
        const radios = page.getByRole('radio');
        const chosen = await radios.evaluateAll((els) => els.some((e) => e.getAttribute('aria-checked') === 'true')).catch(() => true);
        let no = page.getByRole('radio', { name: 'No', exact: true }).first();
        if (!(await no.isVisible().catch(() => false))) no = page.getByText('No', { exact: true }).first();
        if (!chosen && await no.isVisible().catch(() => false)) {
            await no.click({ timeout: 5_000 }).catch(() => { });
            did.push('contestó «No» en «Confirmación de cupo» (el flujo entero)');
        }
    }
    for (const box of await page.getByRole('checkbox').all()) {
        if (await box.isVisible().catch(() => false) && !(await box.isChecked().catch(() => true))) {
            await box.check({ timeout: 5_000 }).catch(() => box.click().catch(() => { }));
            did.push('marcó la casilla de confirmación');
        }
    }
    if (did.length) await page.waitForTimeout(400);
    return did;
}

/** Toca el botón principal de la pantalla (ver `ADVANCE`), destrabándolo si hace falta. `otp`: el código del bypass. */
export async function deviceAdvance(id: DeviceId, otp?: string, waitMs = 4_000): Promise<{ ok: boolean; detail: string; moved?: boolean; url?: string }> {
    const d = open.get(id);
    if (!d) return { ok: false, detail: 'el celular no está abierto' };
    for (const label of ADVANCE) {
        const el = await visibleControl(d.page, label);
        if (!el) continue;
        const did = [...await fillAmounts(d.page), ...await fillOtp(d.page, otp)];
        if (await el.isDisabled().catch(() => false)) did.push(...await unlock(d.page));
        if (await el.isDisabled().catch(() => false)) {
            return { ok: false, detail: `«${label}» sigue deshabilitado${did.length ? ` (${did.join(', ')})` : ''}: falta algo que el panel no sabe llenar` };
        }
        const before = d.page.url();
        await el.click({ timeout: 10_000 });
        // Tocar no es avanzar: si la ruta no cambió, puede ser una validación (o una pantalla que avanza sola por dentro).
        // `waitMs`: qa navega más lento que local (la respuesta del backend viaja por la VPN); con 4 s se leía «no cambió».
        await d.page.waitForURL((u) => u.toString() !== before, { timeout: waitMs }).catch(() => { });
        const moved = d.page.url() !== before;
        const tail = moved ? '' : ' · la pantalla no cambió de ruta';
        return { ok: true, detail: [...did, `tocó «${label}»`].join(' · ') + tail, moved, url: d.page.url() };
    }
    return { ok: false, detail: `no hay un botón para avanzar (${ADVANCE.join(', ')})`, url: d.page.url() };
}

/** Escribe un OTP en la pantalla del celular (el campo del componente compartido, `input-otp`), si está vacío. Es lo que
 *  hace «Avanzar» con el código del bypass; acá lo usa el código leído del servicio de OTP en la base compartida. */
export async function deviceFillOtp(id: DeviceId, code: string): Promise<boolean> {
    const d = open.get(id);
    if (!d) return false;
    return (await fillOtp(d.page, code)).length > 0;
}

/** Elige una ENTIDAD en el listado por su nombre, con el mismo `chooseEntity` de los runners (`pkg/wizard-browser.ts`): sabe
 *  abrir las tarjetas que se despliegan y tocar el botón de adentro. Si no la encuentra, devuelve los botones que se veían. */
export async function deviceChooseEntity(id: DeviceId, name: string): Promise<{ ok: boolean; detail: string; visibles: string[] }> {
    const d = open.get(id);
    if (!d) return { ok: false, detail: 'el celular no está abierto', visibles: [] };
    const r = await chooseEntity(d.page, name);
    if (!r.ok) return { ok: false, detail: `«${name}» no está en el listado`, visibles: r.visibles };
    return { ok: true, detail: `eligió «${name}»${r.motivo ? ` (⚠ ${r.motivo})` : ''}`, visibles: r.visibles };
}

/** Avisa cada navegación de la página principal de un celular (para seguir el flujo desde el panel). */
export function watchNavigation(id: DeviceId, onUrl: (url: string) => void): void {
    const d = open.get(id);
    if (!d) return;
    d.page.on('framenavigated', (frame) => { if (frame === d.page.mainFrame()) onUrl(frame.url()); });
}

/** Cada petición que hace el navegador del celular (incluidas las de iframes, como el widget de Wompi). */
export function watchRequests(id: DeviceId, onUrl: (url: string) => void): void {
    const d = open.get(id);
    if (!d) return;
    d.page.on('request', (r) => onUrl(r.url()));
}

/** Recarga la página del celular (el botón que aparece al pararse sobre él). `false` si no hay nada abierto. */
export async function deviceReload(id: DeviceId): Promise<boolean> {
    const d = open.get(id);
    if (!d) return false;
    await d.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    return true;
}

/** Lleva un celular a otra URL (para el rescate de F-220: seguir por el `callback` de la validación de identidad). */
export async function deviceGoto(id: DeviceId, url: string): Promise<void> {
    await open.get(id)?.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

/** El texto visible de la pantalla de un celular (para ver un modal que aparece sin navegar), o `''`. */
export async function deviceText(id: DeviceId): Promise<string> {
    const d = open.get(id);
    return d ? await d.page.evaluate(() => document.body?.innerText ?? '').catch(() => '') : '';
}

/** Corre una función en la página de un celular (p. ej. entregarle al asesor el aviso de socket que en local no llega). */
export async function deviceEval<A, R>(id: DeviceId, fn: (arg: A) => R, arg: A): Promise<R | undefined> {
    const d = open.get(id);
    return d ? await d.page.evaluate(fn as any, arg).catch(() => undefined) as R : undefined;
}

/** Cuándo se abrió el celular (para saber si un vigilante sigue mirando al MISMO navegador). */
export function deviceOpenedAt(id: DeviceId): number | null {
    return open.get(id)?.openedAt ?? null;
}

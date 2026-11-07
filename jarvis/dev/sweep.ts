// EL BARRIDO DE SECCIONES (nivel 1 de jarvis/GUIDE.md): recorre el menú de una herramienta en el Chrome de la persona,
// SÓLO MIRANDO, y anota de cada pantalla qué es y qué APIs llama al cargar.
//
//   node jarvis/dev/sweep.ts <app> <url de inicio> [--menu '<selector del menú>'] [--sections '<selector>']
//                              [--only texto] [--wait 6000] [--skip-frames regex] [--prefix <url>] [--out nombre] [--dry]
//
// `--prefix <url>`: sólo se visitan los enlaces que empiezan así. En Shopify es OBLIGATORIO en la práctica: el menú trae
// el selector de tiendas (también la de PRODUCCIÓN, `tienda-creditop`), «Crear tienda» y los avisos. Si el menú no
// tiene botones de sección (Shopify), la sección sale del primer tramo de la ruta después del prefijo (`orders`,
// `products`, `settings`…). `--out nombre` escribe `maps/<app>/<nombre>.json` en vez de `sections.json` (para un
// segundo menú, como el de Configuración).
//
// Abre una pestaña por Jarvis (el puente de Chrome, como el motor del harness), despliega cada sección del menú
// (`--sections`: lo que se clickea para desplegar), junta los enlaces del menú (`--menu`) y visita cada uno con un
// `goto`: nunca toca un botón ni un formulario de la pantalla. De cada una anota el título, los encabezados (también
// los de sus iframes), qué iframes usa y las llamadas a APIs que hizo al cargar (método y ruta, con los ids como `:n`,
// y la operación si es GraphQL), sin la analítica de terceros. Lo deja en `jarvis/maps/<app>/sections.json`.
//
// Lo que NO dice: qué hace cada botón ni qué escribe un formulario. Eso es el nivel 3 (un caso de uso, con su red).
// Necesita Jarvis conectado en Chrome y sin otra sesión manejándolo, y la sesión de la herramienta abierta en Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
// Los flags de antes del 2026-11-07 (--secciones, --solo, --espera, --sin-marco) siguen andando.
const flag = (name: string, def?: string, old?: string) => { for (const n of [name, old]) { const i = n ? argv.indexOf(`--${n}`) : -1; if (i >= 0) return argv[i + 1]; } return def; };
const [app, start] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!app || !start) {
    console.error("  uso: sweep.ts <app> <url de inicio> [--menu '<selector>'] [--sections '<selector>'] [--only texto] [--wait 6000] [--skip-frames regex]");
    process.exit(2);
}
const MENU = flag('menu', '[data-testid="sidebar"]')!;
const SECTIONS = flag('sections', '[data-testid^="sidebar-section-"]', 'secciones')!;
const ONLY = flag('only', undefined, 'solo');
// El prefijo es una CARPETA: `…/store/creditop-dev-store` no tiene que tomar `…/store/creditop-dev-store-plus`.
const PREFIX = flag('prefix')?.replace(/\/$/, '');
const inPrefix = (u: string) => !PREFIX || u === PREFIX || u.startsWith(PREFIX + '/') || u.startsWith(PREFIX + '?');
const DRY = argv.includes('--dry');
const OUT = flag('out', 'sections')!;
const WAIT = Number(flag('wait', '6000', 'espera'));
const SKIP_FRAMES = new RegExp(flag('skip-frames', 'copilot|vercel\\.app', 'sin-marco')!, 'i');

// La analítica, los mapas de fuentes y los recursos estáticos no dicen nada de la herramienta.
const NOISE = /google|doubleclick|hotjar|segment|sentry|datadog|newrelic|nr-data|clarity|facebook|intercom|amplitude|fullstory|launchdarkly|\/rc\.vtex|vtexassets|vteximg|\.(js|css|png|svg|jpg|woff2?|ico|map)(\?|$)/i;
const shape = (u: URL) => u.pathname
    .replace(/\/[0-9a-f]{40,}(?=\/|$)/gi, '/:hash') // Shopify: /api/operations/<hash>/<Operación>/…
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:n');

const status = await (await fetch('http://127.0.0.1:5203/api/chrome')).json();
if (!status.connected) { console.error('  ✗ Jarvis no está conectado en Chrome'); process.exit(2); }
if (status.driving) { console.error('  ✗ hay una sesión de Jarvis manejando Chrome: cerrala (bin/jarvis close)'); process.exit(2); }
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go');
const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()!;
const { chromium } = await import(path.join(cache, version, 'package', 'index.mjs'));

type Api = { method: string; host: string; path: string; operation?: string; n: number };
type Page = { section: string; name: string; url: string; title: string; iframes: string[]; headings: string[]; apis: Api[]; error?: string };

const browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp');
let page = await browser.contexts()[0].newPage();
const pages: Page[] = [];
try {
    await page.goto(start, { waitUntil: 'commit', timeout: 90_000 });
    await page.locator(MENU).first().waitFor({ timeout: 60_000 });

    // ── el menú: cada sección desplegada y sus enlaces ──
    const links: { section: string; name: string; url: string }[] = [];
    const sectionButtons = page.locator(SECTIONS);
    const count = await sectionButtons.count();
    for (let i = 0; i < count; i++) {
        const b = sectionButtons.nth(i);
        if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click().catch(() => {});
        await page.waitForTimeout(400);
    }
    // La sección de un enlace es la que lo PRECEDE en el menú: los enlaces de todas las secciones están en el DOM aunque
    // la sección esté cerrada, así que «lo que apareció al desplegar» no sirve (el primer barrido puso los 97 en la
    // primera sección).
    const found = await page.evaluate(([menu, sections]: string[]) => {
        const buttons = [...document.querySelectorAll(sections)];
        return [...document.querySelectorAll(`${menu} a[href]`)].map((a: any) => {
            let section = '';
            for (const b of buttons) if (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) section = (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
            return { section, name: a.innerText.replace(/\s+/g, ' ').trim(), url: a.href };
        });
    }, [MENU, SECTIONS]);
    for (const l of found) {
        if (!l.name || links.some((x) => x.url === l.url)) continue;
        if (!inPrefix(l.url)) continue;
        // Sin botones de sección: el primer tramo de la ruta después del prefijo.
        if (!l.section && PREFIX) l.section = l.url.slice(PREFIX.length).replace(/^\//, '').split(/[/?#]/)[0] || 'inicio';
        links.push(l);
    }
    const todo = links.filter((l) => /^https?:/.test(l.url) && (!ONLY || `${l.section} ${l.name}`.toLowerCase().includes(ONLY.toLowerCase())));
    console.log(`  menú: ${links.length} enlaces en ${count} secciones · visito ${todo.length}`);
    // --dry: lo que visitaría, sin visitar nada.
    if (DRY) { for (const l of todo) console.log(`    ${l.section} › ${l.name} → ${l.url}`); todo.length = 0; }

    // ── cada pantalla, sólo navegando ──
    for (const [i, l] of todo.entries()) {
        const apis = new Map<string, Api>();
        const onRequest = (r: any) => {
            const type = r.resourceType();
            if (type !== 'xhr' && type !== 'fetch') return;
            let u: URL;
            try { u = new URL(r.url()); } catch { return; }
            if (NOISE.test(u.href)) return;
            let operation: string | undefined;
            if (/graphql/i.test(u.pathname)) {
                const body = r.postData() || '';
                operation = /"operationName"\s*:\s*"([^"]+)"/.exec(body)?.[1] || /(?:query|mutation)\s+(\w+)/.exec(body)?.[1]
                    || u.searchParams.get('operationName') || undefined;
            }
            const key = `${r.method()} ${u.host}${shape(u)} ${operation ?? ''}`;
            const prev = apis.get(key);
            if (prev) prev.n++;
            else apis.set(key, { method: r.method(), host: u.host, path: shape(u), ...(operation ? { operation } : {}), n: 1 });
        };
        page.on('request', onRequest);
        const p: Page = { section: l.section, name: l.name, url: l.url, title: '', iframes: [], headings: [], apis: [] };
        // Una pantalla puede cerrar la pestaña (en VTEX, Marketplace › Orders la tiró y las 41 siguientes fallaron):
        // se abre otra y se sigue.
        if (page.isClosed()) { page = await browser.contexts()[0].newPage(); console.log('  (la pestaña se cerró: abro otra)'); }
        try {
            // Una app de una sola página puede redirigir sola (Shopify: «interrupted by another navigation»): se espera y
            // se reintenta una vez.
            await page.goto(l.url, { waitUntil: 'commit', timeout: 60_000 }).catch(async (e: Error) => {
                if (!/interrupted/i.test(e.message)) throw e;
                await page.waitForTimeout(3000);
                await page.goto(l.url, { waitUntil: 'commit', timeout: 60_000 });
            });
            await page.waitForTimeout(WAIT);
            p.title = await page.title().catch(() => '');
            for (const f of page.frames()) {
                // Los marcos que no son de la herramienta (en VTEX, el chat de Copilot) aparecen en todas las pantallas.
                if (SKIP_FRAMES.test(f.url())) continue;
                if (f !== page.mainFrame() && f.url() && !/^about:/.test(f.url())) p.iframes.push(new URL(f.url()).host + new URL(f.url()).pathname.slice(0, 60));
                // Sin los del menú (sus títulos de grupo, «Prices», «Inventory», aparecían en todas las pantallas).
                // También dentro del Shadow DOM (Shopify arma su admin con web components: sin esto, cero encabezados).
                const hs = await f.evaluate((menu: string) => {
                    const out: Element[] = [];
                    const walk = (root: Document | ShadowRoot) => {
                        out.push(...root.querySelectorAll('h1, h2, h3'));
                        for (const el of root.querySelectorAll('*')) if ((el as any).shadowRoot) walk((el as any).shadowRoot);
                    };
                    walk(document);
                    return out.filter((h) => !h.closest(menu)).map((h) => (h as HTMLElement).innerText);
                }, MENU).catch(() => [] as string[]);
                for (const h of hs) { const t = h.replace(/\s+/g, ' ').trim(); if (t && !p.headings.includes(t) && p.headings.length < 40) p.headings.push(t.slice(0, 80)); }
            }
        } catch (e) {
            p.error = String((e as Error).message).split('\n')[0];
        }
        page.off('request', onRequest);
        p.apis = [...apis.values()].sort((a, b) => a.host.localeCompare(b.host) || a.path.localeCompare(b.path));
        pages.push(p);
        console.log(`  ${String(i + 1).padStart(2)}/${todo.length} ${l.section ? l.section + ' › ' : ''}${l.name} · ${p.apis.length} API · ${p.headings.slice(0, 2).join(' | ')}${p.error ? ' · ✗ ' + p.error : ''}`);
    }
} finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
}

// Las APIs que llama el armazón de la herramienta (en VTEX, la barra lateral y la sesión) aparecen en casi todas las
// pantallas y no dicen nada de ninguna: van una vez, aparte, y cada pantalla queda con lo suyo.
const keyOf = (a: Api) => `${a.method} ${a.host}${a.path} ${a.operation ?? ''}`;
// La vara se mide sobre las pantallas que cargaron, y es baja (un tercio) porque el admin tiene varios armazones (el
// nuevo y el viejo en iframe) y cada uno aparece sólo en sus pantallas.
const loaded = pages.filter((p) => !p.error && p.apis.length);
const bar = Math.max(3, loaded.length / 3);
const freq = new Map<string, number>();
for (const p of loaded) for (const a of p.apis) freq.set(keyOf(a), (freq.get(keyOf(a)) ?? 0) + 1);
const shell = new Set([...freq].filter(([, n]) => n >= bar).map(([k]) => k));
const shellApis = [...shell].sort();
// Y lo que pide la propia herramienta a sus rutas de pantalla (en VTEX, `GET /admin/<hermana>`: precarga las pantallas
// de la sección abierta) es navegación, no API.
const startHost = new URL(start).host;
const isNavigation = (a: Api) => a.host === startHost && /^\/admin(\/|$)/.test(a.path);
for (const p of pages) p.apis = p.apis.filter((a) => !shell.has(keyOf(a)) && !isNavigation(a));
// Lo mismo con los encabezados: los que se repiten en muchas pantallas son de un armazón (en VTEX, el menú oculto
// del admin viejo, «Products | License Manager | Catalog»).
const hfreq = new Map<string, number>();
for (const p of loaded) for (const h of p.headings) hfreq.set(h, (hfreq.get(h) ?? 0) + 1);
for (const p of pages) p.headings = p.headings.filter((h) => (hfreq.get(h) ?? 0) < 5).slice(0, 15);

const file = path.join(ROOT, 'jarvis', 'maps', app, `${OUT.replace(/[^\w-]/g, '')}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ app, start, swept: new Date().toISOString().slice(0, 10), shell: shellApis, screens: pages }, null, 2) + '\n');
console.log(`  → ${path.relative(ROOT, file)}`);

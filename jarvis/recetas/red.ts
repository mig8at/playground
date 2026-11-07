// Lo que comparten las recetas por pantalla: conectarse al Chrome de la persona por Jarvis y GRABAR lo que la
// herramienta escribe mientras tanto (nivel 3 de jarvis/GUIA.md: del paso a paso manual sale la API).
//
//   const { browser, page } = await openChrome();
//   const rec = recordWrites(page);           // desde acá, cada llamada que escribe queda anotada
//   …los pasos por pantalla…
//   saveCase('vtex', 'coleccion', { …lo que el caso quiera dejar…, red: rec.calls });
//
// Graba las llamadas que ESCRIBEN: todo lo que no es GET/HEAD/OPTIONS, y las mutaciones de GraphQL aunque vayan por
// GET (en VTEX, toda operación dentro de un paso). Por cada una: método, URL, cuerpo enviado, status y el principio de la respuesta. Sin la analítica ni el
// monitoreo. Las cabeceras no se guardan (llevan la sesión de la persona).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Una pestaña nueva en el Chrome de la persona (grupo «Jarvis»), con el Playwright que trae Jarvis. */
export async function openChrome() {
    const status = await (await fetch('http://127.0.0.1:5203/api/chrome')).json();
    if (!status.connected) throw new Error('Jarvis no está conectado en Chrome');
    if (status.driving) throw new Error('hay una sesión de Jarvis manejando Chrome: cerrala (bin/jarvis close)');
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go');
    const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()!;
    const { chromium } = await import(path.join(cache, version, 'package', 'index.mjs'));
    const browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp');
    const page = await browser.contexts()[0].newPage();
    const close = async () => { await page.close().catch(() => {}); await browser.close().catch(() => {}); };
    return { browser, page, close };
}

export type Call = { paso: string; metodo: string; url: string; operacion?: string; cuerpo?: unknown; status?: number; respuesta?: unknown };

const NOISE = /monitoring|insights|logger|analytics|sentry|datadog|google|hotjar|clarity|\/api\/sessions|featurehub|feature-flag|messenger|\/rec\/page|\/admin(\/[\w-]+)*\/?(\?|$)/i;

/** Graba las escrituras de la página (también las de sus iframes). `rec.step('…')` rotula las que vienen. */
export function recordWrites(page: any) {
    const calls: Call[] = [];
    let current = '';
    const parse = (s: string | null) => { if (!s) return undefined; try { return JSON.parse(s); } catch { return s.slice(0, 2000); } };
    page.on('request', (r: any) => {
        const type = r.resourceType();
        if (type !== 'xhr' && type !== 'fetch') return;
        const url = r.url();
        if (NOISE.test(url)) return;
        const body = r.postData();
        const operacion = /graphql/i.test(url) ? (/"operationName"\s*:\s*"([^"]+)"/.exec(body || '')?.[1] || new URL(url).searchParams.get('operationName') || undefined) : undefined;
        const isGraphql = /graphql/i.test(url);
        // GraphQL: VTEX manda «persisted queries» (sólo el nombre y un hash, sin el texto `mutation`), así que no se
        // sabe por el cuerpo si escribe. Se anota toda operación que pase DENTRO de un paso, y la lectura de cada una
        // se distingue después por su nombre (getX, listX…) y su respuesta.
        if (isGraphql && !current) return;
        if (!isGraphql && /^(GET|HEAD|OPTIONS)$/.test(r.method())) return;
        const cuerpo: any = parse(body);
        // VTEX manda las variables de una persisted query en base64 (`extensions.variables`): se guardan legibles.
        const b64 = cuerpo?.extensions?.variables;
        if (typeof b64 === 'string') { try { cuerpo.variables = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); delete cuerpo.extensions.variables; } catch { /* queda como vino */ } }
        const call: Call = { paso: current, metodo: r.method(), url: url.replace(/\?.*$/, ''), ...(operacion ? { operacion } : {}), cuerpo };
        calls.push(call);
        r.response().then(async (res: any) => {
            if (!res) return;
            call.status = res.status();
            call.respuesta = parse(((await res.text().catch(() => '')) || '').slice(0, 4000));
        }).catch(() => {});
    });
    return { calls, step: (name: string) => { current = name; } };
}

/** Deja el caso en `jarvis/mapas/<app>/casos/<caso>.json`: es la fuente de la receta por API. */
export function saveCase(app: string, caso: string, data: Record<string, unknown>) {
    const file = path.join(ROOT, 'jarvis', 'mapas', app, 'casos', `${caso}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ caso, grabado: new Date().toISOString().slice(0, 10), ...data }, null, 2) + '\n');
    return path.relative(ROOT, file);
}

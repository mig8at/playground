// Lo que comparten las recetas por pantalla: conectarse al Chrome de la persona por Jarvis y GRABAR lo que la
// herramienta escribe mientras tanto (nivel 3 de jarvis/GUIDE.md: del paso a paso manual sale la API).
//
//   const { browser, page } = await openChrome();
//   const rec = recordWrites(page);           // desde acá, cada llamada que escribe queda anotada
//   …los pasos por pantalla…
//   saveCase('vtex', 'collection', { …lo que el caso quiera dejar…, network: rec.calls });
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

export type Call = { step: string; method: string; url: string; operation?: string; body?: unknown; status?: number; response?: unknown };

// Lo que no es de la herramienta: analítica (Amplitude, …), el chat de Copilot y su barra (`TopbarData` trae el
// perfil de la persona: nombre y correo), el monitoreo, la sesión y las precargas de pantallas del admin.
const NOISE = /monitoring|insights|logger|analytics|amplitude|sentry|datadog|google|hotjar|clarity|copilot|vercel\.app|\/api\/sessions|featurehub|feature-flag|messenger|\/2\/httpapi|\/rec\/page|\/admin(\/[\w-]+)*\/?(\?|$)/i;
const NOISE_OPS = /^(TopbarData|topbarData|TopBarData|myself|LoggedUser|CurrentAdminUser|GetUserProfile|MyInfo)$/;

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
        const operation = /graphql/i.test(url) ? (/"operationName"\s*:\s*"([^"]+)"/.exec(body || '')?.[1] || new URL(url).searchParams.get('operationName') || undefined) : undefined;
        const isGraphql = /graphql/i.test(url);
        // GraphQL: VTEX manda «persisted queries» (sólo el nombre y un hash, sin el texto `mutation`), así que no se
        // sabe por el cuerpo si escribe. Se anota toda operación que pase DENTRO de un paso, y la lectura de cada una
        // se distingue después por su nombre (getX, listX…) y su respuesta.
        if (isGraphql && !current) return;
        if (operation && NOISE_OPS.test(operation)) return;
        if (!isGraphql && /^(GET|HEAD|OPTIONS)$/.test(r.method())) return;
        const sent: any = parse(body);
        // VTEX manda las variables de una persisted query en base64 (`extensions.variables`): se guardan legibles.
        const b64 = sent?.extensions?.variables;
        if (typeof b64 === 'string') { try { sent.variables = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); delete sent.extensions.variables; } catch { /* queda como vino */ } }
        const call: Call = { step: current, method: r.method(), url: url.replace(/\?.*$/, ''), ...(operation ? { operation } : {}), body: sent };
        calls.push(call);
        r.response().then(async (res: any) => {
            if (!res) return;
            call.status = res.status();
            call.response = parse(((await res.text().catch(() => '')) || '').slice(0, 4000));
        }).catch(() => {});
    });
    return { calls, step: (name: string) => { current = name; } };
}

/** Deja el caso en `jarvis/maps/<app>/cases/<caso>.json`: es la fuente de la receta por API. */
export function saveCase(app: string, name: string, data: Record<string, unknown>) {
    const file = path.join(ROOT, 'jarvis', 'maps', app, 'cases', `${name}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Un correo que se cuele en una respuesta (el perfil de quien graba) no queda en el archivo.
    const text = JSON.stringify({ case: name, recorded: new Date().toISOString().slice(0, 10), ...data }, null, 2).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<correo>');
    fs.writeFileSync(file, text + '\n');
    return path.relative(ROOT, file);
}

/**
 * El camino rápido cuando la herramienta NO tiene API con llave (en VTEX, los sinónimos del buscador): repetir la
 * llamada que hizo el admin, con su sesión, desde una pestaña ya abierta en la herramienta. La operación (nombre,
 * hash y quién la manda) se lee de la GRABACIÓN del caso: si la herramienta la cambia, se vuelve a grabar.
 */
export function recordedOperation(app: string, name: string, operation: string) {
    const file = path.join(ROOT, 'jarvis', 'maps', app, 'cases', `${name}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const call = (data.network as Call[]).find((c) => c.operation === operation);
    if (!call) throw new Error(`la grabación ${path.relative(ROOT, file)} no tiene «${operation}»: volvé a grabar el caso por pantalla`);
    return { url: call.url, persistedQuery: (call.body as any).extensions.persistedQuery };
}

/** Manda una persisted query de GraphQL con la sesión de la pestaña (variables en base64, como el admin). */
export async function graphqlInPage(page: any, op: { url: string; persistedQuery: unknown }, operationName: string, variables: unknown) {
    return page.evaluate(async ({ url, persistedQuery, operationName, variables }: any) => {
        const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(variables))));
        const res = await fetch(url, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operationName, variables: {}, extensions: { persistedQuery, variables: b64 } }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    }, { url: op.url, persistedQuery: op.persistedQuery, operationName, variables });
}

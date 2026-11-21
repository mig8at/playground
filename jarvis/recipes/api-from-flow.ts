// DE FLUJO A RECETA POR API. Un flujo es el registro de lo que se hizo un día por PANTALLA; su corrida guardó además la
// RED (jarvis/server/devlog.go: .data/runs/<id>/devlog.json, con el cuerpo de cada pedido que escribe y las
// credenciales tapadas). Esto junta las dos cosas: a cada paso le asigna los pedidos que disparó y escribe una receta
// que repite ESOS pedidos con tu sesión, sin clics, con los datos del flujo como parámetros.
//
//   make jarvis-recipe-api FLOW=jarvis/flows/<sitio>/<id>.json APP=<herramienta> NAME=<receta> [FORCE=1] [VERIFY=1]
//
// ENCADENA los pedidos (2026-11-20): un id que devolvió un pedido y que otro usa después (en su URL o en su cuerpo:
// crear un producto → crearle el SKU con su id → publicarlo por su id) no queda fijo con el valor de aquel día: la
// receta lo toma de la respuesta de ESTA corrida. Para eso la red guarda también lo que devolvió cada pedido que
// escribe (devlog.go). Se encadenan sólo los campos con nombre de id (id, productId, product_id, uuid, sku…): un número
// suelto igual por casualidad (un stock de 4 y un id 4) no se toma por id. Cada corrida de la receta comprueba además
// que cada respuesta siga trayendo los campos que traía (su forma) y lo avisa si cambió.
//
// VERIFY=1 la corre una vez al generarla (ESCRIBE en la herramienta: un producto de prueba, con los datos del flujo) y
// la da por buena sólo si cada pedido dio lo mismo que en la grabación (2xx o error) con la misma forma; lo anota en la
// cabecera («Verificada …» o «⚠ La verificación falló …»).
//
// La receta abre una pestaña en el sitio (para tener tu sesión: sus cookies) y hace cada pedido desde ahí, con fetch.
// Un valor del cuerpo igual al dato de un paso del flujo pasa a ser `--<dato>` (con el del flujo por defecto). Lo que
// no se puede generalizar se dice en la cabecera: un id de esa corrida en la URL, un campo que estaba tapado (•••,
// una credencial: la receta no la tiene y el pedido puede fallar). Lo que escribe va en «ESCRIBE»: no se corre a ciegas.
//
// Cuándo sirve: cuando la herramienta hace lo que importa por su API (un admin moderno). Si el flujo no hizo pedidos
// que escriben (todo vivía en el navegador, como la demo de tareas), lo dice y no escribe nada: ahí va la receta por
// pantalla (make jarvis-recipe-from).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeOfFlow } from './same-recipe.ts';
import { NOISE } from './recorder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const flowPath = flag('flow');
const app = flag('app');
let name = flag('name');
const force = argv.includes('--force');
const asNew = argv.includes('--new');
const verify = argv.includes('--verify');
// Una receta por flujo (same-recipe.ts): si ya hay una de este flujo, se actualiza ésa (--new: otra aparte).
const sameRecipe = flowPath && app ? recipeOfFlow(ROOT, app, path.relative(ROOT, path.resolve(ROOT, flowPath)), 'api') : undefined;
let updating = false;
if (sameRecipe && !asNew) {
    if (name && name !== sameRecipe) console.log(`  ya hay una receta de este flujo, ${app}/${sameRecipe}: actualizo ésa en vez de crear ${name} (otra aparte: --new)`);
    name = sameRecipe;
    updating = true;
}
if (!name && flowPath) name = path.basename(flowPath, '.json');
if (!flowPath || !app || !name || !/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+$/.test(app)) {
    console.error('  uso: api-from-flow --flow jarvis/flows/<sitio>/<id>.json --app <herramienta> --name [<receta-en-kebab>] [--force] [--new]');
    process.exit(2);
}

type FlowStep = { action: string; target?: string; value?: string; param?: string; code?: string };
type Flow = { name: string; meta?: string; start?: string; run?: string; steps: FlowStep[] };
type RunStep = { at: string; target?: string; code?: string; before?: string };
type Net = { at: string; method: string; url: string; type: string; status?: number; failed?: string; body?: string; contentType?: string; response?: string; responseType?: string };

const flowFile = path.resolve(ROOT, flowPath);
const flow = JSON.parse(fs.readFileSync(flowFile, 'utf8')) as Flow;
const site = path.basename(path.dirname(flowFile));
if (!flow.run) fail(`el flujo no dice de qué corrida salió (campo «run»): no hay red que mirar`);
const runDir = path.join(ROOT, 'jarvis/.data/runs', flow.run!);
const devlog = path.join(runDir, 'devlog.json');
if (!fs.existsSync(devlog)) fail(`la corrida ${flow.run} no guardó su red (devlog.json: las corridas desde el 2026-11-20). Grabá el flujo de nuevo`);
const runSteps = (JSON.parse(fs.readFileSync(path.join(runDir, 'steps.json'), 'utf8')).steps || []) as RunStep[];
const net = (JSON.parse(fs.readFileSync(devlog, 'utf8')).network || []) as Net[];

// El origen del sitio: el de la entrada del flujo; una app de práctica guarda la entrada relativa y su puerto en app.json.
function origin(): string {
    if (flow.start && /^https?:/.test(flow.start)) return new URL(flow.start).origin;
    const appJson = path.join(ROOT, 'jarvis/apps', site, 'app.json');
    if (fs.existsSync(appJson)) return `http://localhost:${JSON.parse(fs.readFileSync(appJson, 'utf8')).port}`;
    for (const n of net) if (n.type === 'document') return new URL(n.url).origin;
    fail('no se sabe en qué sitio corre el flujo');
    return '';
}
const ORIGIN = origin();
// Dónde se para la receta para tener tu sesión: la ruta de la entrada SIN lo que va después del «?». La entrada de un
// flujo suele traer acciones en la URL (el «?reset» de las apps de práctica vacía todo al cargar): abrirla tal cual
// haría eso en cada corrida. Para las cookies alcanza con estar en el sitio.
const startURL = (() => { const u = new URL(flow.start || '/', ORIGIN); return u.origin + u.pathname; })();

// Cuándo empezó el primer paso: la foto «antes» (NN-antes.png) se saca justo antes de actuar. Lo que la página escribió
// ANTES de eso fue al cargar la entrada (un «?reset» que vacía, una precarga), no un paso: no se repite. Sin esa foto,
// el primer paso cuenta desde que empezó la corrida.
const firstStart = (() => {
    const b = runSteps.find((s) => s.before)?.before;
    if (b && fs.existsSync(path.join(runDir, b))) return fs.statSync(path.join(runDir, b)).mtimeMs - 200; // se guarda justo antes de actuar
    return 0;
})();
const skipped: string[] = [];
// Los pedidos que ESCRIBEN y son de la herramienta (fetch/xhr, sin analítica ni monitoreo), en orden.
const writes = net.filter((n) => (n.type === 'fetch' || n.type === 'xhr') && !/^(GET|HEAD|OPTIONS)$/.test(n.method) && !NOISE.test(n.url))
    .filter((n) => {
        if (Date.parse(n.at) >= firstStart) return true;
        skipped.push(`${n.method} ${new URL(n.url).pathname} (al cargar la página de entrada, antes del primer paso)`);
        return false;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
if (!writes.length) {
    console.error(`  ✗ la corrida ${flow.run} no hizo pedidos que escriban (fetch/xhr): este flujo guarda en el navegador o sólo navega.`);
    console.error(`    Para repetirlo, la receta por pantalla: make jarvis-recipe-from FLOW=${flowPath} APP=${app} NAME=${name}`);
    process.exit(1);
}

// Cada pedido es del paso que estaba en curso: el primero que se anotó DESPUÉS de que el pedido salió (un paso se anota
// al terminar su acción).
const stepOf = (n: Net) => {
    const t = Date.parse(n.at);
    const i = runSteps.findIndex((s) => Date.parse(s.at) >= t);
    return i >= 0 ? runSteps[i] : runSteps[runSteps.length - 1];
};
const stepLabel = (s?: RunStep) => (s?.target || /\.(\w+)\(/.exec(s?.code || '')?.[1] || 'un paso').replace(/\s+/g, ' ').trim();

// Los parámetros: los datos del flujo (lo que escribió o eligió), con su valor como por defecto.
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'valor';
// El nombre de la opción: el del campo en la API cuando el dato aparece en un cuerpo (`name`, `price`: en inglés, como
// todas las opciones de las recetas, y dice qué manda); si no, el rótulo de la pantalla pasado por la traducción de
// args.ts (que convierte --nombre en --name al entrar: una opción en castellano no llegaba nunca a la receta).
const LEGACY: Record<string, string> = { nombre: 'name', precio: 'price', categoria: 'category', marca: 'brand', descripcion: 'description', producto: 'product', codigo: 'code', descuento: 'discount' };
const params: { flag: string; def: string; label: string; used: boolean }[] = [];
for (const s of flow.steps) {
    if (!s.param || s.value === undefined) continue;
    params.push({ flag: '', def: s.value, label: s.param, used: false });
}
const flagFor = (p: (typeof params)[number], apiKey: string) => {
    if (p.flag) return p.flag;
    let f = slug(apiKey) || LEGACY[slug(p.label)] || slug(p.label);
    while (params.some((x) => x !== p && x.flag === f)) f += '-2';
    p.flag = f;
    return f;
};
const paramFor = (v: unknown) => params.find((p) => (typeof v === 'string' && v === p.def) || (typeof v === 'number' && String(v) === p.def.trim()));

const warnings: string[] = [];
// Un valor del cuerpo como código TS: el que coincide con un dato del flujo pasa a ser su parámetro.
function literal(v: unknown, at: string): string {
    if (v === '•••') {
        warnings.push(`el campo «${at}» iba tapado (una credencial): la receta no lo tiene y el pedido puede fallar sin él`);
        return JSON.stringify(v);
    }
    const key = at.split('.').pop()!.replace(/\[\d+\]$/, '');
    if ((typeof v === 'number' || typeof v === 'string') && ID_KEY.test(key)) {
        const s = sourceFor(v, currentCall, key);
        if (s) {
            chained.push(`el campo «${at}» del pedido ${currentCall + 1} es «${s.path}» de lo que devolvió el pedido ${s.call + 1}`);
            return typeof v === 'string' ? `String(${refCode(s)})` : refCode(s);
        }
    }
    if (typeof v === 'string' && !paramFor(v)) {
        const t = inString(v, currentCall);
        if (t) { chained.push(`el campo «${at}» del pedido ${currentCall + 1} («${v}») lleva adentro un id devuelto antes`); return t; }
    }
    const p = paramFor(v);
    if (p) {
        p.used = true;
        const f = flagFor(p, at.split('.').pop()!.replace(/\[\d+\]$/, ''));
        return typeof v === 'number' ? `Number(arg(${JSON.stringify(f)}))` : `arg(${JSON.stringify(f)})`;
    }
    if (Array.isArray(v)) return `[${v.map((x, i) => literal(x, `${at}[${i}]`)).join(', ')}]`;
    if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${literal(x, at ? `${at}.${k}` : k)}`).join(', ')} }`;
    return JSON.stringify(v);
}

// ── encadenar: lo que devolvió un pedido y usa otro después ──
// Los campos con nombre de id de cada respuesta (con su camino: «id», «data.productId»), del pedido más nuevo al más
// viejo: un valor que aparece en un pedido posterior sale de ahí.
const ID_KEY = /^(id|uuid|guid|sku|slug|key)$|(^|[a-z0-9])(Id|ID|Uuid|Key|Sku)$|_(id|uuid|key|sku)$/;
type Src = { call: number; path: string; value: string | number };
const sources: Src[] = [];
const parsedResponse = (n: Net) => { try { return n.response ? JSON.parse(n.response) : undefined; } catch { return undefined; } };
function collectIds(v: unknown, at: string, call: number) {
    if (Array.isArray(v)) { v.slice(0, 1).forEach((x, i) => collectIds(x, `${at}.${i}`, call)); return; } // de una lista, el primero
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
        const p = at ? `${at}.${k}` : k;
        if ((typeof x === 'string' && x.length > 0 && x !== '•••') || typeof x === 'number') { if (ID_KEY.test(k)) sources.push({ call, path: p, value: x }); }
        else collectIds(x, p, call);
    }
}
// El origen del valor en un pedido anterior al número `before`. Dos respuestas pueden traer el mismo id (el producto 1
// y su SKU 1: cada colección cuenta desde 1), así que gana la que más se parece a dónde se usa: un pedido cuya ruta
// contiene a la del pedido actual (POST /api/products → PUT /api/products/1), o cuya ruta nombra al campo (productId →
// /api/products). A igual parecido, el más reciente.
const pathOf = (call: number) => new URL(writes[call].url).pathname.replace(/\/+$/, '');
const sourceFor = (v: unknown, before: number, key = '') => {
    const here = new URL(writes[before].url).pathname;
    const stem = key.replace(/(Id|ID|Uuid|Key|Sku)$|_(id|uuid|key|sku)$/, '').toLowerCase();
    let best: Src | undefined;
    let bestScore = -1;
    for (const s of sources) {
        if (s.call >= before || !(s.value === v || (typeof v === 'string' && String(s.value) === v))) continue;
        const p = pathOf(s.call);
        const score = (here.startsWith(p + '/') ? 2 : 0) + (stem && stem !== 'id' && p.toLowerCase().includes(stem) ? 1 : 0);
        if (score >= bestScore) { best = s; bestScore = score; }
    }
    return best;
};
const refCode = (s: Src) => `pick(r, ${s.call}, ${JSON.stringify(s.path)})`;
const chained: string[] = [];
let currentCall = 0;
// Un string con el id adentro («SKU-4»): se arma con el id de esta corrida, si el id es largo o va pegado a un separador.
function inString(v: string, before: number): string | undefined {
    for (let i = sources.length - 1; i >= 0; i--) {
        const s = sources[i];
        const id = String(s.value);
        if (s.call >= before || v === id) continue;
        const m = new RegExp(`(^|[^0-9A-Za-z])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z])`).exec(v);
        if (!m || (id.length < 3 && !/[-_#/:]$/.test(v.slice(0, m.index + m[1].length)))) continue;
        const k = v.indexOf(id, m.index);
        const esc = (t: string) => t.replace(/[`\\$]/g, (c) => '\\' + c);
        return '`' + esc(v.slice(0, k)) + '${' + refCode(s) + '}' + esc(v.slice(k + id.length)) + '`';
    }
    return undefined;
}

const calls: string[] = [];
const writesDesc: string[] = [];
writes.forEach((n, idx) => {
    currentCall = idx;
    const u = new URL(n.url);
    const where = u.origin === ORIGIN ? u.pathname + u.search : n.url;
    // La URL: cada tramo que es un id devuelto antes se arma con el de esta corrida.
    let urlCode = JSON.stringify(where);
    let fixedId = false;
    const segs = where.split(/(\/|\?|&|=)/);
    if (segs.some((seg) => /^\d+$|^[0-9a-f-]{8,}$/i.test(seg))) {
        const parts = segs.map((seg) => {
            const s = /^\d+$|^[0-9a-f-]{8,}$/i.test(seg) ? sourceFor(/^\d+$/.test(seg) ? Number(seg) : seg, idx) : undefined;
            if (s) { chained.push(`${n.method} ${where}: el ${seg} de la URL es «${s.path}» de lo que devolvió el pedido ${s.call + 1}`); return '${' + refCode(s) + '}'; }
            if (/^\d+$/.test(seg) || /^[0-9a-f-]{8,}$/i.test(seg)) fixedId = true;
            return seg.replace(/[`\\$]/g, (c) => '\\' + c);
        });
        if (parts.some((x) => x.startsWith('${'))) urlCode = '`' + parts.join('') + '`';
    }
    if (fixedId) warnings.push(`${n.method} ${where} lleva un id en la URL que no devolvió ningún pedido anterior (es el de aquella corrida): revisalo antes de correrla`);
    let body = 'undefined';
    if (n.body) {
        let parsed: unknown;
        try { parsed = JSON.parse(n.body); } catch { /* no es JSON */ }
        body = parsed !== undefined ? `JSON.stringify(${literal(parsed, '')})` : JSON.stringify(n.body);
    }
    const label = stepLabel(stepOf(n));
    writesDesc.push(`${n.method} ${where} (paso «${label}»)`);
    const resp = parsedResponse(n);
    const shape = resp && typeof resp === 'object' && !Array.isArray(resp) ? Object.keys(resp) : [];
    calls.push(`    { step: ${JSON.stringify(label)}, method: ${JSON.stringify(n.method)}, url: (r: any[]) => ${urlCode}, contentType: ${JSON.stringify(n.contentType || '')}, body: (r: any[]) => ${body}, recorded: ${n.failed ? JSON.stringify('falló: ' + n.failed) : n.status ?? 0}, shape: ${JSON.stringify(shape)} },`);
    collectIds(resp, '', idx); // lo que devolvió queda disponible para los pedidos siguientes
});
const used = params.filter((p) => p.used);
const unused = params.filter((p) => !p.used);
if (unused.length) warnings.push(`datos del flujo que no aparecen en ningún pedido (quedan fuera de la receta): ${unused.map((p) => p.label).join(', ')}`);

const out = path.join(ROOT, 'jarvis/recipes', app, `${name}.ts`);
if (fs.existsSync(out) && !force && !updating) fail(`ya existe ${path.relative(ROOT, out)} (--force lo pisa)`);
const usage = `make jarvis-recipe APP=${app} RECIPE=${name}` + (used.length ? ` ARGS='${used.map((p) => `--${p.flag} ${JSON.stringify(p.def)}`).join(' ')}'` : '');
const header = [
    `// RECETA CON TU SESIÓN · ${flow.name}. Repite por la API los pedidos que hizo la página en el flujo, sin clics.`,
    `// (Salió de ${path.relative(ROOT, flowFile)} y de la red de su corrida ${flow.run}: make jarvis-recipe-api. Pulí la explicación.)`,
    '//',
    `//   ${usage}`,
    '//',
    `// ${(flow.meta || flow.name).replace(/\s+/g, ' ')}`,
    '//',
    used.length ? `// Parámetros: ${used.map((p) => `--${p.flag} (${p.label}; por defecto ${JSON.stringify(p.def)})`).join(' · ')} · --json` : '// Parámetros: --json',
    `// Necesita: Jarvis conectado en Chrome y la sesión de ${ORIGIN} abierta en Chrome (los pedidos van con sus cookies).`,
    `// ESCRIBE: ${writesDesc.join(' · ')}`,
    ...chained.map((w) => `// Encadena: ${w}`),
    ...warnings.map((w) => `// ⚠ ${w}`),
    ...skipped.map((w) => `// No se repite: ${w}`),
].join('\n');

const body = `${header}
import '../args.ts';
import { openChrome } from '../recorder.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(\`  \${s}\`); };
const DEFAULTS: Record<string, string> = ${JSON.stringify(Object.fromEntries(used.map((p) => [p.flag, p.def])), null, 4)};
const arg = (n: string) => { const i = argv.indexOf(\`--\${n}\`); return i >= 0 ? argv[i + 1] : DEFAULTS[n]; };

// Los pedidos, en el orden en que los hizo la página. url y body reciben r, lo que devolvió cada pedido anterior
// (encadenados: pick). recorded: el estado que dieron aquella vez; shape: los campos que traía su respuesta.
const CALLS = [
${calls.join('\n')}
];

// pick(r, n, 'data.id'): un campo de lo que devolvió el pedido n de esta corrida; si no está, la receta no puede seguir.
function pick(r: any[], n: number, at: string) {
    let v = r[n];
    for (const k of at.split('.')) v = v == null ? undefined : v[k];
    if (v === undefined || v === null) throw new Error(\`el pedido \${n + 1} no devolvió «\${at}»: no se puede encadenar el siguiente (¿cambió su respuesta?)\`);
    return v;
}

const { page, close } = await openChrome();
const r: any[] = [];
const changed: string[] = [];
const results: { step: string; method: string; url: string; status: number; recorded: number | string; keys: string[] }[] = [];
try {
    say(${JSON.stringify(`Abro ${startURL} para usar tu sesión`)});
    await page.goto(${JSON.stringify(startURL)}, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    for (const c of CALLS) {
        const url = c.url(r);
        const res = await page.evaluate(async ({ url, method, contentType, body }) => {
            const res = await fetch(url, { method, credentials: 'include', headers: contentType ? { 'content-type': contentType } : {}, body });
            return { status: res.status, text: await res.text() };
        }, { url, method: c.method, contentType: c.contentType, body: c.body(r) });
        let json: any;
        try { json = JSON.parse(res.text); } catch { /* no es JSON */ }
        r.push(json);
        const keys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json) : [];
        results.push({ step: c.step, method: c.method, url, status: res.status, recorded: c.recorded, keys });
        say(\`\${res.status < 400 ? '✓' : '✗'} \${c.method} \${url} → \${res.status} (paso «\${c.step}»)\`);
        if (res.status >= 400) throw new Error(\`\${c.method} \${url} dio \${res.status}: \${res.text.slice(0, 500)}\`);
        // ¿Devolvió lo mismo que en la grabación? Un campo que ya no viene es lo primero que rompe un encadenado.
        const missing = c.shape.filter((k) => !keys.includes(k));
        if (typeof c.recorded === 'number' && c.recorded >= 400) changed.push(\`\${c.method} \${url} dio \${res.status}; en la grabación, \${c.recorded}\`);
        if (missing.length) changed.push(\`\${c.method} \${url} ya no devuelve: \${missing.join(', ')}\`);
    }
    for (const w of changed) say(\`⚠ distinto de la grabación: \${w}\`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: ${JSON.stringify(`${app}/${name}`)}, results, changed }));
    else say('listo');
    if (changed.length) process.exitCode = 3;
} finally {
    await close();
}
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`  ✓ ${path.relative(ROOT, out)} (${writes.length} pedido(s), ${used.length} parámetro(s))${updating ? ' · actualicé la receta de este flujo (lo que habías pulido: git diff)' : ''}`);
for (const w of writesDesc) console.log(`    ESCRIBE ${w}`);
for (const w of warnings) console.log(`    ⚠ ${w}`);
for (const w of skipped) console.log(`    no se repite: ${w}`);
for (const w of chained) console.log(`    encadena: ${w}`);
if (!verify) console.log(`  probala: ${usage}   (o VERIFY=1 al generarla: la corre una vez y la compara con la grabación)`);
else verifyRecipe();

// verifyRecipe corre la receta recién escrita con los datos del flujo y la da por buena si cada pedido dio lo mismo
// que en la grabación (2xx, con los mismos campos en su respuesta). El resultado queda en su cabecera.
function verifyRecipe() {
    console.log(`  verifico: la corro una vez (ESCRIBE en ${ORIGIN}, con los datos del flujo)…`);
    const run = spawnSync('node', [out, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
    const lines = (run.stdout || '').trim().split('\n');
    let res: { results?: { method: string; url: string; status: number }[]; changed?: string[] } = {};
    try { res = JSON.parse(lines[lines.length - 1]); } catch { /* falló antes de terminar */ }
    const day = new Date().toISOString().slice(0, 10);
    let note: string;
    if (run.status === 0 && res.results?.length === writes.length) {
        note = `// Verificada: ${day} contra ${ORIGIN}: ${res.results.map((x) => `${x.method} ${x.url} → ${x.status}`).join(' · ')}; mismos estados y campos que la grabación.`;
        console.log(`  ✓ verificada: ${res.results.length} pedido(s) como en la grabación`);
    } else {
        const why = res.changed?.length ? res.changed.join('; ') : ((run.stderr || '').trim().split('\n').filter(Boolean).pop() || `salió con ${run.status}`);
        note = `// ⚠ La verificación falló (${day}): ${why.replace(/\s+/g, ' ').slice(0, 300)}`;
        console.log(`  ✗ la verificación falló: ${why}`);
        process.exitCode = 1;
    }
    const src = fs.readFileSync(out, 'utf8');
    fs.writeFileSync(out, src.replace("\nimport '../args.ts';", `\n${note}\nimport '../args.ts';`));
}

function fail(msg: string): never {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
}

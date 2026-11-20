// DE FLUJO A RECETA POR API. Un flujo es el registro de lo que se hizo un día por PANTALLA; su corrida guardó además la
// RED (jarvis/server/devlog.go: .data/runs/<id>/devlog.json, con el cuerpo de cada pedido que escribe y las
// credenciales tapadas). Esto junta las dos cosas: a cada paso le asigna los pedidos que disparó y escribe una receta
// que repite ESOS pedidos con tu sesión, sin clics, con los datos del flujo como parámetros.
//
//   make jarvis-recipe-api FLOW=jarvis/flows/<sitio>/<id>.json APP=<herramienta> NAME=<receta> [FORCE=1]
//
// La receta abre una pestaña en el sitio (para tener tu sesión: sus cookies) y hace cada pedido desde ahí, con fetch.
// Un valor del cuerpo igual al dato de un paso del flujo pasa a ser `--<dato>` (con el del flujo por defecto). Lo que
// no se puede generalizar se dice en la cabecera: un id de esa corrida en la URL, un campo que estaba tapado (•••,
// una credencial: la receta no la tiene y el pedido puede fallar). Lo que escribe va en «ESCRIBE»: no se corre a ciegas.
//
// Cuándo sirve: cuando la herramienta hace lo que importa por su API (un admin moderno). Si el flujo no hizo pedidos
// que escriben (todo vivía en el navegador, como la demo de tareas), lo dice y no escribe nada: ahí va la receta por
// pantalla (make jarvis-recipe-from).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOISE } from './recorder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const flowPath = flag('flow');
const app = flag('app');
const name = flag('name');
const force = argv.includes('--force');
if (!flowPath || !app || !name || !/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+$/.test(app)) {
    console.error('  uso: api-from-flow --flow jarvis/flows/<sitio>/<id>.json --app <herramienta> --name <receta-en-kebab> [--force]');
    process.exit(2);
}

type FlowStep = { action: string; target?: string; value?: string; param?: string; code?: string };
type Flow = { name: string; meta?: string; start?: string; run?: string; steps: FlowStep[] };
type RunStep = { at: string; target?: string; code?: string; before?: string };
type Net = { at: string; method: string; url: string; type: string; status?: number; failed?: string; body?: string; contentType?: string };

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

const calls: string[] = [];
const writesDesc: string[] = [];
for (const n of writes) {
    const u = new URL(n.url);
    const where = u.origin === ORIGIN ? u.pathname + u.search : n.url;
    if (/\/\d+(\/|$|\?)/.test(u.pathname)) warnings.push(`${n.method} ${where} lleva un id de aquella corrida en la URL: revisalo antes de correrla`);
    let body = 'undefined';
    if (n.body) {
        let parsed: unknown;
        try { parsed = JSON.parse(n.body); } catch { /* no es JSON */ }
        body = parsed !== undefined ? `JSON.stringify(${literal(parsed, '')})` : JSON.stringify(n.body);
    }
    const label = stepLabel(stepOf(n));
    writesDesc.push(`${n.method} ${where} (paso «${label}»)`);
    calls.push(`    { step: ${JSON.stringify(label)}, method: ${JSON.stringify(n.method)}, url: ${JSON.stringify(where)}, contentType: ${JSON.stringify(n.contentType || '')}, body: ${body}, recorded: ${n.failed ? JSON.stringify('falló: ' + n.failed) : n.status ?? 0} },`);
}
const used = params.filter((p) => p.used);
const unused = params.filter((p) => !p.used);
if (unused.length) warnings.push(`datos del flujo que no aparecen en ningún pedido (quedan fuera de la receta): ${unused.map((p) => p.label).join(', ')}`);

const out = path.join(ROOT, 'jarvis/recipes', app, `${name}.ts`);
if (fs.existsSync(out) && !force) fail(`ya existe ${path.relative(ROOT, out)} (--force lo pisa)`);
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

// Los pedidos, en el orden en que los hizo la página (recorded: el estado que dieron aquella vez).
const CALLS = [
${calls.join('\n')}
];

const { page, close } = await openChrome();
const results: { step: string; method: string; url: string; status: number; response: string }[] = [];
try {
    say(${JSON.stringify(`Abro ${startURL} para usar tu sesión`)});
    await page.goto(${JSON.stringify(startURL)}, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    for (const c of CALLS) {
        const r = await page.evaluate(async ({ url, method, contentType, body }) => {
            const res = await fetch(url, { method, credentials: 'include', headers: contentType ? { 'content-type': contentType } : {}, body });
            return { status: res.status, response: (await res.text()).slice(0, 500) };
        }, c);
        results.push({ step: c.step, method: c.method, url: c.url, ...r });
        say(\`\${r.status < 400 ? '✓' : '✗'} \${c.method} \${c.url} → \${r.status} (paso «\${c.step}»)\`);
        if (r.status >= 400) throw new Error(\`\${c.method} \${c.url} dio \${r.status}: \${r.response}\`);
    }
    if (JSON_OUT) console.log(JSON.stringify({ recipe: ${JSON.stringify(`${app}/${name}`)}, results }));
    else say('listo');
} finally {
    await close();
}
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`  ✓ ${path.relative(ROOT, out)} (${writes.length} pedido(s), ${used.length} parámetro(s))`);
for (const w of writesDesc) console.log(`    ESCRIBE ${w}`);
for (const w of warnings) console.log(`    ⚠ ${w}`);
for (const w of skipped) console.log(`    no se repite: ${w}`);
console.log(`  probala: ${usage}`);

function fail(msg: string): never {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
}

// ¿POR QUÉ PANTALLAS HABRÍA PASADO EL CLIENTE? — el recorrido del wizard, derivado del router.
//
// PARA QUÉ. Las corridas de `caso.ts` van por API y no abren el navegador: son rápidas y se pueden
// paralelizar, pero pierden una cosa que importa al leer un fallo. Una corrida dice «HTTP 500 en
// `confirm-payment-schedule`» y nadie sabe **en qué pantalla habría estado parado el cliente**, que es
// la pregunta que hace producto, soporte y QA. Esto contesta eso — y NADA más: no maneja el navegador,
// no corre nada, no valida. Es informativo.
//
// POR QUÉ GENERADO Y NO UN `.md` ESCRITO A MANO. Un documento con el recorrido del wizard queda viejo
// en el primer merge y **su hueco no avisa**: se lee igual de convincente estando mal. Este repo ya
// pagó eso con la lista de comandos del CLAUDE.md, que llegó a anunciar un target inexistente. Acá la
// fuente es `apps/loan-request-wizard/app/routes.ts` **en `main`**, o sea el router mismo: si alguien
// agrega una pantalla, aparece sola; si la borra, desaparece sola.
//
// LA CADENA, y es real —se verificó de punta a punta con `available-lenders.tsx`:
//   routes.ts declara      → `route("lenders", "routes/lenders-marketplace/available-lenders.tsx")`
//   la pantalla importa    → `GetFinancialDataUc` de `@creditop/customer-profile`
//   el paquete es carpeta  → `modules/loan-request-wizard/customer-profile/`
//   su infraestructura     → `` `${apiUrl}/api/partners/user-requests/${id}/financial-data` ``
// El nombre del paquete mapea a su carpeta por convención, y está comprobado contra los `package.json`.
//
// ⚠ QUÉ NO DICE, y conviene saberlo antes de usarlo para concluir:
//   · **el endpoint sale de lo que la pantalla IMPORTA, no de lo que ejecuta en cada corrida.** Una
//     pantalla con tres casos de uso puede llamar a uno solo según la rama. Es un techo, no una traza.
//   · **no dice el método** (GET/POST): eso vive en el `fetch` y no siempre al lado de la URL.
//   · **es el wizard**, no los otros fronts (admin, application). El wizard es el que recorre el cliente.
//
// Uso:  node dev/pantallas.ts [--json] [--sin-endpoints]
//         --filtro <texto>     acota por URL o archivo de la pantalla
//         --endpoint <texto>   AL REVÉS: qué pantallas pueden llamar a ese endpoint. Es la pregunta
//                              que deja abierta una corrida por API («falló en confirm-payment-schedule,
//                              ¿qué veía el cliente?»)

import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const FRONT = process.env.FRONTEND_REPO || `${process.env.HOME}/Desktop/CREDITOP/github/frontend-monorepo`;
const RAMA = process.env.FRONTEND_REF || 'main';
const APP = 'apps/loan-request-wizard/app';
const MODULOS = 'modules/loan-request-wizard';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valor = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

function git(...a: string[]): string {
    try {
        return execFileSync('git', ['-C', FRONT, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return '';
    }
}

// ── el router ────────────────────────────────────────────────────────────────────────────────────
type Nodo = { tipo: string; seg: string; archivo: string; hijos: Nodo[] };

/** Índice del cierre que casa con la apertura en `i`. Sin esto no se puede saber qué `route(...)` está
 *  adentro de qué `prefix(...)`, que es de donde sale la ruta completa. */
function cierre(t: string, i: number, abre: string, cierra: string): number {
    let n = 0;
    for (let j = i; j < t.length; j++) {
        const c = t[j];
        if (c === '"' || c === "'" || c === '`') { // saltear la cadena entera: puede traer paréntesis
            const q = c;
            j++;
            while (j < t.length && !(t[j] === q && t[j - 1] !== '\\')) j++;
            continue;
        }
        if (c === abre) n++;
        else if (c === cierra) { n--; if (n === 0) return j; }
    }
    return -1;
}

/** Parte por comas del NIVEL SUPERIOR — las de adentro de un objeto o un arreglo no cuentan. */
function partir(t: string): string[] {
    const out: string[] = [];
    let ini = 0, par = 0, cor = 0, lla = 0;
    for (let j = 0; j < t.length; j++) {
        const c = t[j];
        if (c === '"' || c === "'" || c === '`') { const q = c; j++; while (j < t.length && !(t[j] === q && t[j - 1] !== '\\')) j++; continue; }
        if (c === '(') par++; else if (c === ')') par--;
        else if (c === '[') cor++; else if (c === ']') cor--;
        else if (c === '{') lla++; else if (c === '}') lla--;
        else if (c === ',' && !par && !cor && !lla) { out.push(t.slice(ini, j)); ini = j + 1; }
    }
    out.push(t.slice(ini));
    return out.map((x) => x.trim()).filter(Boolean);
}

const cadena = (t: string): string | null => t.match(/^\s*["'`]([^"'`]*)["'`]/)?.[1] ?? null;

/** Lee las llamadas de un arreglo del router y devuelve el árbol. */
function leerArreglo(t: string): Nodo[] {
    const out: Nodo[] = [];
    const re = /(?:\.\.\.)?\b(route|index|layout|prefix)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
        const tipo = m[1];
        const abre = m.index + m[0].length - 1;
        const cie = cierre(t, abre, '(', ')');
        if (cie < 0) continue;
        const partes = partir(t.slice(abre + 1, cie));
        // el último argumento, si es un arreglo, son los HIJOS
        let hijos: Nodo[] = [];
        const ult = partes[partes.length - 1];
        if (ult?.startsWith('[')) hijos = leerArreglo(ult.slice(1, -1));

        let seg = '', archivo = '';
        if (tipo === 'route' || tipo === 'prefix') seg = cadena(partes[0] ?? '') ?? '';
        if (tipo === 'route') archivo = cadena(partes[1] ?? '') ?? '';
        if (tipo === 'index' || tipo === 'layout') archivo = cadena(partes[0] ?? '') ?? '';

        out.push({ tipo, seg, archivo, hijos });
        re.lastIndex = cie; // no volver a entrar a los hijos desde acá: ya se leyeron
    }
    return out;
}

type Pantalla = { url: string; archivo: string; tipo: string };

function aplanar(nodos: Nodo[], base = ''): Pantalla[] {
    const out: Pantalla[] = [];
    for (const n of nodos) {
        const url = n.seg ? `${base}/${n.seg}`.replace(/\/+/g, '/') : base;
        // `prefix` y `layout` no son pantallas: sólo aportan camino. `index` es la pantalla de su base.
        if (n.archivo && n.tipo !== 'layout') out.push({ url: url || '/', archivo: n.archivo, tipo: n.tipo });
        out.push(...aplanar(n.hijos, url));
    }
    return out;
}

// ── los endpoints ────────────────────────────────────────────────────────────────────────────────
/** De un literal de código a una ruta legible: `${apiUrl}/api/x/${id}/y` → `/api/x/{}/y`. */
function normalizar(lit: string): string | null {
    const i = lit.search(/\/(api|v1)\//);
    if (i < 0) return null;
    return lit.slice(i).replace(/\$\{[^}]*\}/g, '{}').replace(/\?.*$/, '').replace(/\/+$/, '');
}

function literales(texto: string): string[] {
    const out = new Set<string>();
    for (const m of texto.matchAll(/[`"']([^`"'\n]{0,240})[`"']/g)) {
        const r = normalizar(m[1]);
        if (r && r.length > 5) out.add(r);
    }
    return [...out];
}

/** `archivo → endpoints` y `símbolo exportado → archivo`, para todo el paquete de módulos. */
function indiceDeModulos() {
    const porArchivo = new Map<string, string[]>();
    const deSimbolo = new Map<string, string>();
    const porModulo = new Map<string, Set<string>>();

    const crudo = git('grep', '-n', '-E', '/(api|v1)/', RAMA, '--', `${MODULOS}/*`);
    for (const linea of crudo.split('\n')) {
        const m = linea.match(/^[^:]*:([^:]+):\d+:(.*)$/);
        if (!m) continue;
        const eps = literales(m[2]);
        if (!eps.length) continue;
        const lista = porArchivo.get(m[1]) ?? [];
        porArchivo.set(m[1], [...new Set([...lista, ...eps])]);
        // El módulo es el segmento que sigue a `modules/loan-request-wizard/` y es lo que el paquete
        // `@creditop/x` nombra: sirve de red cuando el símbolo no resuelve.
        const mod = m[1].split('/')[2];
        if (mod) {
            if (!porModulo.has(mod)) porModulo.set(mod, new Set());
            for (const e of eps) porModulo.get(mod)!.add(e);
        }
    }

    const exps = git('grep', '-n', '-E', '^export (abstract )?(class|const) ', RAMA, '--', `${MODULOS}/*`);
    for (const linea of exps.split('\n')) {
        const m = linea.match(/^[^:]*:([^:]+):\d+:export (?:abstract )?(?:class|const) (\w+)/);
        if (m) deSimbolo.set(m[2], m[1]);
    }
    return { porArchivo, deSimbolo, porModulo };
}

/** Qué símbolos `@creditop/*` importa cada archivo de pantalla, y qué endpoints trae él mismo.
 *
 *  ⚠ SE LEE EL ARCHIVO ENTERO, no línea por línea, y eso no es un detalle. Los imports del wizard son
 *  MULTILÍNEA —el `from "@creditop/x"` va solo al final, con los símbolos arriba—, así que un grep por
 *  línea encuentra el paquete y ninguno de sus símbolos. El síntoma era silencioso y creíble: la
 *  pantalla salía «sin endpoint propio», que se lee como «es de render» y no como «el parser no supo». */
function importesDePantallas() {
    const simbolos = new Map<string, Set<string>>();
    const propios = new Map<string, string[]>();
    const paquetes = new Map<string, Set<string>>();

    // Un solo `git archive` en vez de un `git show` por archivo: son ~150 pantallas y la diferencia se
    // nota. Sale de la RAMA, no del working tree, que es la regla de este repo.
    const tmp = mkdtempSync(join(tmpdir(), 'pantallas-'));
    try {
        execSync(`git -C ${JSON.stringify(FRONT)} archive ${RAMA} ${APP} | tar -x -C ${JSON.stringify(tmp)}`,
            { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
        return { simbolos, propios, paquetes };
    }

    const raiz = join(tmp, APP);
    const archivos: string[] = [];
    const caminar = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) caminar(full);
            else if (/\.(tsx?|jsx?)$/.test(e.name)) archivos.push(full);
        }
    };
    caminar(raiz);

    for (const full of archivos) {
        const rel = `${APP}/${relative(raiz, full)}`;
        const texto = readFileSync(full, 'utf8');

        const set = simbolos.get(rel) ?? new Set<string>();
        const paqs = paquetes.get(rel) ?? new Set<string>();
        for (const m of texto.matchAll(/import\s+(?:type\s+)?([\s\S]*?)from\s*["']@creditop\/([\w-]+)["']/g)) {
            paqs.add(m[2]);
            for (const s of m[1].replace(/[{}]/g, ' ').split(',')) {
                const nombre = s.replace(/\btype\b/g, '').split(/\s+as\s+/)[0].trim();
                if (/^[A-Z]\w+$/.test(nombre)) set.add(nombre);
            }
        }
        if (set.size) simbolos.set(rel, set);
        if (paqs.size) paquetes.set(rel, paqs);

        const eps = literales(texto);
        if (eps.length) propios.set(rel, eps);
    }
    rmSync(tmp, { recursive: true, force: true });
    return { simbolos, propios, paquetes };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
const fuente = git('show', `${RAMA}:${APP}/routes.ts`);
if (!fuente) {
    console.error(`✗ no pude leer ${APP}/routes.ts en ${RAMA} (repo: ${FRONT})`);
    process.exit(2);
}
const arranque = fuente.indexOf('export default');
const abre = fuente.indexOf('[', arranque);
const pantallas = aplanar(leerArreglo(fuente.slice(abre + 1, cierre(fuente, abre, '[', ']'))));

const filtro = valor('filtro');
const vistas = filtro ? pantallas.filter((p) => (p.url + p.archivo).includes(filtro)) : pantallas;
// `--endpoint` es la búsqueda AL REVÉS, y es la que motivó esta herramienta: una corrida falló en
// `confirm-payment-schedule` y lo que uno quiere saber es EN QUÉ PANTALLA habría estado el cliente.
// Se aplica después de resolver, porque hasta entonces no se sabe qué llama cada una.
const porEndpoint = valor('endpoint');

/** DOS NIVELES, y la diferencia se muestra porque no valen lo mismo.
 *
 *  `precisos` sale de resolver el símbolo que la pantalla importa hasta el archivo que lo define y
 *  leer su URL: eso SÍ lo llama esa pantalla. `delModulo` sale de atribuirle a la pantalla todos los
 *  endpoints del paquete que importa, y es un techo grueso — el paquete sirve a varias pantallas.
 *
 *  El segundo nivel existe porque el primero tiene un agujero medido: hay pantallas que llegan a la
 *  API por un HOOK (`useAbaco`) o por un componente, no por una clase de caso de uso, y ahí el símbolo
 *  no ata. Sin la red, esas pantallas salían «sin endpoint» — que se lee como «es de render» y es
 *  falso. Con la red aparecen, marcadas como lo que son. */
type Resueltos = { precisos: string[]; delModulo: string[] };
let endpointsDe = (_p: Pantalla): Resueltos => ({ precisos: [], delModulo: [] });
if (!flag('sin-endpoints')) {
    const { porArchivo, deSimbolo, porModulo } = indiceDeModulos();
    const { simbolos, propios, paquetes } = importesDePantallas();
    endpointsDe = (p: Pantalla) => {
        const ruta = `${APP}/${p.archivo}`;
        const precisos = new Set<string>(propios.get(ruta) ?? []);
        for (const s of simbolos.get(ruta) ?? []) {
            const archivo = deSimbolo.get(s);
            for (const e of (archivo && porArchivo.get(archivo)) || []) precisos.add(e);
        }
        const delModulo = new Set<string>();
        for (const paq of paquetes.get(ruta) ?? []) {
            for (const e of porModulo.get(paq) ?? []) if (!precisos.has(e)) delModulo.add(e);
        }
        return { precisos: [...precisos].sort(), delModulo: [...delModulo].sort() };
    };
}

let conEp = vistas.map((p) => ({ ...p, ...endpointsDe(p) }));
if (porEndpoint) {
    // Las que lo llaman DE VERDAD primero, y las del techo grueso después. Mezcladas, una respuesta de
    // 17 pantallas no sirve para nada: la mitad son «su paquete lo contiene», que no es lo mismo.
    conEp = conEp
        .filter((p) => [...p.precisos, ...p.delModulo].some((e) => e.includes(porEndpoint)))
        .sort((a, b) => Number(b.precisos.some((e) => e.includes(porEndpoint)))
                      - Number(a.precisos.some((e) => e.includes(porEndpoint))));
}

// ⚠ SIN `process.exit(0)` DESPUÉS DE IMPRIMIR. Con salida grande, stdout a un pipe es asíncrono y
// `exit` mata el proceso antes de vaciarlo: el JSON salía CORTADO en 65.535 caracteres, con un string
// a medio cerrar. Y se corta en silencio —exit code 0, sin error—, así que quien lo parsee ve un JSON
// inválido y busca el bug en su parser. Dejar terminar el proceso solo es lo que garantiza el flush.
if (flag('json')) {
    console.log(JSON.stringify(conEp, null, 2));
} else {

    console.log(`\n  EL RECORRIDO DEL WIZARD — ${pantallas.length} pantallas, derivadas de ${APP}/routes.ts en \`${RAMA}\``);
    console.log(`  Es un mapa de lo que cada pantalla PUEDE llamar, no la traza de una corrida.`);
    console.log(`    →  lo llama esta pantalla (el símbolo importado resuelve hasta la URL)`);
    console.log(`    ·  está en un paquete que importa — techo grueso, el paquete sirve a varias pantallas`);
    if (filtro) console.log(`  filtro: «${filtro}» → ${vistas.length}`);
    if (porEndpoint) {
        const ciertas = conEp.filter((p) => p.precisos.some((e) => e.includes(porEndpoint))).length;
        console.log(`  «${porEndpoint}» → ${ciertas} pantalla(s) lo llaman · ${conEp.length - ciertas} lo tienen en un paquete que importan`);
        console.log(`  (las mismas pantallas aparecen repetidas por prefijo: /:flow y /merchant son el mismo archivo)`);
    }
    console.log('');

    for (const p of conEp) {
        const marca = p.archivo.startsWith('layouts/') ? '  (layout, no es destino)' : '';
        console.log(`  ▸ ${p.url}${marca}`);
        console.log(`      ${p.archivo}`);
        const interesa = (e: string) => !porEndpoint || e.includes(porEndpoint);
        for (const e of p.precisos.filter(interesa)) console.log(`      → ${e}`);
        if (!flag('sin-endpoints')) for (const e of p.delModulo.filter(interesa)) console.log(`      · ${e}`);
        if (!p.precisos.length && !p.delModulo.length && !flag('sin-endpoints')) {
            console.log(`      (sin endpoint: no importa nada de \`@creditop/*\` con URL — es render puro)`);
        }
    }

    const conPreciso = conEp.filter((p) => p.precisos.length).length;
    const soloModulo = conEp.filter((p) => !p.precisos.length && p.delModulo.length).length;
    const mudas = conEp.length - conPreciso - soloModulo;
    console.log(`\n  ${conEp.length} pantallas · ${conPreciso} con endpoint propio · ${soloModulo} sólo por módulo · ${mudas} sin ninguno`);
    console.log(`  ⚠ Esto NO reemplaza correr el front: dice qué PUEDE llamar cada pantalla, no qué llamó.\n`);
}

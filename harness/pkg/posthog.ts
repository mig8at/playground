// posthog.ts — la TERCERA fuente después de la BD y Loki: qué VIO el cliente, con el vocabulario del embudo.
//
// La BD dice el desenlace (estado), Loki dice la causa (qué decidió el backend) y PostHog dice el
// RECORRIDO tal como lo cuenta producto: `results_screen_viewed`, `lender_selection_result`,
// `signing_otp_result`, `credit_approved`. Los tres se unen por la solicitud: el wizard emite cada
// evento con `distinct_id = loan_request_<ureq>` y la propiedad `loan_request_id`.
//
// QUIÉN EMITE, Y POR ESO QUÉ CORRIDA SE VE. Sólo el FRONT instrumenta PostHog —el backend no emite
// nada—, en dos capas: el servidor del wizard (`captureAnalyticsEventServer`, `$lib = posthog-node`)
// desde loaders y actions, y el navegador (`$pageview`, `$autocapture`, `*_screen_viewed` del cliente,
// session replay). De ahí que las tres formas de usar el harness dejen rastros distintos:
//   · el caminador HTTP (`dev/caminar-wizard.ts`)  → SÓLO eventos del servidor. Medido 2026-09-02 en
//     qa: 18 eventos para una corrida de 11 pantallas, del `auth_otp_result` al `credit_approved`.
//   · el panel (navegador real)                    → servidor + navegador + replay.
//   · `dev/caso.ts` (por API, sin front)           → NADA. Y conviene decirlo: PostHog no lo ve.
//
// UN SOLO PROYECTO PARA TODOS LOS ENVIRONMENTS (238530 «Loan Request»), separados por
// `properties.environment` (`getRuntimeEnvironment()`: qa y staging escriben «staging», prod
// «production», el front de dev «dev»). LOCAL NO ESCRIBE: `getServerPostHog()` devuelve null con
// `APP_ENV=local`. Así que acá no hay «PostHog local» como hay Loki local, y está bien: mandar lo local
// al proyecto compartido ensuciaría la analítica del equipo.
//
// ⚠ LA TRAMPA QUE OBLIGA A FILTRAR POR HORA: prod y dev COMPARTEN EL RANGO DE IDS y el `distinct_id`
// no lleva ambiente. La solicitud 502057 existe en prod desde julio y en qa desde hoy, y para PostHog
// son LA MISMA PERSONA con los eventos mezclados. Preguntar sólo por `distinct_id` devuelve la de otro.
// Por eso `eventsOf()` exige `desde` (la hora de inicio de la corrida) además del ambiente: es lo
// único que desambigua. Es un hallazgo del sistema, no del harness: cualquier embudo por persona en ese
// proyecto está contaminado por lo que se prueba en qa.
//
// EL CRUCE, que es el rendimiento real de tener esto: cada pantalla del wizard tiene los eventos que
// SU archivo emite (`captureAnalyticsEventServer({ event: "…" })`), y eso se DERIVA del código en la
// rama del target —no de una lista horneada acá—, igual que `dev/pantallas.ts` deriva el recorrido del
// router. Con eso, una pantalla caminada sin su evento, o un evento que apareció sin pasar por su
// pantalla (`credit_rejected` lo dispara `request-canceled`), se ve solo.
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { env, TARGET } from './env.ts';

// QUÉ PostHog atiende cada ambiente —la API, el token, el proyecto, el valor de `environment`— y cuáles
// no escriben nada (local, dev) NO lo decide el harness: lo decide `connectors/events`, y se le pregunta
// por `bin/pg`. Hasta el 2026-09-24 el harness tenía su propio cliente y sus claves (`E2E_POSTHOG_*`), y
// el trazador otras; las reglas de qué ambiente no escribe sólo las sabía éste. Lo que sigue siendo del
// harness son sus perillas de espera.
const PG = fileURLToPath(new URL('../../bin/pg', import.meta.url));
const pgAsync = promisify(execFile);

export type PostHogConfig = {
    project: string; env: string; api: string; hasToken: boolean;
    /** Por qué el conector dice que no se consulta este ambiente, o vacío. */
    missing: string;
    settleMs: number; maxWaitMs: number;
};

export function posthogConfig(): PostHogConfig {
    let pc = { project: '', env: '', api: '', hasToken: false, missing: '' };
    try {
        pc = JSON.parse(execFileSync(PG, ['events', 'config', '--target', TARGET], { encoding: 'utf8', timeout: 120_000 }));
    } catch (e) {
        const err = e as { stderr?: string; message?: string };
        pc.missing = `bin/pg no pudo decir qué PostHog atiende ${TARGET}: ${(err.stderr || err.message || String(e)).trim().split('\n').pop()}`;
    }
    return {
        ...pc,
        settleMs: Number(env('E2E_POSTHOG_SETTLE_MS', '8000')) || 0,
        maxWaitMs: Number(env('E2E_POSTHOG_MAX_WAIT_MS', '120000')) || 0,
    };
}

/** Por qué NO se consulta. `null` = se puede. La razón se imprime: un silencio se lee como «no pasó nada».
 *  Las reglas (local y dev no escriben; el token es un `phx_`; sin ambiente una solicitud homónima de prod
 *  contamina la respuesta) son del conector. */
export function whyNot(c: PostHogConfig): string | null {
    return c.missing || null;
}

export type Event = { ts: string; evento: string; lib: string; canal: string | null; url: string | null; props: Record<string, unknown> };

async function hogql(_c: PostHogConfig, query: string): Promise<{ columns: string[]; results: any[][] }> {
    try {
        const { stdout } = await pgAsync(PG, ['events', 'hogql', '--target', TARGET, '--query', query],
            { encoding: 'utf8', timeout: 90_000, maxBuffer: 64 << 20 });
        const j = JSON.parse(stdout) as { columns?: string[]; results?: any[][] };
        return { columns: j.columns ?? [], results: j.results ?? [] };
    } catch (e) {
        const err = e as { stderr?: string; message?: string };
        throw new Error((err.stderr || err.message || String(e)).trim().replace(/^pg: /, ''));
    }
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Los eventos de UNA solicitud, de ESTE ambiente, desde la hora dada. Los tres filtros son obligatorios
 *  (ver la cabecera: el id solo trae a la homónima de prod). Los `$identify` no llevan `environment`,
 *  así que se aceptan sin él —el `distinct_id` más la hora ya los fijan.
 *
 *  ⚠ LA HORA VA EN EPOCH, NO EN TEXTO. `toDateTime('2026-09-03 01:00:00')` lo interpreta HogQL en la
 *  zona del proyecto (America/Bogota, -05:00), o sea cinco horas DESPUÉS de la hora UTC que uno creyó
 *  mandar: el filtro excluía la corrida entera y devolvía «0 eventos» (medido 2026-09-02, uReq 502058).
 *  `fromUnixTimestamp(n)` no tiene zona y da la hora que es. */
export async function eventsOf(c: PostHogConfig, ureq: number | string, since: Date): Promise<Event[]> {
    const id = String(ureq);
    const q = `SELECT timestamp, event, properties.$lib, properties.channel, properties.$current_url, properties
                 FROM events
                WHERE (distinct_id = 'loan_request_${esc(id)}' OR toString(properties.loan_request_id) = '${esc(id)}')
                  AND (properties.environment = '${esc(c.env)}' OR properties.environment IS NULL)
                  AND timestamp >= fromUnixTimestamp(${Math.floor(since.getTime() / 1000)})
                ORDER BY timestamp ASC LIMIT 500`;
    const { results } = await hogql(c, q);
    return results.map((r) => {
        let props: Record<string, unknown> = {};
        try { props = typeof r[5] === 'string' ? JSON.parse(r[5]) : (r[5] ?? {}); } catch { /* sin props */ }
        return { ts: String(r[0]), evento: String(r[1]), lib: String(r[2] ?? ''), canal: r[3] ?? null, url: r[4] ?? null, props };
    });
}

// ─── los eventos que cada pantalla DEBERÍA emitir, derivados del código del front ───────────────

const FRONT = process.env.FRONTEND_REPO || `${process.env.HOME}/Desktop/CREDITOP/github/frontend-monorepo`;
const APP = 'apps/loan-request-wizard/app';
/** La rama que sirve a cada target (ver harness/CLAUDE.md §«Qué es real en cada target»). */
export const FRONT_BRANCH: Record<string, string> = { local: 'HEAD', dev: 'origin/develop', staging: 'origin/staging', qa: 'origin/qa', prod: 'main' };

function git(...a: string[]): string | null {
    try { return execFileSync('git', ['-C', FRONT, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch { return null; }
}

let filesCache: Map<string, string> | null = null;
/** segmento de ruta (`lenders`, `confirmation`, `:phone_number/otp`…) → archivo del route, leído de routes.ts. */
function filesBySegment(branchName: string): Map<string, string> {
    if (filesCache) return filesCache;
    const m = new Map<string, string>();
    const src = git('show', `${branchName}:${APP}/routes.ts`) ?? '';
    for (const x of src.matchAll(/route\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)) {
        // ⚠ Se indexa por el último segmento LITERAL, descartando los `:param` del final. El router
        // declara `dynamic-form/:form_type_id`, así que quedarse con el último a secas guardaba la clave
        // «:form_type_id» y la pantalla salía como «¿ruta nueva?» estando declarada desde siempre.
        const parts = x[1].split('/').filter((sg) => sg && !sg.startsWith(':'));
        const seg = parts.pop();                     // «lenders/recalculate» → «recalculate»
        if (seg && !m.has(seg)) m.set(seg, x[2]);
    }
    filesCache = m;
    return m;
}

const eventsCache = new Map<string, string[]>();
/** Los `event: "…"` que ese archivo emite DESDE EL SERVIDOR (dentro de `captureAnalyticsEventServer`). */
function fileEvents(branchName: string, file: string): string[] {
    const k = `${branchName}:${file}`;
    if (eventsCache.has(k)) return eventsCache.get(k)!;
    const src = git('show', `${branchName}:${APP}/${file}`) ?? '';
    const out = new Set<string>();
    for (const block of src.matchAll(/captureAnalyticsEventServer\(\{([\s\S]*?)\n\s*\}\);/g)) {
        const lit = block[1].match(/\bevent:\s*"([^"]+)"/);
        if (lit) { out.add(lit[1]); continue; }
        // `event: selectionEventName`, con `const selectionEventName = cond ? "a" : "b"` más arriba
        // (available-lenders.tsx). Sin esto, `primary_offer_activated` salía como huérfano.
        const ref = block[1].match(/\bevent:\s*([A-Za-z_$][\w$]*)\s*,/);
        if (ref) {
            const decl = src.match(new RegExp(`(?:const|let)\\s+${ref[1]}\\s*=([^;]*);`));
            for (const l of (decl?.[1] ?? '').matchAll(/"([a-z0-9_]+)"/g)) out.add(l[1]);
        }
    }
    const list = [...out];
    eventsCache.set(k, list);
    return list;
}

/** Quién emite un evento que ninguna pantalla caminada explica: un util compartido (`app/utils/*.server.ts`,
 *  como `track-credit-approved.server.ts`, que llama la pantalla de OTP), u otra pantalla. Sin esto,
 *  `credit_approved` salía como «huérfano» cuando es el evento más importante del recorrido. */
export function issuerOf(event: string, branchName = FRONT_BRANCH[TARGET] ?? 'main'): string | null {
    const out = git('grep', '-l', `"${event}"`, branchName, '--', `${APP}/utils`, `${APP}/routes`, 'modules');
    const files = (out ?? '').split('\n').filter(Boolean)
        .map((l) => l.replace(/^[^:]+:/, '')).filter((f) => !/taxonomy|test/.test(f));
    return files.length ? files.map((f) => f.replace(`${APP}/`, '')).join(', ') : null;
}

/** Para una ruta caminada (`/self-service/x/1/lenders?amount=…`) → qué eventos del servidor emite su archivo. */
export function expectedOf(path: string, branchName = FRONT_BRANCH[TARGET] ?? 'main'): { archivo: string | null; eventos: string[] } {
    // ⚠ El último segmento NO siempre es el del router: en `/…/dynamic-form/7` el 7 es el
    // `:form_type_id` y el segmento declarado es `dynamic-form`. Sin esto, esa pantalla salía como
    // «sin archivo en el router: ¿ruta nueva?» cuando está declarada desde siempre. Se prueba el
    // último y, si es un número, el anterior.
    const segs = path.split('?')[0].split('/').filter(Boolean);
    const table = filesBySegment(branchName);
    let file: string | null = null;
    for (let i = segs.length - 1; i >= 0 && !file; i--) {
        if (i < segs.length - 1 && !/^\d+$/.test(segs[i + 1])) break;   // sólo se salta lo numérico
        file = table.get(segs[i]) ?? null;
    }
    return { archivo: file, eventos: file ? fileEvents(branchName, file) : [] };
}

// ─── el cruce y su impresión ────────────────────────────────────────────────────────────────────

export type Crossing = {
    porPantalla: { ruta: string; archivo: string | null; esperados: string[]; vistos: string[]; faltan: string[] }[];
    huerfanos: string[];        // eventos que llegaron y ninguna pantalla caminada los emite
    sinInstrumentar: string[];  // pantallas cuyo archivo no emite ningún evento del servidor
};

export function cross(paths: string[], events: Event[], branchName = FRONT_BRANCH[TARGET] ?? 'main'): Crossing {
    const names = new Set(events.map((e) => e.evento));
    const explained = new Set<string>();
    const byScreen = paths.map((path) => {
        const { archivo: file, eventos: expectedOnes } = expectedOf(path, branchName);
        const seen = expectedOnes.filter((e) => names.has(e));
        seen.forEach((e) => explained.add(e));
        // Los «esperados» son los que el archivo PUEDE emitir; una pantalla emite unos u otros según la
        // rama que tomó. Falta = ninguno de los suyos apareció, no «no aparecieron todos».
        const missing = seen.length ? [] : expectedOnes;
        return { ruta: path.split('?')[0], archivo: file, esperados: expectedOnes, vistos: seen, faltan: missing };
    });
    const orphanOnes = [...names].filter((n) => !n.startsWith('$') && !explained.has(n));
    const notInstrumented = byScreen.filter((p) => p.archivo && !p.esperados.length).map((p) => p.ruta);
    return { porPantalla: byScreen, huerfanos: orphanOnes, sinInstrumentar: notInstrumented };
}

// La salida va por un «sink» intercambiable: el caminador corre casos en PARALELO y guarda las líneas de
// cada uno para imprimirlas juntas; escribir directo a consola las mezclaría.
let sink: (linea: string) => void = (l) => console.log(l);
const log = (s = '') => sink(s ? `  ▸ ${s}` : '');

/** Una línea por evento: hora · nombre · quién lo emitió (servidor / navegador) · dónde estaba el cliente. */
export function printEvents(ev: Event[]): void {
    for (const e of ev) {
        const time = e.ts.replace(/^\d{4}-\d{2}-\d{2}T/, '').replace(/\.\d+.*$/, '');
        const who = /posthog-node/.test(e.lib) ? 'servidor' : 'navegador';
        const where = e.url ? new URL(e.url, 'http://x').pathname : '';
        log(`  ${time}  ${e.evento.padEnd(34)} ${who.padEnd(9)} ${where}`);
    }
}

/** `parcial` = la ingesta todavía no trajo el final de la corrida. Importa para NO mentir: un evento que
 *  falta por atraso de ingesta se ve idéntico a uno que la pantalla nunca emitió, y marcarlo con ✗ manda
 *  a buscar un bug donde sólo hay que esperar. Pasó en la primera corrida con esto puesto (2026-09-02):
 *  `confirmation ✗ esperaba loan_confirmation_viewed` cuando el evento llegó dos minutos después. */
export function printCrossing(c: Crossing, partial = false): void {
    for (const p of c.porPantalla) {
        const sheet = p.ruta.split('/').filter(Boolean).slice(3).join('/') || p.ruta;
        if (!p.archivo) { log(`  ${sheet.padEnd(34)} (sin archivo en el router: ¿ruta nueva?)`); continue; }
        if (!p.esperados.length) { log(`  ${sheet.padEnd(34)} sin instrumentar en el servidor`); continue; }
        if (p.vistos.length) log(`  ${sheet.padEnd(34)} ✓ ${p.vistos.join(', ')}`);
        else if (partial) log(`  ${sheet.padEnd(34)} … todavía no llegó ninguno de [${p.esperados.join(', ')}] — lectura PARCIAL, no es una falta`);
        else log(`  ${sheet.padEnd(34)} ✗ esperaba alguno de [${p.esperados.join(', ')}] y no llegó ninguno`);
    }
    for (const h of c.huerfanos) {
        const who = issuerOf(h);
        log(who
            ? `  ${h.padEnd(34)} ✓ llegó, pero lo emite ${who} y no el archivo de una pantalla caminada`
            : `  ${h.padEnd(34)} ? llegó y no encuentro quién lo emite en la rama del target`);
    }
}

// ─── EL SEGUNDO CANAL: los LOGS. Acá está «en qué pantalla falló» ───────────────────────────────
//
// PostHog tiene DOS canales y son distintos, no dos vistas de lo mismo:
//   · `events` (arriba) → el EMBUDO. Qué pasó, en el vocabulario de producto. Para errores sirve poco:
//     el evento `$exception` existe pero en 7 días no hubo ninguno en staging y de los ~4.900 de prod
//     NINGUNO trae `loan_request_id` (medido 2026-09-02).
//   · `logs`  (acá)     → la BITÁCORA del servidor del wizard, que llega por OpenTelemetry. Es la que
//     dice **qué pantalla, en qué etapa y con qué error**, y sí trae la solicitud.
//
// LO QUE TRAE CADA LOG, y por eso las consultas de abajo: `attributes['routeId']` es el ARCHIVO de la
// pantalla (`routes/sign-documents.tsx`), `routeLifecycle` si fue el `loader` o el `action`,
// `loan_request_id`, `errorName` · `errorMessage` · `errorStack`, `url_path`, `response_status`,
// `partner_hash`. Y `pattern`, que es PostHog agrupando mensajes parecidos (`… returned <N>`): es lo
// que hace legible un ranking sin que 50 mensajes con distinto id cuenten como 50 problemas.
//
// LOS TIPOS DE LOG (`event_name`), medidos sobre 7 días — sirven para leer un error sin abrir el stack:
//   backend.request.failed_response  el front llamó al backend y le contestó >= 400   (el más común)
//   exception.captured               `captureServerException`: algo explotó en la ruta
//   route.lifecycle.failed           el loader/action se cayó entero
//   backend.request.failed           la llamada no llegó a destino (red)
//   span.failed · span.completed     una operación instrumentada (`loan-origination.*`)
//   known_exception_captured         error de negocio ya contemplado (nivel warn)
//
// ⚠ TRES LÍMITES QUE HAY QUE SABER ANTES DE CONCLUIR DE UN SILENCIO:
//   1. ENVIRONMENTS: sólo `staging` (los deploys de qa y de staging) y `production`. No hay `dev` ni
//      `local`, porque esos fronts no escriben.
//   2. RETENCIÓN: los datos más viejos que vi son del 2026-08-27, o sea ~7 días.
//   3. MUESTREO: `shouldCaptureLog` NUNCA muestrea warn/error/fatal, así que «no hay errores» es un
//      dato confiable. El `info` sí puede venir muestreado: ahí un silencio no prueba nada.
//
// ⚠ Y LO QUE **NO** SE PUEDE: unir con Loki por trace. El log trae `trace_id` (hexadecimal real, va
// en base64 en la columna y en claro en `attributes['trace_id']`), pero ese trace es del front y **no
// aparece en las líneas del backend**: probado con tres traces de una corrida propia, cero líneas en
// Loki. El puente entre las tres fuentes sigue siendo `loan_request_id`.

export type LogLine = {
    ts: string; nivel: string; tipo: string; pantalla: string | null; etapa: string | null;
    mensaje: string; err: string | null; motivo: string | null; url: string | null; status: string | null; trace: string | null;
};

const SELECT_LOG = `SELECT toTimeZone(timestamp,'UTC') AS ts, level, event_name,
       attributes['routeId'], attributes['routeLifecycle'], message,
       attributes['errorName'], attributes['reason'], attributes['url_path'],
       attributes['response_status'], attributes['trace_id']
  FROM logs`;

function aLog(r: any[]): LogLine {
    return {
        ts: String(r[0]), nivel: String(r[1] ?? ''), tipo: String(r[2] ?? ''),
        pantalla: r[3] || null, etapa: r[4] || null, mensaje: String(r[5] ?? ''),
        err: r[6] || null, motivo: r[7] || null, url: r[8] || null, status: r[9] || null, trace: r[10] || null,
    };
}

/** La bitácora del front para UNA solicitud. Mismo filtro de hora que los eventos y por la misma razón
 *  (ids compartidos entre prod y dev), más el ambiente, que en `logs` vive en `resource_attributes`. */
export async function logsOf(c: PostHogConfig, ureq: number | string, since: Date): Promise<LogLine[]> {
    const { results } = await hogql(c, `${SELECT_LOG}
        WHERE attributes['loan_request_id'] = '${esc(String(ureq))}'
          AND resource_attributes['deployment.environment'] = '${esc(c.env)}'
          AND timestamp >= fromUnixTimestamp(${Math.floor(since.getTime() / 1000)})
        ORDER BY timestamp ASC LIMIT 300`);
    return results.map(aLog);
}

/** El ranking: qué PANTALLAS fallan en este ambiente y con qué error. Para mirar una vez por semana,
 *  o después de un deploy. Agrupa por (pantalla, etapa, error) y no por mensaje: un mensaje con un id
 *  adentro cuenta como un problema distinto por cada id, y eso esconde el patrón. */
export async function errorsByScreen(c: PostHogConfig, days = 7): Promise<{ pantalla: string; etapa: string; err: string; tipo: string; n: number; ultimo: string }[]> {
    const { results } = await hogql(c, `
        SELECT attributes['routeId'] AS pantalla, attributes['routeLifecycle'] AS etapa,
               attributes['errorName'] AS err, event_name AS tipo, count() AS n,
               toTimeZone(max(timestamp),'UTC') AS ultimo
          FROM logs
         WHERE level = 'error'
           AND resource_attributes['deployment.environment'] = '${esc(c.env)}'
           AND timestamp > now() - interval ${Number(days) || 7} day
         GROUP BY pantalla, etapa, err, tipo
         ORDER BY n DESC LIMIT 40`);
    return results.map((r) => ({ pantalla: r[0] || '(sin pantalla)', etapa: r[1] || '—', err: r[2] || '—', tipo: String(r[3] ?? ''), n: Number(r[4]), ultimo: String(r[5]) }));
}

/** Los MENSAJES agrupados por el patrón que calcula PostHog (`… returned <N>`). Complementa al ranking
 *  por pantalla: éste dice QUÉ se rompe, aquél DÓNDE. */
export async function errorPatterns(c: PostHogConfig, days = 7): Promise<{ patron: string; n: number }[]> {
    const { results } = await hogql(c, `
        SELECT pattern, count() AS n FROM logs
         WHERE level = 'error'
           AND resource_attributes['deployment.environment'] = '${esc(c.env)}'
           AND timestamp > now() - interval ${Number(days) || 7} day
         GROUP BY pattern ORDER BY n DESC LIMIT 20`);
    return results.map((r) => ({ patron: String(r[0] ?? '').replace(/\s+/g, ' ').trim(), n: Number(r[1]) }));
}

const ICON: Record<string, string> = { error: '✗', warn: '⚠', info: '·', debug: '·' };

/** Una línea por log: hora · nivel · pantalla y etapa · qué dijo. La pantalla es lo que se viene a buscar. */
export function printLogs(ls: LogLine[], problemsOnly = false): void {
    for (const l of ls) {
        if (problemsOnly && l.nivel !== 'error' && l.nivel !== 'warn') continue;
        const time = l.ts.replace(/^\d{4}-\d{2}-\d{2}T/, '').replace(/\.\d+.*$/, '');
        const where = l.pantalla ? `${l.pantalla.replace(/^routes\//, '')}${l.etapa ? ` ${l.etapa}` : ''}` : (l.url ?? l.tipo);
        const qué = l.mensaje || l.err || l.tipo;
        log(`  ${ICON[l.nivel] ?? ' '} ${time}  ${String(where).padEnd(42)} ${String(qué).replace(/\s+/g, ' ').slice(0, 110)}`);
    }
}

/** El forense de PostHog al cerrar una corrida: espera el lote del servidor, trae los eventos de ESA
 *  corrida y los cruza con las pantallas caminadas. Nunca tumba la corrida: es un extra. */
export async function postHogForensic(ureq: number | string, since: Date, paths: string[],
                                     output?: (linea: string) => void, until: Date = new Date()): Promise<void> {
    if (output) sink = output;
    const c = posthogConfig();
    const no = whyNot(c);
    log();
    if (no) { log(`PostHog: no se consulta — ${no}`); return; }
    // LA INGESTA TARDA, y no un poco: un minuto después de cerrar habían llegado 4 de los 18 eventos de
    // una corrida (2026-09-02). Una sola espera fija deja el cruce a medias y se lee como «esta pantalla
    // no emitió». Se sondea hasta que el conjunto deje de crecer entre dos lecturas, con un techo.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (c.settleMs) await sleep(c.settleMs);
    let ev: Event[] = [];
    const t0 = Date.now();
    let prior = -1;
    let attempts = 0;
    while (true) {
        try { ev = await eventsOf(c, ureq, new Date(since.getTime() - 60_000)); }
        catch (e) { log(`PostHog: no pude consultar — ${(e as Error).message.slice(0, 160)}`); return; }
        attempts += 1;
        // «Estable» no alcanza: la ingesta llega en RÁFAGAS y dos lecturas iguales a mitad de camino
        // dejaron el cruce con 10 de 18 eventos. Además se exige haber visto un evento de la parte FINAL
        // de la corrida (los últimos 15 s antes de `hasta`): si el más nuevo es de la mitad, falta.
        const last = ev.length ? Date.parse(ev[ev.length - 1].ts) : 0;
        const reachedEnd = last >= until.getTime() - 15_000;
        if (ev.length > 0 && ev.length === prior && reachedEnd) break;
        if (Date.now() - t0 >= c.maxWaitMs) break;                     // techo
        prior = ev.length;
        await sleep(15_000);
    }
    const wait = Math.round((Date.now() - t0 + c.settleMs) / 1000);
    const lastTs = ev.length ? Date.parse(ev[ev.length - 1].ts) : 0;
    const partial = !(ev.length > 0 && lastTs >= until.getTime() - 15_000);
    const srv = ev.filter((e) => /posthog-node/.test(e.lib)).length;
    log(`── POSTHOG · uReq ${ureq} · environment=${c.env} · desde el inicio de la corrida · ${attempts} lectura(s) en ${wait} s${partial ? ' · PARCIAL' : ''} ──`);
    if (partial && ev.length) {
        log(`   ⚠ la ingesta todavía no trajo el final de la corrida: lo que sigue es lo que HABÍA a los ${wait} s.`);
        log(`     Para el cruce completo, en unos minutos: node dev/posthog-ureq.ts ${ureq} --desde ${new Date(since.getTime() - 60_000).toISOString()}`);
    }
    log(`   ${ev.length} evento(s) · ${srv} del servidor · ${ev.length - srv} del navegador`
        + (ev.length - srv === 0 ? '   (sin navegador no hay $pageview ni replay: es lo esperado por HTTP)' : ''));
    if (!ev.length) {
        log(`   nada en ${wait} s. O la ingesta sigue atrasada (subí E2E_POSTHOG_MAX_WAIT_MS), o esta corrida no pasó por el front.`);
        return;
    }
    printEvents(ev);
    log(`── el cruce con las ${paths.length} pantallas caminadas (eventos esperados: derivados de ${FRONT_BRANCH[TARGET] ?? 'main'}) ──`);
    printCrossing(cross(paths, ev), partial);

    // El segundo canal: la bitácora. Los errores van SIEMPRE —son la respuesta a «en qué pantalla se
    // rompió»— y el resto sólo se cuenta: un `info` por operación completada llena la salida sin decir
    // nada que la traza de BD no diga ya.
    let ls: LogLine[];
    try { ls = await logsOf(c, ureq, new Date(since.getTime() - 60_000)); }
    catch (e) { log(`── logs: no pude consultar — ${(e as Error).message.slice(0, 140)}`); return; }
    const badList = ls.filter((l) => l.nivel === 'error' || l.nivel === 'warn');
    log(`── LOGS del front · ${ls.length} línea(s) · ${badList.length} de nivel error/warn ──`);
    if (!ls.length) log(partial
        ? '   nada TODAVÍA: la ingesta viene atrasada, así que esto no prueba que no hubo errores. Volvé a mirar con el comando de arriba.'
        : '   nada. Con la ingesta al día esto significa que el front no registró ni un problema.');
    else if (!badList.length) log(`   sin errores ni warnings (las ${ls.length} son info: operaciones completadas). warn y error NO se muestrean, así que este silencio SÍ vale.`);
    else printLogs(badList);
}

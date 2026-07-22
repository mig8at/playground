// panel/server.ts — "Panel del harness": UI local para elegir comercio, definir el usuario sintético
// (nombre/ingreso/score) e iniciar el flujo (assign + inyección de buró + wizard en monto) de un clic.
// Wrapper FINO sobre los CLIs que ya existen: shellea `bin/dbops.ts list` y `bin/asesor <m> auto`.
// Sin dependencias (node http). Corre `.ts` nativo con node, igual que bin/dbops.ts.
//
//   node panel/server.ts       (o ./bin/panel)  →  http://localhost:5195
//
// Soporta target `local` y `dev` (ver TARGETS abajo). Al lanzar con `dev` setea
// I_KNOW_THIS_TOUCHES_SHARED_DEV=1 en el entorno del hijo — OJO: dev toca data COMPARTIDA
// (ver pkg/db.ts::assertWriteAllowed). Elegí `local` salvo que sepas exactamente qué vas a escribir.
import { createServer, get, IncomingMessage, ServerResponse } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');              // raíz de frontend-e2e
const PORT = Number(process.env.PANEL_PORT || 5195);
const RUN_LOG = '/tmp/asesor-panel-run.log';
const PA_STATUS_FILE = '/tmp/mock-pa-statuses.json'; // status por lender del mock de pre-aprobados (mismo path que lee server.mjs)
const TARGETS = new Set(['local', 'dev', 'staging']);

// env por target. `local` es seguro; **dev y staging comparten LA MISMA BD y API** (en legacy-backend
// staging no es un entorno aparte: solo el frontend lo es), así que los dos son DATA COMPARTIDA y los dos
// necesitan el guard de escritura de pkg/db. La condición va por "no es local", no por t === 'dev':
// listar targets a mano fue lo que dejó a staging afuera cuando se agregó.
function envFor(target: string): NodeJS.ProcessEnv {
    const t = TARGETS.has(target) ? target : 'local';
    const shared = t !== 'local';
    return { ...process.env, E2E_TARGET: t, CFE_TARGET: t, ...(shared ? { I_KNOW_THIS_TOUCHES_SHARED_DEV: '1' } : {}) };
}

// una sola corrida a la vez (un browser headed a la vez).
let current: { child: ReturnType<typeof spawn>; slug: string; target: string; startedAt: number; done: boolean; code: number | null } | null = null;

// ── BITÁCORA DE LA CORRIDA ───────────────────────────────────────────────────────────────────────
// Se ACUMULA en memoria a medida que el panel consulta la actividad, en vez de sacar una foto al final.
// Dos razones: `dbops activity` corta con `LIMIT 60` por tabla (una corrida larga perdería los eventos
// más viejos), y si una fila se borra a mitad de camino la foto final no la vería nunca. Se vuelca a
// disco cuando la corrida termina, para el post mortem.
const RUNS_DIR = resolve(ROOT, '.runs');
const ULTIMA = join(RUNS_DIR, 'ultima-corrida.json');
let bitacora: { user: number | null; eventos: Map<string, any> } = { user: null, eventos: new Map() };

/** Mezcla lo que devolvió `dbops activity` en la bitácora. Clave = tabla+id+op+at → idempotente: el
 *  panel re-consulta TODA la ventana en cada tick, así que sin dedup se duplicaría cada 2 segundos. */
function acumular(a: any): void {
    if (!a || !Array.isArray(a.tablas)) return;
    if (a.user) bitacora.user = a.user;
    for (const t of a.tablas) {
        for (const e of t.eventos || []) {
            bitacora.eventos.set(`${t.tabla}|${e.id}|${e.op}|${e.at}`, { at: e.at, op: e.op, tabla: t.tabla, id: e.id, detalle: e.detalle || '' });
        }
    }
}

/** Vuelca la bitácora a `.runs/`. Un archivo fijo (la última) + uno por corrida (historia comparable). */
function volcarBitacora(): void {
    if (!current) return;
    const eventos = [...bitacora.eventos.values()].sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const resumen: Record<string, { altas: number; cambios: number }> = {};
    for (const e of eventos) {
        const r = (resumen[e.tabla] ??= { altas: 0, cambios: 0 });
        if (e.op === 'INSERT') r.altas++; else r.cambios++;
    }
    // ── VEREDICTO ────────────────────────────────────────────────────────────────────────────────
    // Se DERIVA de los eventos ya recolectados, sin una sola consulta nueva: la bitácora ya trae el
    // estado y el flujo en el `detalle` de `user_requests`, y qué central se escribió en el de
    // `risk_central_user_data`. Es la conclusión que hoy reconstruís a mano abriendo la base.
    const ESTADOS: Record<string, string> = {
        '1': 'Validación OTP', '3': 'Seleccionó entidad', '9': 'Formulario de perfil',
        '10': 'Pendiente de autorización', '11': 'Autorizada',
    };
    const EXPERIAN = ['1', '8', '9'];   // Acierta · Quanto · Acierta+Quanto (`risk_centrals`)
    const ur = eventos.filter((e) => e.tabla === 'user_requests');
    const ultimo = ur.length ? ur[ur.length - 1] : null;
    const mEstado = ultimo ? /estado (\d+)/.exec(ultimo.detalle) : null;
    const mFlujo = ur.map((e) => /flow (\d+)/.exec(e.detalle)).filter(Boolean).pop();
    const buro = eventos.filter((e) => e.tabla === 'risk_central_user_data'
        && EXPERIAN.includes((/central (\d+)/.exec(e.detalle) || [])[1] ?? ''));
    const firmado = mFlujo?.[1] === '2';
    const veredicto = {
        solicitud: ultimo ? `#${ultimo.id}` : null,
        estadoFinal: mEstado ? `${mEstado[1]} «${ESTADOS[mEstado[1]] ?? '?'}»` : 'sin transiciones registradas',
        flujo: mFlujo ? (firmado ? '2 · already-confirmed-pre-approval (omite buró)' : `${mFlujo[1]} · estándar`) : 'sin firmar',
        experian: buro.length ? `CONSULTADO (${buro.length} reporte/s)` : 'no se consultó',
        // La lectura combinada es lo que importa; el resto son datos sueltos.
        lectura: !ultimo ? 'la corrida no llegó a crear ni tocar una solicitud'
            : firmado && !buro.length ? '✓ flujo firmado y sin consulta a Experian: la omisión se aplicó'
            : firmado && buro.length ? '✗ flujo firmado PERO se consultó Experian — la omisión no funcionó'
            : buro.length ? 'flujo estándar con consulta a Experian (lo esperado sin la firma)'
            : 'flujo estándar sin consulta: puede ser caché vigente o la compuerta de frecuencia (ver F-60/F-63)',
    };

    const doc = {
        corrida: {
            comercio: current.slug, target: current.target, exitCode: current.code,
            inicio: new Date(current.startedAt).toISOString(),
            fin: new Date().toISOString(),
            duracionSeg: Math.round((Date.now() - current.startedAt) / 1000),
        },
        usuario: bitacora.user,
        // El alcance viaja DENTRO del archivo: quien lo lea meses después no tiene por qué saber que
        // esto no es un binlog, y un registro que aparenta ser completo es peor que no tenerlo.
        alcance: '9 tablas curadas, solo filas del usuario de esta corrida. NO incluye DELETEs ni escrituras de otras personas (dev/staging son compartidas).',
        veredicto, resumen, eventos,
    };
    try {
        if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
        const s = JSON.stringify(doc, null, 2) + '\n';
        writeFileSync(ULTIMA, s);
        writeFileSync(join(RUNS_DIR, `corrida-${new Date(current.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${current.slug}.json`), s);
    } catch { /* el volcado nunca debe tumbar la corrida */ }
}

function json(res: ServerResponse, code: number, body: unknown) {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(s);
}

function readBody(req: IncomingMessage): Promise<any> {
    return new Promise((ok) => {
        let d = '';
        req.on('data', (c) => (d += c));
        req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } });
    });
}

// dbops list <q> → JSON (comercios que matchean) contra el target elegido (dev es remoto → timeout más largo).
function dbopsList(q: string, target: string): Promise<any[]> {
    return new Promise((ok) => {
        execFile('node', ['bin/dbops.ts', 'list', q], { cwd: ROOT, env: envFor(target), timeout: 30000 }, (err, stdout) => {
            if (err) return ok([]);
            try { ok(JSON.parse(stdout)); } catch { ok([]); }
        });
    });
}

// corre `node bin/dbops.ts <args...>` y devuelve el JSON parseado (o null si falla). Target-aware (dev → I_KNOW).
function dbopsJson(args: string[], target: string): Promise<any> {
    return new Promise((ok) => {
        execFile('node', ['bin/dbops.ts', ...args], { cwd: ROOT, env: envFor(target), timeout: 30000 }, (err, stdout) => {
            if (err) return ok(null);
            try { ok(JSON.parse(stdout)); } catch { ok(null); }
        });
    });
}

// hash de la SUCURSAL que usa el LAUNCH para un slug (de .flows.json, igual que bin/asesor). Es ese branch
// el que hay que togglear — NO el de `dbops list` (que puede devolver otra sucursal del mismo comercio).
function branchHashForSlug(slug: string): string {
    try {
        const j = JSON.parse(readFileSync(join(ROOT, '.flows.json'), 'utf8'));
        const h = j?.merchants?.[slug]?.branch_hash;
        if (h) return h;
    } catch { /* sin .flows.json legible → cae al fallback */ }
    // El buscador deja elegir una sucursal que NO está en `.flows.json`: en ese caso el "slug" ES el
    // hash. Así el panel corre contra cualquier comercio de la base sin tener que quemarlo antes.
    const s = slug.trim().toLowerCase();
    return /^[0-9a-f]{8}$/.test(s) ? s : '';
}

/**
 * ¿Esta corrida va contra el MOCK de pre-aprobados, o contra el MS real? Se resuelve por la MISMA
 * cadena que usa `bin/asesor` (envget), no enumerando targets: el selector de estado por entidad solo
 * tiene sentido si el mock es quien contesta. Atarlo a una lista de targets se desincroniza el día que
 * alguien cambia `E2E_REAL_PREAPPROVALS`, y quedaría una perilla que no mueve nada.
 */
function usaMockPA(target: string): Promise<boolean> {
    return new Promise((ok) => {
        execFile('node', ['bin/envget.ts', 'E2E_REAL_PREAPPROVALS', '0'],
            { cwd: ROOT, env: envFor(target), timeout: 10000 },
            (err, out) => ok(!err && String(out || '').trim() !== '1'));
    });
}

function leerFlows(): any {
    try { return JSON.parse(readFileSync(join(ROOT, '.flows.json'), 'utf8')); } catch { return {}; }
}
function escribirFlows(j: any): void {
    writeFileSync(join(ROOT, '.flows.json'), JSON.stringify(j, null, 2) + '\n');
}
/**
 * Slug legible y ÚNICO a partir del nombre que puso el usuario. Si el nombre ya está tomado por OTRA
 * sucursal, se sufija con el hash (que sí es único) en vez de pisar: dos "Dentix" de sucursales
 * distintas son comercios de prueba distintos, y pisar uno haría que `bin/asesor dentix` corriera
 * contra la sucursal equivocada sin avisar.
 */
function slugPara(nombre: string, hash: string, flows: any): string {
    const base = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'comercio';
    const m = flows?.merchants ?? {};
    if (!m[base] || m[base].branch_hash === hash) return base;
    return `${base}-${hash.slice(0, 4)}`;
}

// lanza `bin/asesor <slug>` en MODO MANUAL (sin `auto` → no auto-rellena; vos manejás desde monto) con
// E2E_INJECT=1 (inyecta el buró invisible al llegar a personal-info) + el perfil por env, contra el target.
interface Profile { income?: number; score?: number; name?: string; documentType?: string; document?: string; gender?: string; age?: number; negatives?: number; consulted?: number; occupation?: string; dob?: string; expeditionDate?: string; email?: string; }

// RASTRO de la corrida: vuelca TODO lo que elegiste en el panel al log, para que quede registro de con qué
// configuración corriste (antes solo salía el perfil, como un JSON crudo, y los selects de pre-aprobación y
// el ON/OFF de lenders no aparecían en ningún lado).
async function runHeader(slug: string, p: Profile, t: string, inject: boolean, step: string, amt: number, paDelay: number, canal = 'asesor'): Promise<string> {
    const money = (n: number) => `$${n.toLocaleString('es-CO')}`;
    const row = (k: string, v: string) => `   ${k.padEnd(13)}${v}`;
    const L: string[] = [
        `▶ CORRIDA · ${slug} (${t})`,
        row('canal', canal === 'ecommerce'
            ? 'ECOMMERCE — entra por URL base64 de la tienda (sin asesor)'
            : 'ASESOR — login Cognito + wizard'),
        row('modo', inject ? 'SINTÉTICO — inyecta el buró (salta la consulta real)' : 'REAL — consulta el buró de verdad, sin inyección'),
        row('saltar a', step === 'monto' ? 'monto (manejás todo vos)' : step),
        row('monto', money(amt)),
        row('espera PA', paDelay ? `${paDelay}ms (para ver el loader de las cards)` : 'sin espera'),
    ];
    if (inject) {
        L.push(row('identidad', `${p.documentType || 'CC'} ${p.document || '(auto)'} · ${p.name || 'SYNTH TEST USER'} · ${p.gender || 'M'} · ${p.age ?? 35} años`));
        L.push(row('empleo', `${p.occupation || 'Empleado'} · ingreso ${money(p.income ?? 0)}`));
        L.push(row('buró', p.documentType === 'PEP' ? 'sin buró (PEP)' : `score ${p.score ?? '-'} · negativos ${p.negatives ?? 0} · consultas ${p.consulted ?? 0}`));
        if (p.email) L.push(row('email', p.email));
    }
    // Pre-aprobación por lender: lo que devolverá el mock. Los que no tocaste van 'aprobado' por defecto.
    let pa: Record<string, string> = {};
    try { pa = JSON.parse(readFileSync(PA_STATUS_FILE, 'utf8')); } catch { /* sin archivo = todo aprobado */ }
    // Nombre de cada lender + su ON/OFF, para que el rastro se lea sin tener que traducir ids.
    const hash = branchHashForSlug(slug);
    const lenders = hash ? ((await dbopsJson(['lenders-for', hash], t)) as Array<{ id: number; name: string; rt: number; lender_status: number }> | null) : null;
    const ES: Record<string, string> = { approved: 'aprobado', rejected: 'rechazado', pending: 'pendiente' };
    if (Array.isArray(lenders) && lenders.length) {
        const desc = lenders.map((l) => {
            const on = Number(l.lender_status) === 1;
            // rt0 no consulta el MS de pre-aprobados → el selector del panel no aplica.
            const st = Number(l.rt) !== 0 ? (ES[pa[String(l.id)]] ?? 'aprobado (default)') : 'sin pre-aprobación (rt0)';
            return `${l.name} #${l.id} rt${l.rt} → ${on ? st : 'APAGADO (no va a listar)'}`;
        });
        L.push(row('lenders', desc.join('\n' + ' '.repeat(16))));
    } else if (Object.keys(pa).length) {
        L.push(row('pre-aprob.', Object.entries(pa).map(([id, s]) => `#${id} ${ES[s] ?? s}`).join(' · ') + ' (resto: aprobado)'));
    }
    return L.join('\n') + '\n';
}

async function launch(slug: string, profile: Profile, target: string, inject: boolean, stepTarget: string, amount: number, paDelay: number, canal = 'asesor'): Promise<{ ok: boolean; msg: string }> {
    if (current && !current.done) return { ok: false, msg: `ya hay una corrida activa (${current.slug}). Parala primero.` };
    const t = TARGETS.has(target) ? target : 'local';
    const step = ['monto', 'phone', 'personal-info', 'lenders'].includes(stepTarget) ? stepTarget : 'monto';
    const amt = amount > 0 ? Math.round(amount) : 2_000_000; // monto solicitado (default 2M)
    const mode = inject ? 'manual + inyección de buró' : 'manual REAL (consulta buró real, sin inyección)';
    const jump = step === 'monto' ? '' : ` · salto → ${step}`;
    writeFileSync(RUN_LOG, await runHeader(slug, profile, t, inject, step, amt, paDelay, canal));
    const env = {
        ...envFor(t),
        // switch del panel: ON → inyecta el buró (salta la consulta real); OFF → sin inyección (consulta real).
        E2E_INJECT: inject ? '1' : '',
        // CANAL: 'ecommerce' hace que el spec entre por la URL base64 (pkg/checkout-b64.ts) en vez del
        // login de asesor. El usuario sintético es el MISMO — viaja adentro del pedido serializado.
        E2E_ENTRY: canal === 'ecommerce' ? 'ecommerce' : 'cognito',
        // salto de pasos: monto (vos manejás) | phone | personal-info | lenders (auto-avanza inyectando el sintético).
        E2E_STEP_TARGET: step,
        // monto solicitado (lo usa el spec para sembrar/monto y el /lenders?amount=).
        E2E_AMOUNT: String(amt),
        // espera del mock de pre-aprobados (para ver el loader de las cards rt≠0). bin/asesor → mock-preapprovals lo hereda.
        MOCK_PA_DELAY_MS: String(paDelay > 0 ? Math.round(paDelay) : 0),
        E2E_SYNTH_INCOME: profile.income ? String(profile.income) : '',
        E2E_SYNTH_SCORE: profile.score ? String(profile.score) : '',
        E2E_SYNTH_NAME: profile.name || '',
        E2E_SYNTH_DOCTYPE: profile.documentType || '',
        E2E_SYNTH_DOC: profile.document || '',
        E2E_SYNTH_GENDER: profile.gender || '',
        E2E_SYNTH_AGE: profile.age ? String(profile.age) : '',
        E2E_SYNTH_NEG: profile.negatives != null ? String(profile.negatives) : '',
        E2E_SYNTH_CONS: profile.consulted != null ? String(profile.consulted) : '',
        E2E_SYNTH_OCC: profile.occupation || '',
        E2E_SYNTH_DOB: profile.dob || '',
        E2E_SYNTH_EXP: profile.expeditionDate || '',
        E2E_SYNTH_EMAIL: profile.email || '',
    };
    // detached → el hijo lidera su propio grupo de procesos; así "Detener" mata el ÁRBOL entero
    // (bash → npx playwright → node → chromium), no solo el bash.
    const bin = canal === 'ecommerce' ? 'ecommerce' : 'asesor';   // bin/ecommerce es un wrapper que exporta CFE_ENTRY
    const child = spawn('/bin/bash', [join(ROOT, 'bin', bin), slug], { cwd: ROOT, env, detached: true });  // sin `auto` → manual
    current = { child, slug, target: t, startedAt: Date.now(), done: false, code: null };
    bitacora = { user: null, eventos: new Map() };   // arranca limpia: si no, arrastraría la corrida anterior
    const append = (b: Buffer) => { try { writeFileSync(RUN_LOG, b.toString(), { flag: 'a' }); } catch {} };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code) => {
        if (current) { current.done = true; current.code = code; }
        append(Buffer.from(`\n✓ corrida terminada (code ${code})\n`));
        volcarBitacora();
        append(Buffer.from(`  bitácora → .runs/ultima-corrida.json (${bitacora.eventos.size} operación/es de BD)\n`));
    });
    return { ok: true, msg: `lanzado '${slug}' (${t}) — ${mode}${jump}.` };
}

function tailLog(): string {
    if (!existsSync(RUN_LOG)) return '';
    // sin colores ANSI, últimas ~120 líneas
    const raw = readFileSync(RUN_LOG, 'utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    return raw.split('\n').slice(-120).join('\n');
}

// log COMPLETO (sin recorte) para el botón "copiar consola". Incluye los errores del navegador: el spec los
// vuelca al stdout del hijo (page.on('console')/pageerror → líneas "⚠ …" / "⚠ FALLO EN PANTALLA …"), que va al RUN_LOG.
function fullLog(): string {
    if (!existsSync(RUN_LOG)) return '';
    return readFileSync(RUN_LOG, 'utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// mata el ÁRBOL de procesos de la corrida (grupo entero, gracias a detached). SIGTERM y luego SIGKILL.
function killRun(sig: NodeJS.Signals): void {
    if (!current || current.done || !current.child.pid) return;
    try { process.kill(-current.child.pid, sig); }        // -pid = grupo entero
    catch { try { current.child.kill(sig); } catch {} }   // fallback: solo el proceso
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
        const f = join(HERE, 'index.html');
        if (!existsSync(f)) return json(res, 500, { error: 'falta panel/index.html' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readFileSync(f, 'utf8'));
    }

    // Mapa de pasos del wizard (panel/steps.json) + verificación de que sus rutas existen. El `ok:false`
    // se muestra en la UI: un conteo de archivos que ya no resuelven es peor que no mostrar nada.
    // Estado del harness para las tarjetas de arriba. TODO sale de algo real: puertos que responden,
    // el volcado forense de la última corrida y el validador del mapa. Sin números decorativos.
    if (path === '/api/estado') {
        const MOCKS: Array<[string, number]> = [
            ['pre-aprobaciones', 8095], ['redirect', 8096], ['payvalida', 8097], ['mdm/IMEI', 8098],
            ['entidades', 8099], ['pdf-mapper', 8100], ['forms', 8101], ['ábaco', 8102],
        ];
        const vivo = (p: number) => new Promise<boolean>((ok) => {
            const req = get({ host: '127.0.0.1', port: p, path: '/', timeout: 400 }, (r) => { r.destroy(); ok(true); });
            req.on('error', () => ok(false));
            req.on('timeout', () => { req.destroy(); ok(false); });
        });
        const estados = await Promise.all(MOCKS.map(async ([n, p]) => ({ nombre: n, puerto: p, arriba: await vivo(p) })));

        // última corrida: el volcado que hace el scrub ANTES de borrar (F-52)
        let ultima: any = null;
        try {
            const dir = join(ROOT, '.runs');
            const f = readdirSync(dir).filter((x) => x.endsWith('.json'))
                .map((x) => ({ x, t: statSync(join(dir, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
            if (f) {
                const j = JSON.parse(readFileSync(join(dir, f.x), 'utf8'));
                const s = (j.solicitudes || [])[0];
                if (s) ultima = { uReq: s.id, estado: s.estado, estadoId: s.user_request_status_id, lender: s.lender, cuando: j.borrado_en };
            }
        } catch { /* sin corridas todavía */ }

        const mapa = await new Promise<any>((ok) => {
            execFile('node', ['bin/steps-check.ts', '--json'], { cwd: ROOT, timeout: 15000 }, (_e, out) => {
                try { ok(JSON.parse(out)); } catch { ok(null); }
            });
        });

        return json(res, 200, { mocks: estados, ultima, mapa });
    }

    if (path === '/api/steps') {
        try {
            const mapa = JSON.parse(readFileSync(join(HERE, 'steps.json'), 'utf8'));
            const chequeo = await new Promise<any>((ok) => {
                execFile('node', ['bin/steps-check.ts', '--json'], { cwd: ROOT, timeout: 15000 }, (_e, out) => {
                    try { ok(JSON.parse(out)); } catch { ok({ ok: null, rotas: [] }); }
                });
            });
            return json(res, 200, { ...mapa, chequeo });
        } catch (e) {
            return json(res, 200, { tronco: [], ramales: {}, chequeo: { ok: false, rotas: [], error: String(e) } });
        }
    }

    // Las cards muestran el hash de la sucursal que se LANZA (el de .flows.json, vía branchHashForSlug),
    // no el de una búsqueda por slug: eran distintos y la card mostraba una sucursal mientras el flujo
    // corría contra otra, con OTRA lista de lenders.
    if (path === '/api/branches') {
        const slugs = (url.searchParams.get('slugs') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const target = (url.searchParams.get('target') || 'local').trim();
        const porSlug: Record<string, string> = {};
        for (const s of slugs) { const h = branchHashForSlug(s); if (h) porSlug[s] = h; }
        const hashes = [...new Set(Object.values(porSlug))];
        const filas: any[] = hashes.length ? ((await dbopsJson(['branches', ...hashes], target)) ?? []) : [];
        const info = Object.fromEntries(filas.map((f: any) => [f.hash, f]));
        return json(res, 200, Object.fromEntries(slugs.map((s) => {
            const h = porSlug[s];
            return [s, h ? { hash: h, ...(info[h] ?? { existe: false }) } : { hash: '', sinFlows: true }];
        })));
    }

    // Qué escribió en la BD la corrida actual. La ventana va en SEGUNDOS desde que arrancó y el corte lo
    // hace la BD con SU reloj (ver `dbops activity`): contra dev la base es remota y comparar contra el
    // reloj de node perdería eventos o traería basura vieja.
    if (path === '/api/activity') {
        const target = (url.searchParams.get('target') || 'local').trim();
        if (!current) return json(res, 200, { user: null, tablas: [] });
        const seg = Math.max(1, Math.round((Date.now() - current.startedAt) / 1000));
        const act = (await dbopsJson(['activity', String(seg)], target)) || { user: null, tablas: [] };
        acumular(act);
        return json(res, 200, act);
    }

    if (path === '/api/merchants') {
        const q = (url.searchParams.get('q') || '').trim();
        const target = (url.searchParams.get('target') || 'local').trim();
        if (!q) return json(res, 200, []);
        return json(res, 200, await dbopsList(q, target));
    }

    // ── FAVORITOS ────────────────────────────────────────────────────────────────────────────────
    // Se guardan en `.flows.json` (gitignored), que YA es el registro de comercios del harness: así el
    // favorito queda disponible también para `bin/asesor <slug>` desde la terminal, no solo en el panel.
    // Se marcan con `fav: true` para distinguirlos de los que vienen de fábrica y permitir renombrar o
    // borrar SOLO los tuyos — los curados describen lo que ejercita cada uno y no son tuyos para tocar.
    if (path === '/api/favs') {
        const m = leerFlows()?.merchants ?? {};
        return json(res, 200, Object.entries(m)
            .filter(([, v]: [string, any]) => v && v.fav)
            .map(([slug, v]: [string, any]) => ({ slug, name: v.name || slug, hash: v.branch_hash || '' })));
    }

    if (path === '/api/fav' && req.method === 'POST') {
        const b = await readBody(req);
        const accion = String(b.accion || 'add');
        const flows = leerFlows();
        flows.merchants = flows.merchants || {};
        if (accion === 'add') {
            const hash = String(b.hash || '').trim().toLowerCase();
            const nombre = String(b.name || '').trim();
            if (!/^[0-9a-f]{8}$/.test(hash) || !nombre) return json(res, 400, { ok: false, msg: 'falta hash válido o nombre' });
            const slug = slugPara(nombre, hash, flows);
            flows.merchants[slug] = {
                branch_hash: hash,
                ...(b.allied_id ? { allied_id: Number(b.allied_id) } : {}),
                ...(b.branch_id ? { branch_id: Number(b.branch_id) } : {}),
                name: nombre, fav: true,
            };
            escribirFlows(flows);
            return json(res, 200, { ok: true, slug, name: nombre });
        }
        const slug = String(b.slug || '').trim();
        const cur = flows.merchants[slug];
        if (!cur || !cur.fav) return json(res, 400, { ok: false, msg: 'solo se pueden editar los favoritos que agregaste' });
        if (accion === 'rename') {
            const nombre = String(b.name || '').trim();
            if (!nombre) return json(res, 400, { ok: false, msg: 'falta nombre' });
            // El SLUG no cambia al renombrar: es la clave con la que `bin/asesor <slug>` ya funciona y
            // la que puede estar en un comando guardado. El nombre es solo la etiqueta de la card.
            cur.name = nombre;
            escribirFlows(flows);
            return json(res, 200, { ok: true, slug, name: nombre });
        }
        if (accion === 'remove') { delete flows.merchants[slug]; escribirFlows(flows); return json(res, 200, { ok: true }); }
        return json(res, 400, { ok: false, msg: `acción desconocida: ${accion}` });
    }

    // sucursales de un comercio → el buscador es en dos pasos (comercio → sucursal) porque el hash que
    // se lanza es de SUCURSAL, y un comercio grande tiene muchas con configuraciones distintas.
    if (path === '/api/branches-of') {
        const allied = (url.searchParams.get('allied') || '').trim();
        const target = (url.searchParams.get('target') || 'local').trim();
        if (!allied) return json(res, 200, []);
        const r = await dbopsJson(['branches-of', allied], target);
        return json(res, 200, Array.isArray(r) ? r : []);
    }

    // lenders de la sucursal (la que usa el launch) → [{id, name, rt, product, branch_status}]
    if (path === '/api/lenders') {
        const slug = (url.searchParams.get('slug') || '').trim();
        const target = (url.searchParams.get('target') || 'local').trim();
        const hash = branchHashForSlug(slug);
        if (!hash) return json(res, 200, { hash: '', lenders: [], msg: `sin branch_hash en .flows.json para '${slug}'` });
        const r = await dbopsJson(['lenders-for', hash], target);
        // Si la consulta falla, `dbops` devuelve {error}. Antes se normalizaba a [] y el panel dibujaba
        // el recorrido VACÍO, indistinguible de "este comercio no tiene entidades" — así se escondió
        // durante días que contra dev la query moría por una columna ausente (F-64). El error se pasa.
        if (!Array.isArray(r)) {
            const msg = r && typeof r === 'object' && 'error' in r ? String((r as any).error) : 'no devolvió una lista';
            return json(res, 200, { hash, lenders: [], mockPA: await usaMockPA(target), msg: `✗ la consulta de entidades falló: ${msg}` });
        }
        return json(res, 200, { hash, lenders: r, mockPA: await usaMockPA(target) });
    }

    // prende/apaga un lender en la sucursal (lenders_by_allied_branches.status)
    if (path === '/api/lender-toggle' && req.method === 'POST') {
        const b = await readBody(req);
        const hash = branchHashForSlug(String(b.slug || ''));
        if (!hash || !b.lenderId) return json(res, 400, { ok: false, msg: 'falta slug/lenderId' });
        const r = await dbopsJson(['lender-set', hash, String(b.lenderId), b.status ? '1' : '0'], String(b.target || 'local'));
        return json(res, 200, r || { ok: false, msg: 'falló el toggle (ver consola del panel)' });
    }

    // fija el orden de los lenders del comercio (lenders_by_allieds.sort) desde una lista de ids
    if (path === '/api/lender-sort' && req.method === 'POST') {
        const b = await readBody(req);
        const hash = branchHashForSlug(String(b.slug || ''));
        const order = Array.isArray(b.order) ? b.order.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
        if (!hash || !order.length) return json(res, 400, { ok: false, msg: 'falta slug/order' });
        const r = await dbopsJson(['lender-sort', hash, order.join(',')], String(b.target || 'local'));
        return json(res, 200, r || { ok: false, msg: 'falló el orden' });
    }

    // status por lender del mock de pre-aprobados: { "<lenderId>": "approved|rejected|pending" }. El mock lo lee por request.
    if (path === '/api/pa-statuses') {
        if (req.method === 'POST') {
            const b = await readBody(req);
            const map = b && typeof b.map === 'object' && b.map ? b.map : {};
            try { writeFileSync(PA_STATUS_FILE, JSON.stringify(map)); } catch { /* */ }
            return json(res, 200, { ok: true, map });
        }
        try { return json(res, 200, JSON.parse(readFileSync(PA_STATUS_FILE, 'utf8'))); } catch { return json(res, 200, {}); }
    }

    if (path === '/api/launch' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.slug) return json(res, 400, { ok: false, msg: 'falta slug del comercio' });
        return json(res, 200, await launch(String(b.slug), {
            income: Number(b.income) || undefined,
            score: Number(b.score) || undefined,
            name: b.name ? String(b.name) : undefined,
            documentType: b.documentType ? String(b.documentType) : undefined,
            document: b.document ? String(b.document) : undefined,
            gender: b.gender ? String(b.gender) : undefined,
            age: Number(b.age) || undefined,
            negatives: b.negatives !== undefined && b.negatives !== '' ? Number(b.negatives) : undefined,
            consulted: b.consulted !== undefined && b.consulted !== '' ? Number(b.consulted) : undefined,
            occupation: b.occupation ? String(b.occupation) : undefined,
            dob: b.dob ? String(b.dob) : undefined,
            expeditionDate: b.expeditionDate ? String(b.expeditionDate) : undefined,
            email: b.email ? String(b.email) : undefined,
        }, String(b.target || 'local'), b.inject !== false, String(b.stepTarget || 'monto'), Number(b.amount) || 0, Number(b.paDelay) || 0, String(b.canal || 'asesor')));
    }

    if (path === '/api/status') {
        return json(res, 200, {
            running: !!(current && !current.done),
            slug: current?.slug ?? null,
            code: current?.done ? current?.code : null,
            log: tailLog(),
        });
    }

    if (path === '/api/log') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fullLog());
    }

    if (path === '/api/stop' && req.method === 'POST') {
        if (current && !current.done) {
            writeFileSync(RUN_LOG, '\n■ detenido por el usuario\n', { flag: 'a' });
            killRun('SIGTERM');
            setTimeout(() => killRun('SIGKILL'), 2500);   // escalá si no murió en 2.5s
            return json(res, 200, { ok: true });
        }
        return json(res, 200, { ok: false, msg: 'no hay corrida activa' });
    }

    json(res, 404, { error: 'not found' });
});

server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  ✗ El puerto ${PORT} ya está en uso — probablemente el panel ya está abierto en http://localhost:${PORT}\n    Cerrá la otra instancia, o usá otro puerto:  PANEL_PORT=5196 npm run dev\n`);
    } else {
        console.error(`\n  ✗ Error del panel: ${err.message}\n`);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`\n  🎛  Panel del harness → http://localhost:${PORT}   (local · dev)\n`);
});

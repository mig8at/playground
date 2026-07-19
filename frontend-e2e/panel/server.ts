// panel/server.ts — "Panel del harness": UI local para elegir comercio, definir el usuario sintético
// (nombre/ingreso/score) e iniciar el flujo (assign + inyección de buró + wizard en monto) de un clic.
// Wrapper FINO sobre los CLIs que ya existen: shellea `bin/dbops.ts list` y `bin/asesor <m> auto`.
// Sin dependencias (node http). Corre `.ts` nativo con node, igual que bin/dbops.ts.
//
//   node panel/server.ts       (o ./bin/panel)  →  http://localhost:5195
//
// SOLO LOCAL por ahora: fuerza CFE_TARGET/E2E_TARGET=local en todo lo que lanza. dev/staging tocan data
// COMPARTIDA (ver pkg/db.ts::assertWriteAllowed) — se sumarán con guardas duras, no en este MVP.
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');              // raíz de frontend-e2e
const PORT = Number(process.env.PANEL_PORT || 5195);
const RUN_LOG = '/tmp/asesor-panel-run.log';
const PA_STATUS_FILE = '/tmp/mock-pa-statuses.json'; // status por lender del mock de pre-aprobados (mismo path que lee server.mjs)
const TARGETS = new Set(['local', 'dev']);     // staging: pendiente (.env.staging)

// env por target: local = seguro; dev = DATA COMPARTIDA → habilita el guard de escritura de pkg/db (synthFill).
function envFor(target: string): NodeJS.ProcessEnv {
    const t = TARGETS.has(target) ? target : 'local';
    return { ...process.env, E2E_TARGET: t, CFE_TARGET: t, ...(t === 'dev' ? { I_KNOW_THIS_TOUCHES_SHARED_DEV: '1' } : {}) };
}

// una sola corrida a la vez (un browser headed a la vez).
let current: { child: ReturnType<typeof spawn>; slug: string; startedAt: number; done: boolean; code: number | null } | null = null;

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
        return j?.merchants?.[slug]?.branch_hash || '';
    } catch { return ''; }
}

// lanza `bin/asesor <slug>` en MODO MANUAL (sin `auto` → no auto-rellena; vos manejás desde monto) con
// E2E_INJECT=1 (inyecta el buró invisible al llegar a personal-info) + el perfil por env, contra el target.
interface Profile { income?: number; score?: number; name?: string; documentType?: string; document?: string; gender?: string; age?: number; negatives?: number; consulted?: number; occupation?: string; dob?: string; expeditionDate?: string; email?: string; }

// RASTRO de la corrida: vuelca TODO lo que elegiste en el panel al log, para que quede registro de con qué
// configuración corriste (antes solo salía el perfil, como un JSON crudo, y los selects de pre-aprobación y
// el ON/OFF de lenders no aparecían en ningún lado).
async function runHeader(slug: string, p: Profile, t: string, inject: boolean, step: string, amt: number, paDelay: number): Promise<string> {
    const money = (n: number) => `$${n.toLocaleString('es-CO')}`;
    const row = (k: string, v: string) => `   ${k.padEnd(13)}${v}`;
    const L: string[] = [
        `▶ CORRIDA · ${slug} (${t})`,
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

async function launch(slug: string, profile: Profile, target: string, inject: boolean, stepTarget: string, amount: number, paDelay: number): Promise<{ ok: boolean; msg: string }> {
    if (current && !current.done) return { ok: false, msg: `ya hay una corrida activa (${current.slug}). Parala primero.` };
    const t = TARGETS.has(target) ? target : 'local';
    const step = ['monto', 'phone', 'personal-info', 'lenders'].includes(stepTarget) ? stepTarget : 'monto';
    const amt = amount > 0 ? Math.round(amount) : 2_000_000; // monto solicitado (default 2M)
    const mode = inject ? 'manual + inyección de buró' : 'manual REAL (consulta buró real, sin inyección)';
    const jump = step === 'monto' ? '' : ` · salto → ${step}`;
    writeFileSync(RUN_LOG, await runHeader(slug, profile, t, inject, step, amt, paDelay));
    const env = {
        ...envFor(t),
        // switch del panel: ON → inyecta el buró (salta la consulta real); OFF → sin inyección (consulta real).
        E2E_INJECT: inject ? '1' : '',
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
    const child = spawn('/bin/bash', [join(ROOT, 'bin', 'asesor'), slug], { cwd: ROOT, env, detached: true });  // sin `auto` → manual
    current = { child, slug, startedAt: Date.now(), done: false, code: null };
    const append = (b: Buffer) => { try { writeFileSync(RUN_LOG, b.toString(), { flag: 'a' }); } catch {} };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code) => { if (current) { current.done = true; current.code = code; } append(Buffer.from(`\n✓ corrida terminada (code ${code})\n`)); });
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

    if (path === '/api/merchants') {
        const q = (url.searchParams.get('q') || '').trim();
        const target = (url.searchParams.get('target') || 'local').trim();
        if (!q) return json(res, 200, []);
        return json(res, 200, await dbopsList(q, target));
    }

    // lenders de la sucursal (la que usa el launch) → [{id, name, rt, product, branch_status}]
    if (path === '/api/lenders') {
        const slug = (url.searchParams.get('slug') || '').trim();
        const target = (url.searchParams.get('target') || 'local').trim();
        const hash = branchHashForSlug(slug);
        if (!hash) return json(res, 200, { hash: '', lenders: [], msg: `sin branch_hash en .flows.json para '${slug}'` });
        const lenders = await dbopsJson(['lenders-for', hash], target);
        return json(res, 200, { hash, lenders: Array.isArray(lenders) ? lenders : [] });
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
        }, String(b.target || 'local'), b.inject !== false, String(b.stepTarget || 'monto'), Number(b.amount) || 0, Number(b.paDelay) || 0));
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

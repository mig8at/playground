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

// lanza `bin/asesor <slug>` en MODO MANUAL (sin `auto` → no auto-rellena; vos manejás desde monto) con
// E2E_INJECT=1 (inyecta el buró invisible al llegar a personal-info) + el perfil por env, contra el target.
interface Profile { income?: number; score?: number; name?: string; documentType?: string; document?: string; gender?: string; age?: number; negatives?: number; consulted?: number; occupation?: string; dob?: string; expeditionDate?: string; email?: string; }

function launch(slug: string, profile: Profile, target: string, inject: boolean): { ok: boolean; msg: string } {
    if (current && !current.done) return { ok: false, msg: `ya hay una corrida activa (${current.slug}). Parala primero.` };
    const t = TARGETS.has(target) ? target : 'local';
    const mode = inject ? 'manual + inyección de buró' : 'manual REAL (consulta buró real, sin inyección)';
    writeFileSync(RUN_LOG, `▶ lanzando '${slug}' (${t}) · ${mode} · perfil ${JSON.stringify(profile)}\n`);
    const env = {
        ...envFor(t),
        // switch del panel: ON → inyecta el buró (salta la consulta real); OFF → sin inyección (consulta real).
        E2E_INJECT: inject ? '1' : '',
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
    return { ok: true, msg: `lanzado '${slug}' (${t}) — ${mode}. Login → monto; manejás vos desde ahí.` };
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

    if (path === '/api/launch' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.slug) return json(res, 400, { ok: false, msg: 'falta slug del comercio' });
        return json(res, 200, launch(String(b.slug), {
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
        }, String(b.target || 'local'), b.inject !== false));
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

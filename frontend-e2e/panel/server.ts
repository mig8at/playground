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
const LOCAL_ENV = { ...process.env, E2E_TARGET: 'local', CFE_TARGET: 'local' };

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

// dbops list <q> → JSON (comercios que matchean). E2E_TARGET=local.
function dbopsList(q: string): Promise<any[]> {
    return new Promise((ok) => {
        execFile('node', ['bin/dbops.ts', 'list', q], { cwd: ROOT, env: LOCAL_ENV, timeout: 15000 }, (err, stdout) => {
            if (err) return ok([]);
            try { ok(JSON.parse(stdout)); } catch { ok([]); }
        });
    });
}

// lanza `bin/asesor <slug> auto` (assign + scrub + guiado; inyecta buró en personal-info) con el perfil por env.
interface Profile { income?: number; score?: number; name?: string; documentType?: string; document?: string; gender?: string; age?: number; negatives?: number; consulted?: number; }

function launch(slug: string, profile: Profile): { ok: boolean; msg: string } {
    if (current && !current.done) return { ok: false, msg: `ya hay una corrida activa (${current.slug}). Parala primero.` };
    writeFileSync(RUN_LOG, `▶ lanzando '${slug}' (local) · perfil ${JSON.stringify(profile)}\n`);
    const env = {
        ...LOCAL_ENV,
        E2E_SYNTH_INCOME: profile.income ? String(profile.income) : '',
        E2E_SYNTH_SCORE: profile.score ? String(profile.score) : '',
        E2E_SYNTH_NAME: profile.name || '',
        E2E_SYNTH_DOCTYPE: profile.documentType || '',
        E2E_SYNTH_DOC: profile.document || '',
        E2E_SYNTH_GENDER: profile.gender || '',
        E2E_SYNTH_AGE: profile.age ? String(profile.age) : '',
        E2E_SYNTH_NEG: profile.negatives != null ? String(profile.negatives) : '',
        E2E_SYNTH_CONS: profile.consulted != null ? String(profile.consulted) : '',
    };
    const child = spawn('/bin/bash', [join(ROOT, 'bin', 'asesor'), slug, 'auto'], { cwd: ROOT, env });
    current = { child, slug, startedAt: Date.now(), done: false, code: null };
    const append = (b: Buffer) => { try { writeFileSync(RUN_LOG, b.toString(), { flag: 'a' }); } catch {} };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code) => { if (current) { current.done = true; current.code = code; } append(Buffer.from(`\n✓ corrida terminada (code ${code})\n`)); });
    return { ok: true, msg: `lanzado '${slug}' — mirá el browser (login → monto)` };
}

function tailLog(): string {
    if (!existsSync(RUN_LOG)) return '';
    // sin colores ANSI, últimas ~120 líneas
    const raw = readFileSync(RUN_LOG, 'utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    return raw.split('\n').slice(-120).join('\n');
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
        if (!q) return json(res, 200, []);
        return json(res, 200, await dbopsList(q));
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
        }));
    }

    if (path === '/api/status') {
        return json(res, 200, {
            running: !!(current && !current.done),
            slug: current?.slug ?? null,
            code: current?.done ? current?.code : null,
            log: tailLog(),
        });
    }

    if (path === '/api/stop' && req.method === 'POST') {
        if (current && !current.done) { try { current.child.kill('SIGTERM'); } catch {} return json(res, 200, { ok: true }); }
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
    console.log(`\n  🎛  Panel del harness → http://localhost:${PORT}   (SOLO local)\n`);
});

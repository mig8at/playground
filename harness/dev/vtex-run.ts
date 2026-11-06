/**
 * vtex-run.ts — LA TIENDA VTEX DE PUNTA A PUNTA, sin nadie en el checkout (`make harness-vtex TARGET=qa`).
 *
 * Cada caso es una compra real en la tienda de pruebas `creditop` pagada con Creditop:
 *   1. el caminador (`dev/walk-wizard.ts --store vtex`) compra por la API de Checkout con la identidad del caso, entra al
 *      wizard de qa por el `?ref=` que devuelve el checkout, pasa el OTP (bypass) y llega al listado de entidades;
 *   2. acá se le da el DESENLACE: el simulador de qa (como si contestara la entidad) o la cancelación desde la tienda;
 *   3. se espera a VTEX y se comprueba en qué quedó la transacción, cuánto tardó el primer authorize del conector y si
 *      hubo `ProxyTimeout`, una cancelación negada o un resultado ignorado.
 *
 * Los casos (`CASES=`, separados por coma; por defecto todos):
 *   aprobada          simulador → 11 · VTEX: Approved
 *   negada            simulador → 6  · VTEX: Cancelled (authorize negado)
 *   cancelada         simulador → 8  · VTEX: Cancelled
 *   tienda-cancela    la solicitud sigue viva y la tienda cancela el pedido · VTEX: Cancelled, con la cancelación
 *                     aprobada por el conector (la 5.0.0 la negaba y quedaba en Cancelling)
 *
 * ESCRIBE: pedidos reales en la cuenta VTEX de pruebas y, por el conector y el wizard, pedidos, usuarios y solicitudes en
 * la base compartida de qa (igual que una compra a mano). La sucursal la fija la afiliación de VTEX que usa la condición de
 * pago activa (`activeBranchHash`): hoy `ecf9342be`, o la de la copia de Mario si alguien apuntó la condición ahí.
 * Salida: 0 todos bien · 1 alguno mal · 2 no se pudo correr.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, TARGET } from '../pkg/env.ts';
import { activeBranchHash, cancelVtexOrder, connectorVersions, readVtex, waitVtex, type VtexState } from '../pkg/vtex.ts';
import { one, close } from '../pkg/db.ts';

const arg = (n: string, d = '') => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
// La sucursal la decide la afiliación de la condición de pago activa; --branch la fuerza (y si no coincide, el caminador avisa).
const active = arg('branch') ? null : await activeBranchHash();
const BRANCH = arg('branch') || active!.hash;
const JSON_OUT = process.env.JSON === '1';
const out = (s: string) => (JSON_OUT ? process.stderr : process.stdout).write(s + '\n');

type CaseName = 'aprobada' | 'negada' | 'cancelada' | 'tienda-cancela';
const CASES: Record<CaseName, { status?: number; expect: (s: VtexState) => boolean; want: string }> = {
    aprobada:        { status: 11, want: 'Approved', expect: (s) => /^(Approved|Settling|Settled|Finished)$/.test(s.txStatus) },
    negada:          { status: 6,  want: 'Cancelled', expect: (s) => s.txStatus === 'Cancelled' },
    cancelada:       { status: 8,  want: 'Cancelled', expect: (s) => s.txStatus === 'Cancelled' },
    'tienda-cancela': { want: 'Cancelled con la cancelación aprobada', expect: (s) => s.txStatus === 'Cancelled' },
};

if (TARGET !== 'qa') { console.error(`✗ la tienda VTEX de pruebas paga contra qa: TARGET=qa (vino ${TARGET})`); process.exit(2); }
const names = (arg('cases') || Object.keys(CASES).join(',')).split(',').map((s) => s.trim()).filter(Boolean) as CaseName[];
const unknown = names.filter((n) => !CASES[n]);
if (unknown.length) { console.error(`✗ casos desconocidos: ${unknown.join(', ')} · los que hay: ${Object.keys(CASES).join(', ')}`); process.exit(2); }

// La versión del conector que atiende (el de `master`, adonde apunta la afiliación) es parte del resultado: sin ella no se
// sabe qué se midió.
const versions = await connectorVersions().catch((e) => { out(`  ⚠ no se pudo leer la versión del conector: ${e.message}`); return []; });
const serving = versions.find((v) => v.workspace === 'master');
out(`  conector: ${versions.map((v) => `${v.workspace} ${v.version} (${v.source === 'link' ? 'linkeada' : v.source === 'installation' ? 'publicada' : v.source})`).join(' · ')}`);
out(`  ${names.length} compra(s) en la tienda VTEX → qa, sucursal ${BRANCH}${active ? ` (afiliación «${active.affiliation}» de la condición «${active.rule}»)` : ''}: ${names.join(', ')}\n`);

// ── 1 · las compras y el wizard, en paralelo, por el caminador ──
const dir = mkdtempSync(join(tmpdir(), 'vtex-run-'));
const resultFile = join(dir, 'walk.json');
const t0 = Date.now();
try {
    const walk = execFileSync(process.execPath, ['dev/walk-wizard.ts', '--flow', 'ecommerce', '--store', 'vtex', '--parallel',
        '--cases', names.map(() => `#${BRANCH}`).join(';'), '--result-file', resultFile],
        { encoding: 'utf8', env: { ...process.env, E2E_TARGET: 'qa' }, timeout: 15 * 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (process.env.VERBOSE === '1') out(walk);
} catch (e: any) {
    // El caminador sale ≠ 0 si un caso no llegó al listado; igual se sigue con los que sí.
    if (process.env.VERBOSE === '1') out(String(e.stdout ?? '') + String(e.stderr ?? ''));
}
let walked: any[] = [];
try { walked = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { console.error('✗ el caminador no dejó resultados: corré con VERBOSE=1 para ver por qué'); process.exit(2); }

// ── 2 · el desenlace de cada caso, y 3 · lo que quedó en VTEX ──
const simulator = env('E2E_API_BASE_URL').replace(/\/api\/?$/, '') + '/simulator/aggregator-result';
type Outcome = { caso: CaseName; ok: boolean; orderId: string | null; ur: number | null; authorizeMs: number | null; vtex: string; creditop: number | null; notes: string[] };

async function finish(name: CaseName, w: any): Promise<Outcome> {
    const o: Outcome = { caso: name, ok: false, orderId: w?.vtex?.orderId ?? null, ur: w?.ur ?? null, authorizeMs: null, vtex: '—', creditop: null, notes: [] };
    if (!o.orderId) { o.notes.push(`no hubo pedido VTEX: ${w?.motivo || 'el caminador no llegó a comprar'}`); return o; }
    const first = await readVtex(o.orderId);
    o.authorizeMs = first.firstAuthorizeMs;
    if (first.proxyTimeout) o.notes.push('ProxyTimeout en el authorize: el comprador habría vuelto al checkout');
    if (o.authorizeMs !== null && o.authorizeMs > 1500) o.notes.push(`authorize lento: ${(o.authorizeMs / 1000).toFixed(1)}s`);
    if (!o.ur) { o.notes.push(`no llegó a haber solicitud: ${w.motivo || '?'}`); o.vtex = first.txStatus; return o; }

    const c = CASES[name];
    if (c.status) {
        const r = await fetch(simulator, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ user_request_id: o.ur, status: c.status }) });
        if (!r.ok) { o.notes.push(`el simulador dio ${r.status}`); return o; }
    } else {
        await cancelVtexOrder(o.orderId);
    }
    const waited = await waitVtex(o.orderId, (s) => c.expect(s) || (name === 'tienda-cancela' && !!s.cancelDenied), 150_000);
    const s = waited.state;
    o.vtex = s.txStatus;
    o.creditop = (await one<{ st: number }>('SELECT user_request_status_id AS st FROM user_requests WHERE id = ?', [o.ur]).catch(() => null))?.st ?? null;
    o.ok = c.expect(s);
    if (name === 'tienda-cancela') {
        if (s.cancelDenied) { o.ok = false; o.notes.push(`el conector NEGÓ la cancelación (${s.cancelDenied}): la transacción queda en ${s.txStatus}`); }
        else if (s.cancelApproved) o.notes.push('el conector aprobó la cancelación');
        if (o.creditop !== null && ![6, 7, 8, 11].includes(o.creditop)) o.notes.push(`la solicitud ${o.ur} sigue viva en Creditop (estado ${o.creditop}): falta la regla de producto`);
    }
    if (s.ignoredResult) o.notes.push('VTEX ignoró un segundo resultado («cannot advance from Cancelled»)');
    if (!o.ok && !waited.ok) o.notes.push(`VTEX no llegó a ${c.want} en 150 s`);
    return o;
}

const byIndex = walked.map((w, i) => ({ w, name: names[i] }));
const outcomes = await Promise.all(byIndex.map(({ w, name }) => finish(name, w).catch((e) => ({ caso: name, ok: false, orderId: w?.vtex?.orderId ?? null, ur: w?.ur ?? null,
    authorizeMs: null, vtex: '?', creditop: null, notes: [`falló al comprobar: ${e.message}`] } as Outcome))));
await close().catch(() => {});

for (const o of outcomes) {
    out(`  ${o.ok ? '✓' : '✗'} ${o.caso.padEnd(15)} pedido ${o.orderId ?? '—'} · uReq ${o.ur ?? '—'} · authorize ${o.authorizeMs !== null ? (o.authorizeMs / 1000).toFixed(1) + 's' : '—'} · VTEX ${o.vtex} · Creditop ${o.creditop ?? '—'}`);
    for (const n of o.notes) out(`      ${n}`);
}
const okCount = outcomes.filter((o) => o.ok).length;
out(`\n  ${okCount}/${outcomes.length} bien · ${((Date.now() - t0) / 1000).toFixed(0)}s · conector master ${serving?.version ?? '?'}`);
if (JSON_OUT) process.stdout.write(JSON.stringify({ schema: 'harness.vtex/v1', target: TARGET, branch: BRANCH, connector: versions, ok: okCount === outcomes.length, cases: outcomes }) + '\n');
process.exit(okCount === outcomes.length ? 0 : 1);

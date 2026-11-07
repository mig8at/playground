// RECETA · una compra en VTEX pagada con Creditop, llevada AL DESENLACE de crédito por API, para ver cómo se comporta
// VTEX sin recorrer el wizard a mano (~1 min).
//
//   make jarvis-recipe APP=vtex RECIPE=credit-outcome                          aprobada: la solicitud en 11
//   make jarvis-recipe APP=vtex RECIPE=credit-outcome ARGS='--outcome negada'  o cancelada, o tienda-cancela
//
// Es `make harness-vtex TARGET=qa CASES=<desenlace>` (harness/dev/vtex-run.ts), que ya hace todo lo rápido: compra por
// la API de Checkout, el caminador por HTTP lleva la solicitud hasta el listado de entidades (sin navegador, ~25 s) y el
// SIMULADOR de qa (`POST /simulator/aggregator-result {user_request_id, status}`) contesta como la entidad: 11
// aprobada, 6 negada, 8 cancelada. Con `tienda-cancela` la solicitud sigue viva y es la tienda la que cancela el
// pedido. Después espera a VTEX y muestra el pedido con la receta `order` (su pago y lo que contestó el conector).
// Medido el 2026-11-07: aprobada en 50 s, de la compra a VTEX Approved (34 s del lado de VTEX).
// ⚠ Sólo contra qa: la condición de pago de la tienda manda el pago a qa. La sucursal es la de la afiliación activa
// (`bin/jarvis recipe vtex creditop-payment` dice cuál).
// ESCRIBE en VTEX (un pedido de la cuenta de pruebas) y en la base compartida de qa (el pedido, el cliente sintético y
// su solicitud), como cualquier compra de `make harness-vtex`. El pedido no se cancela solo, salvo en los desenlaces
// que cancelan.
import '../args.ts';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUTCOMES = ['aprobada', 'negada', 'cancelada', 'tienda-cancela'];
const outcome = flag('outcome') || 'aprobada';
if (!OUTCOMES.includes(outcome)) {
    console.error(`  ✗ --outcome ${outcome}: ${OUTCOMES.join(', ')}`);
    process.exit(2);
}
const say = (s: string) => console.log(`  ${s}`);
const run = promisify(execFile);

say(`compra en VTEX → solicitud en qa → desenlace «${outcome}» (por el simulador de qa) → VTEX`);
const t0 = Date.now();
let res: any;
try {
    const { stdout } = await run('node', ['dev/vtex-run.ts', '--cases', outcome], {
        cwd: path.join(ROOT, 'harness'), env: { ...process.env, E2E_TARGET: 'qa', JSON: '1' }, timeout: 10 * 60_000, maxBuffer: 10 << 20,
    });
    res = JSON.parse(stdout.trim().split('\n').pop()!);
} catch (e: any) {
    // vtex-run sale 1 si el desenlace no fue el esperado: igual imprime su JSON.
    const last = String(e.stdout ?? '').trim().split('\n').pop();
    try { res = JSON.parse(last!); } catch { console.error(`  ✗ ${String(e.stderr || e.message).split('\n').slice(-3).join(' ')}`); process.exit(2); }
}
const c = res.cases?.[0];
if (!c) { console.error('  ✗ el runner no devolvió el caso'); process.exit(2); }
say(`${c.ok ? '✓' : '✗'} pedido ${c.orderId ?? '—'} · solicitud ${c.ur ?? '—'} en estado ${c.creditop ?? '?'} · VTEX ${c.vtex} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const n of c.notes ?? []) say(`  · ${n}`);
if (c.orderId) {
    console.log('');
    const { stdout } = await run('node', [path.join(HERE, 'order.ts'), c.orderId], { timeout: 60_000 });
    process.stdout.write(stdout);
}
process.exit(c.ok ? 0 : 1);

// LOCAL, reversible: fabrica un lender rt=2 SINTÉTICO "cerrable por UI" clonando uno que YA lista
// (por defecto #77 CrediPullman en Pullman), pero con min_initial_fee>0 en TODAS sus categorías.
//
// POR QUÉ: el cierre rt=2 → loan-approved por UI estaba bloqueado no por el checkout de Wompi
// (`pkg/wompi-mock.ts` ya lo intercepta) sino por el MOTOR DE SCORING: a un perfil aprobado el motor SQL
// le asigna una categoría con min_initial_fee=0 → cuota inicial $0 → botón "Pagar" disabled → el redirect
// a Wompi (que el mock interceptaría) nunca se dispara. Poner el fee en UNA categoría no alcanza porque no
// sabés cuál asigna el motor. Solución: clonar el lender y poner fee>0 en TODAS las categorías → sea cual
// sea la asignada, la cuota da >0 → el flujo llega a Wompi → mock → down-payment-validation → … → loan-approved.
//
//   node close-lender.ts                 crea el lender sintético (SRC=77, fee=15%)
//   node close-lender.ts --src 96 --fee 20 --slug cierre-celupresto
//   node close-lender.ts --clean         borra los sintéticos que creó este script
//
// Idempotente por slug. Data SINTÉTICA local (no toca #77 ni el mirror real). Espejo del cierre backend
// `go run . asesor 3e67eade 77` — ahora replicable por UI.
import { query, exec, assertWriteAllowed } from './pkg/db.ts';

assertWriteAllowed();
const arg = (name: string, def?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };
const SRC = Number(arg('--src', '77'));            // lender rt=2 que YA lista (molde)
const FEE = Number(arg('--fee', '15'));            // min_initial_fee % a forzar en TODAS las categorías (>0)
const SLUG = arg('--slug', 'cierre-x-test')!;      // slug del sintético (idempotente)
const NAME = arg('--name', 'Cierre X (test)')!;
const CLEAN_ONLY = process.argv.includes('--clean');

async function purge(lenderId: number) {
  for (const t of ['lender_users_category_rules', 'lender_users_categories', 'lender_datacredito_rules', 'lender_rules', 'lenders_by_allied_branches', 'lenders_by_allieds', 'credit_line_by_lenders'])
    await exec(`DELETE FROM ${t} WHERE lender_id=?`, [lenderId]);
  await exec('DELETE FROM lenders WHERE id=?', [lenderId]);
}
async function cloneRow(table: string, row: any, overrides: Record<string, any>): Promise<number> {
  const r: any = { ...row, ...overrides };
  delete r.id;
  const cols = Object.keys(r);
  const vals = cols.map(c => (r[c] !== null && typeof r[c] === 'object') ? JSON.stringify(r[c]) : r[c]);
  const res: any = await exec(`INSERT INTO \`${table}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
  return res.insertId;
}

// ── cleanup idempotente (borra cualquier sintético con este slug) ──
for (const p of await query<any>('SELECT id FROM lenders WHERE slug=?', [SLUG])) await purge(p.id);
if (CLEAN_ONLY) { console.log(`✓ limpieza hecha (slug=${SLUG} borrado)`); process.exit(0); }

// ── molde: TODA la config del SRC (el que lista) ──
const [srcLender] = await query<any>('SELECT * FROM lenders WHERE id=?', [SRC]);
if (!srcLender) { console.error(`✗ lender src #${SRC} no existe`); process.exit(1); }
if (srcLender.response_type !== 2 && srcLender.response_type !== 3) console.warn(`⚠ #${SRC} tiene response_type=${srcLender.response_type} (esperaba 2/3 in-platform)`);
const srcByAllied = await query<any>('SELECT * FROM lenders_by_allieds WHERE lender_id=?', [SRC]);
const srcByBranch = await query<any>('SELECT * FROM lenders_by_allied_branches WHERE lender_id=?', [SRC]);
const srcCLBL = await query<any>('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [SRC]);
const srcCats = await query<any>('SELECT * FROM lender_users_categories WHERE lender_id=?', [SRC]);
const srcCatRules = await query<any>('SELECT * FROM lender_users_category_rules WHERE lender_id=?', [SRC]);
const srcDc = await query<any>('SELECT * FROM lender_datacredito_rules WHERE lender_id=?', [SRC]);
const srcLr = await query<any>('SELECT * FROM lender_rules WHERE lender_id=?', [SRC]);

// ── clonar ──
const id = await cloneRow('lenders', srcLender, { name: NAME, slug: SLUG });
for (const a of srcByAllied) await cloneRow('lenders_by_allieds', a, { lender_id: id });          // misma(s) asociación(es) que el SRC → lista donde el SRC lista
for (const b of srcByBranch) await cloneRow('lenders_by_allied_branches', b, { lender_id: id });
for (const cl of srcCLBL) await cloneRow('credit_line_by_lenders', cl, { lender_id: id });
const catMap: Record<number, number> = {};
for (const c of srcCats) catMap[c.id] = await cloneRow('lender_users_categories', c, { lender_id: id, min_initial_fee: FEE }); // ← fee>0 en TODAS
for (const r of srcCatRules) await cloneRow('lender_users_category_rules', r, { lender_id: id, lender_users_category_id: catMap[r.lender_users_category_id] });
for (const d of srcDc) await cloneRow('lender_datacredito_rules', d, { lender_id: id });
for (const r of srcLr) await cloneRow('lender_rules', r, { lender_id: id });

const allieds = srcByAllied.map((a: any) => a.allied_id).join(',');
console.log(`✓ lender sintético #${id} "${NAME}" (slug=${SLUG}, rt=${srcLender.response_type}) clonado de #${SRC}`);
console.log(`  · asociado a allied(s) [${allieds}] · ${srcCats.length} categorías con min_initial_fee=${FEE}% (>0) · ${srcCatRules.length} reglas de categoría · ${srcDc.length} datacrédito · ${srcLr.length} group-rules`);
console.log(`  → con un perfil aprobado el marketplace lo OFRECE; al seleccionarlo la cuota inicial da >0 → llega a Wompi (mock) → cierre in-platform. Cerrá con: node close-lender.ts --clean`);
process.exit(0);

// LOCAL, reversible: crea 3 lenders de prueba asociados a Motai (branch 682), clonando la config de
// listado del 62 "Motai X" (rt=2 que SÍ lista) para que los 3 aparezcan; cada uno con su product/calculator.
//   Motai C  → credit  (identidad)          Motai R → renting          Motai RB → rto (opción de compra)
// Idempotente por slug. Data SINTÉTICA local (dev no tiene esta config). Revierte también la fabricación en 158.
// Cleanup total: node create3.ts --clean
import { query, exec, assertWriteAllowed } from './pkg/db.ts';

assertWriteAllowed();
const SRC = 62, BRANCH = 682, ALLIED = 158;
const SLUGS = ['motai-c', 'motai-r', 'motai-rb'];
const CLEAN_ONLY = process.argv.includes('--clean');

// Fórmulas del "Calculadora Renting VF.xlsx" (ver examples/motai.html).
// Renting: precio de venta = (monto + alistamiento) * 2 * (1+IVA).
const RENT_CALC = { params: { setup_fee: 1500000, margin: 1.0, tax: 0.19 }, formulas: { amount: '(amount + setup_fee) * (1 + margin) * (1 + tax)' } };
// RTO: valor a financiar = (2*(monto - cuota_inicial + alistamiento) + extras) * (1+IVA).
// OJO: cuota_inicial es input del request y aún NO se pasa a la calculadora → acá va con cuota_inicial=0 (aprox).
const RTO_CALC = { params: { setup_fee: 1500000, rto_extras: 1000000, tax: 0.19 }, formulas: { amount: '(2 * (amount + setup_fee) + rto_extras) * (1 + tax)' } };
const LENDERS = [
  { name: 'Motai C',  slug: 'motai-c',  product: 'credit',  abaco: 0, docs: ['CC', 'CE'],        calculator: null },       // credit: card estándar, R1–R8 no aplican
  { name: 'Motai R',  slug: 'motai-r',  product: 'renting', abaco: 1, docs: ['CC', 'CE', 'PEP'], calculator: RENT_CALC },  // Ábaco ON (proto)
  { name: 'Motai RB', slug: 'motai-rb', product: 'rto',     abaco: 0, docs: ['CC', 'CE', 'PEP'], calculator: RTO_CALC },   // Ábaco OFF (proto)
];

async function cloneRow(table: string, row: any, overrides: Record<string, any>): Promise<number> {
  const r: any = { ...row, ...overrides };
  delete r.id;
  const cols = Object.keys(r);
  const vals = cols.map(c => (r[c] !== null && typeof r[c] === 'object') ? JSON.stringify(r[c]) : r[c]);
  const res: any = await exec(`INSERT INTO \`${table}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
  return res.insertId;
}

async function purge(lenderId: number) {
  for (const t of ['lender_users_category_rules', 'lender_users_categories', 'lender_datacredito_rules', 'lender_rules', 'lenders_by_allied_branches', 'lenders_by_allieds', 'credit_line_by_lenders'])
    await exec(`DELETE FROM ${t} WHERE lender_id=?`, [lenderId]);
  await exec('DELETE FROM lenders WHERE id=?', [lenderId]);
}

// ── cleanup idempotente ──
// revertir la fabricación previa en 158 (lo dejamos como estaba: 0 categorías/reglas)
await exec('DELETE FROM lender_users_category_rules WHERE lender_id=158');
await exec('DELETE FROM lender_users_categories WHERE lender_id=158');
await exec('DELETE FROM lender_datacredito_rules WHERE lender_id=158 AND allied_branch_id IS NULL');
// borrar cualquier motai-c/r/rb previo
for (const s of SLUGS) {
  const prev: any[] = await query('SELECT id FROM lenders WHERE slug=?', [s]);
  for (const p of prev) await purge(p.id);
}
if (CLEAN_ONLY) { console.log('✓ limpieza hecha (158 revertido + motai-c/r/rb borrados)'); process.exit(0); }

// ── plantillas del 62 ──
const [srcLender]: any[] = await query('SELECT * FROM lenders WHERE id=?', [SRC]);
const [srcBranch]: any[] = await query('SELECT * FROM lenders_by_allied_branches WHERE lender_id=? AND allied_branch_id=?', [SRC, BRANCH]);
const [srcAllied]: any[] = await query('SELECT * FROM lenders_by_allieds WHERE lender_id=? AND allied_id=?', [SRC, ALLIED]);
const srcCLBL: any[] = await query('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [SRC]); // relación creditLines (max_fee_number/max_amount)
const srcCats: any[] = await query('SELECT * FROM lender_users_categories WHERE lender_id=?', [SRC]);
const srcCatRules: any[] = await query('SELECT * FROM lender_users_category_rules WHERE lender_id=?', [SRC]);
const srcDc: any[] = await query('SELECT * FROM lender_datacredito_rules WHERE lender_id=? AND (allied_branch_id IS NULL OR allied_branch_id=?)', [SRC, BRANCH]);
const srcLr: any[] = await query('SELECT lr.* FROM lender_rules lr JOIN group_rules gr ON gr.id=lr.group_rule_id WHERE lr.lender_id=? AND gr.allied_branch_id=?', [SRC, BRANCH]);

for (const spec of LENDERS) {
  const id = await cloneRow('lenders', srcLender, { name: spec.name, slug: spec.slug, product: spec.product, abaco: spec.abaco, calculator: spec.calculator });
  await cloneRow('lenders_by_allied_branches', srcBranch, { lender_id: id, document_types: spec.docs });
  if (srcAllied) await cloneRow('lenders_by_allieds', srcAllied, { lender_id: id });   // config por-comercio (sort/calculadora)
  for (const cl of srcCLBL) await cloneRow('credit_line_by_lenders', cl, { lender_id: id }); // creditLines (max_fee_number/max_amount)
  const catMap: Record<number, number> = {};
  for (const c of srcCats) catMap[c.id] = await cloneRow('lender_users_categories', c, { lender_id: id });
  for (const r of srcCatRules) await cloneRow('lender_users_category_rules', r, { lender_id: id, lender_users_category_id: catMap[r.lender_users_category_id] });
  for (const d of srcDc) await cloneRow('lender_datacredito_rules', d, { lender_id: id });
  for (const row of srcLr) await cloneRow('lender_rules', row, { lender_id: id });
  console.log(`✓ ${spec.name}  id=${id}  product=${spec.product}  docs=${spec.docs.join('/')}  (${srcCats.length} cats, ${srcDc.length} dc, ${srcLr.length} group-rules)`);
}
console.log('\nlisto — 3 lenders en branch 682 (f0548728). Probá con un ur de esa sucursal.');
process.exit(0);

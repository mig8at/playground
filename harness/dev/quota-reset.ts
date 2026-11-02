// quota-reset.ts — reinicia el cupo mensual de los perfiles CreditopX en la base LOCAL.
//
//   make harness-quota-reset TARGET=local [LENDER=169] [APPLY=1]
//
// POR QUÉ EXISTE. Cada crédito CreditopX que una corrida cierra suma su monto a `already_used_loan` del
// perfil (`creditopx-quota` en knowledge/), y el reinicio del día 1 lo agenda el scheduler de
// legacy-application, que en local no corre. Con el tiempo, las suites que cierran agotan la bolsa del mes
// y el cupo de cualquier cliente nuevo sale `profile_quota_exhausted` (medido el 2026-11-02 en Motai R).
//
// Qué hace: pone en 0 lo colocado de los perfiles agotados o con uso (o sólo los de LENDER), que es lo que
// deja el reinicio del mes. NO escribe el evento `month_reset` en `creditop_x_quota_events` ni quita el
// override del período: no reemplaza a `MonthlyQuotaResetService`, sólo devuelve la base de pruebas a un
// estado donde el cupo depende del caso. Sin APPLY sólo muestra. Sólo local: en cualquier otro ambiente sale.
export {};
const { TARGET, isLocalDb, query, exec, close } = await import('../pkg/db.ts');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const lenderArg = args.includes('--lender') ? Number(args[args.indexOf('--lender') + 1]) : null;

if (TARGET !== 'local' || !isLocalDb()) {
    console.error(`  ✗ sólo en local: el target es ${TARGET}. El cupo de los ambientes compartidos lo maneja el reinicio del mes.`);
    process.exit(2);
}

const where = lenderArg ? 'c.lender_id = ? AND c.already_used_loan > 0' : 'c.already_used_loan > 0';
const rows = await query<{ id: number; lender: string; perfil: string; usado: number; tope: number }>(
    `SELECT c.id, l.name AS lender, c.name AS perfil, c.already_used_loan AS usado,
            COALESCE(c.period_loan_limit, c.loan_limit) AS tope
       FROM lender_users_categories c JOIN lenders l ON l.id = c.lender_id
      WHERE ${where} ORDER BY l.name, c.name`, lenderArg ? [lenderArg] : []);

if (!rows.length) {
    console.log('  ✓ ningún perfil tiene cupo colocado: no hay nada que reiniciar');
    await close();
    process.exit(0);
}
for (const r of rows) {
    const full = Number(r.tope) > 0 && Number(r.usado) >= Number(r.tope);
    console.log(`  ${full ? '⚠ agotado' : '· con uso '}  ${r.lender} · ${r.perfil}: $${Number(r.usado).toLocaleString('es-CO')} de $${Number(r.tope).toLocaleString('es-CO')}`);
}
if (!apply) {
    console.log(`\n  ${rows.length} perfil(es). Sin APPLY=1 no se escribe nada.`);
} else {
    const ids = rows.map((r) => r.id);
    const done = await exec(`UPDATE lender_users_categories SET already_used_loan = 0 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    console.log(`\n  ✓ cupo reiniciado en ${done.affectedRows} perfil(es) de la base local`);
}
await close();

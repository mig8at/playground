// ESCRIBE · prende (o apaga) una entidad en un punto de venta de un comercio, por la matriz de activaciones del
// backoffice nuevo: lo mismo que el interruptor de «Activaciones» de la ficha del comercio.
//
//   make jarvis-recipe APP=backoffice RECIPE=activation ARGS='368 --lender 149 --branch pa1110f50-fake'
//   make jarvis-recipe APP=backoffice RECIPE=activation ARGS='BUSINESS_FINANDINA --lender 149 --branch 2251 --off'
//
// ESCRIBE `lenders_by_allied_branches.status` en la base que comparten dev, qa y staging (`PUT
// /api/backoffice/merchants/<id>/activations`, `{enable|disable: [{lenderId, branchIds}]}`), con tu sesión.
// ⚠ Antes de escribir lee la celda: si el backoffice dice que no se puede prender (falta la credencial, un requisito),
// no escribe y dice por qué. Una entidad agregada por el admin viejo queda APAGADA hasta que alguien la prende acá
// (Finandina en la sucursal del asesor de prueba de 368, 2026-11-20).
// ⚠ Necesita una sesión del backoffice en tu Chrome, y no corre si otra sesión de Jarvis está manejando Chrome.
import '../args.ts';
import { dataOf, errorOf, findMerchant, openBackoffice } from './api.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const off = argv.includes('--off');
const JSON_OUT = argv.includes('--json');
const ref = argv.find((a, i) => !a.startsWith('--') && !['--lender', '--branch'].includes(argv[i - 1]));
const lenderId = Number(flag('lender'));
const branchRef = flag('branch');
if (!ref || !lenderId || !branchRef) {
    console.error('uso: <comercio> --lender <id> --branch <id|nombre|hash> [--off] [--json]');
    process.exit(2);
}

const { call, close } = await openBackoffice('dev');
let failed = false;
try {
    const merchant = await findMerchant(call, ref);
    const read = async () => {
        const r = await call('GET', `/api/backoffice/merchants/${merchant.id}/activations`);
        if (!r.ok) throw new Error(`no se leyeron las activaciones (${r.status}): ${errorOf(r)}`);
        return (dataOf(r) as any).activations;
    };
    const before = await read();
    const branch = (before.branches ?? []).find((b: any) => String(b.id) === branchRef || b.name === branchRef || b.hash === branchRef);
    if (!branch) throw new Error(`el comercio ${merchant.id} no tiene el punto de venta «${branchRef}» (tiene: ${(before.branches ?? []).map((b: any) => `${b.id} ${b.name}`).join(', ')})`);
    const cellOf = (a: any) => (a.cells ?? []).find((c: any) => c.lenderId === lenderId && c.branchId === branch.id);
    const cell = cellOf(before);
    if (!cell) throw new Error(`la entidad ${lenderId} no está agregada al comercio ${merchant.id} (agregala primero)`);
    const say = (s: string) => { if (!JSON_OUT) console.log(s); };
    say(`  ${merchant.name} (${merchant.id}) · entidad ${lenderId} en ${branch.id} «${branch.name}»: ${cell.on ? 'PRENDIDA' : 'apagada'}`);
    if (cell.on === !off) {
        say(`  ya estaba ${off ? 'apagada' : 'prendida'}: no se escribió nada`);
    } else if (!off && cell.canEnable === false) {
        failed = true;
        say(`  ✗ el backoffice no la deja prender: ${cell.reason ?? 'sin motivo'}${cell.missing?.length ? ` (falta: ${cell.missing.join(', ')})` : ''}`);
    } else {
        const body = { [off ? 'disable' : 'enable']: [{ lenderId, branchIds: [branch.id] }] };
        const r = await call('PUT', `/api/backoffice/merchants/${merchant.id}/activations`, body);
        if (!r.ok) { failed = true; say(`  ✗ no se aplicó (${r.status}): ${errorOf(r)}`); }
        const after = cellOf(await read());
        failed ||= !!after && after.on === off;
        say(`  ${after?.on ? '✓ PRENDIDA' : '○ apagada'} ahora${after?.reason && !after.on ? ` · ${after.reason}` : ''}`);
        if (JSON_OUT) console.log(JSON.stringify({ merchant: merchant.id, branch: branch.id, lenderId, before: cell, after, result: dataOf(r) }, null, 2));
    }
} catch (e) {
    failed = true;
    console.error(`  ✗ ${(e as Error).message}`);
} finally {
    await close();
}
process.exit(failed ? 1 : 0);

// Prende el 4x1000 en el perfil del riel 4 de Banco Finandina (149) en qa: el simulador de Finandina («Simulacion Aval
// Libre Inversion FGA», Drive, 2026-11-23) cobra 4x1000 sobre el aval con IVA, y el perfil lo tenía apagado.
// Escribe en la base COMPARTIDA (dev/qa/staging): pide I_KNOW_THIS_TOUCHES_SHARED_DEV.
//   cd harness && E2E_TARGET=qa I_KNOW_THIS_TOUCHES_SHARED_DEV=1 node ../tablero/tasks/finandina-originacion/artifacts/qa-149-4x1000.ts
// Deshacer: UPDATE delegated_origination_profiles SET applies_four_per_thousand = 0, updated_at = NOW() WHERE lender_id = 149;
import { TARGET, one, withConnection } from '../../../../harness/pkg/db.ts';

if (TARGET !== 'qa') throw new Error(`sólo qa (E2E_TARGET=${TARGET})`);
if (!process.env.I_KNOW_THIS_TOUCHES_SHARED_DEV) throw new Error('escribe en la base compartida: exportá I_KNOW_THIS_TOUCHES_SHARED_DEV');

const LENDER = 149;
const read = () =>
    one<{ id: number; applies_four_per_thousand: number }>(
        'SELECT id, applies_four_per_thousand FROM delegated_origination_profiles WHERE lender_id = ?',
        [LENDER],
    );

const before = await read();
if (!before) throw new Error(`la ${LENDER} no tiene perfil del riel 4`);
console.log('antes:', before);

if (Number(before.applies_four_per_thousand) === 1) {
    console.log('ya estaba prendido: no se escribe nada');
} else {
    await withConnection(async (c) => {
        const [r]: any = await c.query(
            'UPDATE delegated_origination_profiles SET applies_four_per_thousand = 1, updated_at = NOW() WHERE lender_id = ? AND applies_four_per_thousand = 0',
            [LENDER],
        );
        console.log('filas cambiadas:', r.affectedRows);
    });
}

console.log('después:', await read());
process.exit(0);

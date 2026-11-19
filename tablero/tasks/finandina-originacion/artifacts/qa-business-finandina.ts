// Crea en QA el comercio BUSINESS_FINANDINA, sólo con Banco Finandina (149), copiando de Mediarte (91 · sucursal 375)
// lo que Finandina necesita: el comercio y sus flags, una sucursal «Principal», la 149 en el comercio y la sucursal, y
// sus reglas duras. NO copia otras entidades, VTEX ni la periodicidad de Experian, y NO lo agrega a kyc_pipeline_allieds:
// va por el flujo viejo, como prod. Escribe en la base COMPARTIDA (dev/qa/staging): pide I_KNOW_THIS_TOUCHES_SHARED_DEV.
// Deja al lado `qa-business-finandina-undo.sql` con los ids exactos para deshacerlo.
//
//   cd harness && E2E_TARGET=qa I_KNOW_THIS_TOUCHES_SHARED_DEV=1 node ../tablero/tasks/finandina-originacion/artifacts/qa-business-finandina.ts
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { TARGET, query, one, withConnection } from '../../../../harness/pkg/db.ts';

if (TARGET !== 'qa') throw new Error(`sólo qa (E2E_TARGET=${TARGET})`);

const SOURCE_ALLIED = 91;
const SOURCE_BRANCH = 375;
const LENDER = 149;
const NAME = 'BUSINESS_FINANDINA';
const SLUG = 'business-finandina';

if (await one('SELECT id FROM allieds WHERE name = ? OR slug = ?', [NAME, SLUG])) throw new Error(`${NAME} ya existe`);

async function columns(table: string, skip: string[]): Promise<string[]> {
    const rows = await query<{ c: string }>(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE '%GENERATED%' ORDER BY ordinal_position",
        [table],
    );
    return rows.map((r) => r.c).filter((c) => !skip.includes(c));
}
const q = (c: string) => `\`${c}\``;

const created = await withConnection(async (c) => {
    await c.beginTransaction();
    try {
        // 1 · el comercio
        const ac = await columns('allieds', ['id', 'name', 'slug', 'created_at', 'updated_at', 'deleted_at']);
        const [ra]: any = await c.query(
            `INSERT INTO allieds (name, slug, ${ac.map(q).join(', ')}, created_at, updated_at) SELECT ?, ?, ${ac.map(q).join(', ')}, NOW(), NOW() FROM allieds WHERE id = ?`,
            [NAME, SLUG, SOURCE_ALLIED],
        );
        const allied = ra.insertId as number;

        // 2 · sus flags (CORE-562)
        const fc = await columns('allied_flags', ['id', 'allied_id', 'created_at', 'updated_at']);
        const [rf]: any = await c.query(
            `INSERT INTO allied_flags (allied_id, ${fc.map(q).join(', ')}, created_at, updated_at) SELECT ?, ${fc.map(q).join(', ')}, NOW(), NOW() FROM allied_flags WHERE allied_id = ?`,
            [allied, SOURCE_ALLIED],
        );

        // 3 · la sucursal
        const hash = randomBytes(4).toString('hex');
        const bc = await columns('allied_branches', ['id', 'allied_id', 'name', 'hash', 'created_at', 'updated_at', 'deleted_at']);
        const [rb]: any = await c.query(
            `INSERT INTO allied_branches (allied_id, name, hash, ${bc.map(q).join(', ')}, created_at, updated_at) SELECT ?, 'Principal', ?, ${bc.map(q).join(', ')}, NOW(), NOW() FROM allied_branches WHERE id = ?`,
            [allied, hash, SOURCE_BRANCH],
        );
        const branch = rb.insertId as number;

        // 4 · la 149 en el comercio y en la sucursal
        const lac = await columns('lenders_by_allieds', ['id', 'allied_id', 'created_at', 'updated_at']);
        await c.query(
            `INSERT INTO lenders_by_allieds (allied_id, ${lac.map(q).join(', ')}, created_at, updated_at) SELECT ?, ${lac.map(q).join(', ')}, NOW(), NOW() FROM lenders_by_allieds WHERE allied_id = ? AND lender_id = ?`,
            [allied, SOURCE_ALLIED, LENDER],
        );
        const lbc = await columns('lenders_by_allied_branches', ['id', 'allied_branch_id', 'created_at', 'updated_at']);
        await c.query(
            `INSERT INTO lenders_by_allied_branches (allied_branch_id, ${lbc.map(q).join(', ')}, created_at, updated_at) SELECT ?, ${lbc.map(q).join(', ')}, NOW(), NOW() FROM lenders_by_allied_branches WHERE allied_branch_id = ? AND lender_id = ?`,
            [branch, SOURCE_BRANCH, LENDER],
        );

        // 5 · las reglas duras de la 149: su grupo y sus reglas
        const groups = await query<{ id: number }>(
            'SELECT DISTINCT g.id FROM group_rules g JOIN lender_rules lr ON lr.group_rule_id = g.id WHERE g.allied_branch_id = ? AND lr.lender_id = ?',
            [SOURCE_BRANCH, LENDER],
        );
        const lrc = await columns('lender_rules', ['id', 'group_rule_id', 'created_at', 'updated_at']);
        const newGroups: number[] = [];
        let rules = 0;
        for (const g of groups) {
            const [rg]: any = await c.query(
                "INSERT INTO group_rules (allied_branch_id, rule_name, created_at, updated_at) VALUES (?, CONCAT('AB', ?), NOW(), NOW())",
                [branch, branch],
            );
            newGroups.push(rg.insertId);
            const [rr]: any = await c.query(
                `INSERT INTO lender_rules (group_rule_id, ${lrc.map(q).join(', ')}, created_at, updated_at) SELECT ?, ${lrc.map(q).join(', ')}, NOW(), NOW() FROM lender_rules WHERE group_rule_id = ? AND lender_id = ?`,
                [rg.insertId, g.id, LENDER],
            );
            rules += rr.affectedRows;
        }

        await c.commit();
        return { allied, branch, hash, flags: rf.affectedRows, groups: newGroups, rules };
    } catch (e) {
        await c.rollback();
        throw e;
    }
});

const undo = `-- Deshace BUSINESS_FINANDINA en qa (creado ${new Date().toISOString()}). Correr con I_KNOW_THIS_TOUCHES_SHARED_DEV.
DELETE FROM lender_rules WHERE group_rule_id IN (${created.groups.join(', ') || 'NULL'});
DELETE FROM group_rules WHERE id IN (${created.groups.join(', ') || 'NULL'});
DELETE FROM lenders_by_allied_branches WHERE allied_branch_id = ${created.branch};
DELETE FROM lenders_by_allieds WHERE allied_id = ${created.allied};
DELETE FROM allied_branches WHERE id = ${created.branch};
DELETE FROM allied_flags WHERE allied_id = ${created.allied};
DELETE FROM allieds WHERE id = ${created.allied} AND name = '${NAME}';
`;
writeFileSync(new URL('./qa-business-finandina-undo.sql', import.meta.url), undo);
console.log(`BUSINESS_FINANDINA · comercio ${created.allied} · sucursal ${created.branch} (hash ${created.hash}) · flags ${created.flags} · grupos ${created.groups.join(',')} · reglas ${created.rules}`);
process.exit(0);

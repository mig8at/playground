// profile-prep.ts — prender o apagar un perfil (`lender_users_categories.active`) para una suite, SÓLO en local, con
// foto y vuelta atrás.
//
// POR QUÉ. Una suite que depende de que un perfil esté prendido o apagado medía lo que la base local tuviera ese día:
// el mismo caso daba distinto según quién había tocado el perfil antes. Con `preparar` la suite lo fija ella, y al
// terminar lo deja como estaba.
//
// Las guardas, y por qué cada una:
//  - Sólo con `E2E_TARGET=local` Y la base en esta máquina. `isLocalDb()` solo no alcanza: da verdadero con el host
//    por defecto (127.0.0.1) aunque el target sea otro. En la base compartida un perfil apagado lo ven todos.
//  - La foto se escribe ANTES de tocar nada (`.runs/profiles/`): si el proceso muere, queda de dónde volver.
//  - Comparar-y-cambiar (`WHERE id=? AND active=?`) al aplicar y al restaurar: si alguien lo cambió en el medio, no
//    se pisa, y la corrida sale en rojo diciendo cómo deshacerlo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec, one, query, isLocalDb } from './db.ts';

export type ProfileChange = { id: number; lender: number; perfil: string; before: number; after: number };
export type ProfileSnap = { cambios: ProfileChange[]; file: string };

export async function applyProfiles(list: Array<{ lender: number; perfil: string; activo: boolean }>): Promise<ProfileSnap> {
    const target = process.env.E2E_TARGET || 'dev';
    if (target !== 'local' || !isLocalDb())
        throw new Error(`preparar: sólo en local (el target es ${target}); en la base compartida un perfil apagado lo ven todos`);
    const col = await one(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE()
                            AND table_name = 'lender_users_categories' AND column_name = 'active'`);
    if (!col) throw new Error('preparar: la base local no tiene `lender_users_categories.active` (migración 2026_10_26): actualizá legacy-backend y migrá');
    const cambios: ProfileChange[] = [];
    for (const p of list) {
        const rows = await query<{ id: number; active: number }>(
            'SELECT id, active FROM lender_users_categories WHERE lender_id = ? AND name = ?', [p.lender, p.perfil]);
        if (rows.length !== 1) throw new Error(`preparar: ${p.lender}·«${p.perfil}» dio ${rows.length} filas (se espera una)`);
        cambios.push({ id: rows[0].id, lender: p.lender, perfil: p.perfil, before: Number(rows[0].active), after: p.activo ? 1 : 0 });
    }
    const dir = join(import.meta.dirname, '..', '.runs', 'profiles');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `local-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(cambios, null, 2));
    for (const c of cambios) {
        if (c.before === c.after) continue;
        const r = await exec('UPDATE lender_users_categories SET active = ? WHERE id = ? AND active = ?', [c.after, c.id, c.before]);
        if (r.affectedRows !== 1) throw new Error(`preparar: ${c.lender}·«${c.perfil}» cambió mientras se preparaba; foto en ${file}`);
    }
    return { cambios, file };
}

/** Vuelve cada perfil a como estaba, sólo si sigue como lo dejó la corrida. Devuelve false si alguno no volvió. */
export async function restoreProfiles(s: ProfileSnap): Promise<boolean> {
    let ok = true;
    for (const c of s.cambios) {
        if (c.before === c.after) continue;
        const r = await exec('UPDATE lender_users_categories SET active = ? WHERE id = ? AND active = ?', [c.before, c.id, c.after]).catch(() => null);
        if (r?.affectedRows !== 1) {
            ok = false;
            console.error(`  ⚠ preparar: no se restauró ${c.lender}·«${c.perfil}» (cambió en el medio). Deshacelo con la foto ${s.file}:`
                + ` UPDATE lender_users_categories SET active = ${c.before} WHERE id = ${c.id};`);
        }
    }
    return ok;
}

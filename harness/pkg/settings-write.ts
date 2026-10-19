// settings-write.ts — tocar una setting de legacy-backend para una prueba, con FOTO y VUELTA ATRÁS.
//
// Para qué: prender algo de un comercio sin editar SQL a mano —meterlo al pipeline de KYC v2, a los atajos de Experian, a la
// «confirmación de cupo»—, o sembrar en local una setting que falta (el 2026-10-19 el pipeline local reventó con OBV27003 por
// dos que no estaban).
//
// Dos niveles, y no son intercambiables:
//   · LOCAL: `settingSet` fija cualquier valor (es tu base).
//   · BASE COMPARTIDA (dev, qa y staging leen la misma): sólo `settingListAdd`/`settingListRemove`, que agregan o sacan UN
//     comercio de PRUEBA («PRUEBA AUTO…») de una lista dentro de una setting de comportamiento (`TEST_SETTING_KEYS`, nunca
//     credenciales). La escritura lleva el permiso angosto `setting-de-prueba` y sólo pasa si el valor sigue siendo el que
//     se leyó: si alguien del equipo la cambió en el medio, no se pisa.
// Producción no: el harness no tiene credenciales de escritura ahí.
//
// Cada cambio guarda la foto del valor anterior en `.runs/settings/` y devuelve el comando para deshacerlo. Deshacer también
// compara: sólo restaura si la setting sigue como la dejó el cambio.
//
// ⚠ El backend puede tener la setting en caché unos minutos (el wizard cachea «puede omitir Experian» 5 min): el efecto no
// siempre es inmediato.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec, one, isLocalDb, TARGET, TEST_SETTING_KEYS } from './db.ts';

const SNAP_DIR = join(import.meta.dirname, '..', '.runs', 'settings');

export interface SettingChange { target: string; key: string; before: string | null; after: string; snapshot: string; undo: string }

async function current(key: string): Promise<string | null> {
    const r = await one<{ value: string }>('SELECT value FROM settings WHERE `key` = ? ORDER BY id LIMIT 1', [key]);
    return r ? r.value : null;
}

function snapshot(key: string, before: string | null, after: string): string {
    mkdirSync(SNAP_DIR, { recursive: true });
    const file = join(SNAP_DIR, `${TARGET}-${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ target: TARGET, key, before, after, at: new Date().toISOString() }, null, 2));
    return file;
}

const undoCmd = (file: string) => `E2E_TARGET=${TARGET} node dev/setting.ts undo ${file} --apply`;

/** LOCAL: fija el valor (JSON en texto). Crea la setting si no existe. */
export async function settingSet(key: string, value: string, apply = false): Promise<SettingChange> {
    if (!isLocalDb()) throw new Error(`settingSet sólo en local; en la base compartida (${TARGET}) usá settingListAdd/Remove con un comercio de prueba`);
    JSON.parse(value);   // que sea JSON válido: el backend la decodifica
    const before = await current(key);
    const change = { target: TARGET, key, before, after: value, snapshot: '', undo: '' };
    if (!apply) return change;
    if (before === null) {
        await exec("INSERT INTO settings (code, `key`, value, serialized, country_id, created_at, updated_at) VALUES ('setting', ?, ?, 4, 1, NOW(), NOW())", [key, value]);
    } else {
        await exec('UPDATE settings SET value = ?, updated_at = NOW() WHERE `key` = ?', [value, key]);
    }
    change.snapshot = snapshot(key, before, value);
    change.undo = undoCmd(change.snapshot);
    return change;
}

/** Un comercio es «de prueba» si su nombre empieza con PRUEBA AUTO (lo que crea `pg admin allied-create`). */
async function assertTestMerchant(alliedId: number): Promise<void> {
    const a = await one<{ name: string }>('SELECT name FROM allieds WHERE id = ?', [alliedId]);
    if (!a) throw new Error(`el comercio ${alliedId} no existe en ${TARGET}`);
    if (!/^PRUEBA AUTO/i.test(a.name)) throw new Error(`el comercio ${alliedId} («${a.name}») no es de prueba: en la base compartida sólo se tocan comercios «PRUEBA AUTO…»`);
}

/** El nuevo valor con `id` agregado o sacado de la lista `path` (p. ej. `allieds`) de la setting. */
function editList(raw: string | null, path: string, id: number, add: boolean): string {
    const obj = raw ? JSON.parse(raw) : {};
    const list: number[] = Array.isArray(obj[path]) ? obj[path].map(Number) : [];
    const next = add ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);
    return JSON.stringify({ ...obj, [path]: next });
}

async function listChange(key: string, path: string, alliedId: number, add: boolean, apply: boolean): Promise<SettingChange> {
    if (!(TEST_SETTING_KEYS as readonly string[]).includes(key)) throw new Error(`«${key}» no está entre las settings de prueba (${TEST_SETTING_KEYS.join(', ')})`);
    if (!/^[a-zA-Z]+$/.test(path)) throw new Error(`la lista «${path}» no es un nombre válido`);
    if (!isLocalDb()) await assertTestMerchant(alliedId);
    const before = await current(key);
    if (before === null) throw new Error(`la setting «${key}» no existe en ${TARGET}`);
    const after = editList(before, path, alliedId, add);
    const change = { target: TARGET, key, before, after, snapshot: '', undo: '' };
    if (!apply || after === JSON.stringify(JSON.parse(before))) return change;
    const r = await exec(`UPDATE settings SET value = ?, updated_at = NOW() WHERE \`key\` = '${key}' AND value = ?`, [after, before], { permiso: 'setting-de-prueba' });
    if (r.affectedRows !== 1) throw new Error(`«${key}» cambió mientras tanto (otra persona o corrida): no se pisó, volvé a intentarlo`);
    change.snapshot = snapshot(key, before, after);
    change.undo = undoCmd(change.snapshot);
    return change;
}

/** Agrega el comercio a la lista `path` de la setting (en la compartida, sólo comercios de prueba). */
export const settingListAdd = (key: string, path: string, alliedId: number, apply = false) => listChange(key, path, alliedId, true, apply);
/** Saca el comercio de la lista `path` de la setting (en la compartida, sólo comercios de prueba). */
export const settingListRemove = (key: string, path: string, alliedId: number, apply = false) => listChange(key, path, alliedId, false, apply);

/** Deshace un cambio desde su foto: sólo si la setting sigue como la dejó ese cambio. */
export async function settingUndo(file: string, apply = false): Promise<{ key: string; restored: boolean; detail: string }> {
    const snap = JSON.parse(readFileSync(file, 'utf8')) as { target: string; key: string; before: string | null; after: string };
    if (snap.target !== TARGET) throw new Error(`la foto es de ${snap.target} y estás en ${TARGET}`);
    const now = await current(snap.key);
    if (now !== snap.after) return { key: snap.key, restored: false, detail: 'la setting cambió después de esa foto: no se restaura para no pisar a otro' };
    if (!apply) return { key: snap.key, restored: false, detail: `vista previa: volvería a ${snap.before ?? '(no existir)'}` };
    if (isLocalDb()) {
        if (snap.before === null) await exec('DELETE FROM settings WHERE `key` = ? AND value = ?', [snap.key, snap.after]);
        else await exec('UPDATE settings SET value = ?, updated_at = NOW() WHERE `key` = ? AND value = ?', [snap.before, snap.key, snap.after]);
    } else {
        if (!(TEST_SETTING_KEYS as readonly string[]).includes(snap.key)) throw new Error(`«${snap.key}» no está entre las settings de prueba: no se toca en la base compartida`);
        if (snap.before === null) throw new Error('en la base compartida no se borra una setting');
        const r = await exec(`UPDATE settings SET value = ?, updated_at = NOW() WHERE \`key\` = '${snap.key}' AND value = ?`, [snap.before, snap.after], { permiso: 'setting-de-prueba' });
        if (r.affectedRows !== 1) return { key: snap.key, restored: false, detail: 'cambió en el medio: no se restauró' };
    }
    return { key: snap.key, restored: true, detail: `volvió a ${snap.before ?? '(no existir)'}` };
}

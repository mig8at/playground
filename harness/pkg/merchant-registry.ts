// merchant-registry.ts — dónde está un comercio en CADA base, para el registro (`harness.json`, ver `pkg/flows.ts`).
// Lo usan `bin/merchants.ts` (agregar, asociar, revisar) y nada más: el panel sólo LEE el registro.
//
// Las tres bases: local (Docker), la compartida (dev, qa y staging: una sola base) y prod (por el conector, sólo lectura).
// Cada consulta a local y a la compartida corre `bin/dbops.ts` en su propio proceso con su `E2E_TARGET`, porque
// `pkg/db.ts` fija el ambiente al importarse. Todo es LECTURA.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prodCatalog, prodBranches } from './prod-catalog.ts';
import { baseOf, type Base } from './flows.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** El ambiente con el que se lee cada base (dev, qa y staging comparten la suya). */
export const BASE_TARGET: Record<Base, string> = { local: 'local', shared: 'dev', prod: 'prod' };

/** `node bin/dbops.ts …` contra un ambiente → su JSON, o null si no contestó (sin VPN, base caída). */
export function dbops(args: string[], target: string): Promise<any> {
    return new Promise((ok) => execFile('node', ['bin/dbops.ts', ...args], { cwd: ROOT, env: { ...process.env, E2E_TARGET: target }, timeout: 60_000 },
        (err, stdout) => { if (err) return ok(null); try { ok(JSON.parse(stdout)); } catch { ok(null); } }));
}

export interface Found {
    base: Base;
    allied_id: number; name: string; slug: string;
    /** La sucursal contra la que se corre: la del ASESOR DE PRUEBA (`c<hash>-fake@`) si la tiene, si no una activa. */
    branch: string;
    /** true si `branch` es la del asesor de prueba. Sin él, el canal asesor fuera de local no entra. */
    test: boolean;
}

/** El catálogo de una base: [{allied_id, name, slug, test_branch, branch?}]. null si la base no contestó. */
async function catalogOf(base: Base): Promise<any[] | null> {
    if (base === 'prod') { try { return await prodCatalog(); } catch { return null; } }
    const r = await dbops(['catalog'], BASE_TARGET[base]);
    return Array.isArray(r) ? r : null;
}

/** El comercio que se pidió, en una base: por slug exacto, por id (sólo si es un número) o por nombre exacto. */
const pick = (rows: any[], q: string) => {
    const n = q.trim().toLowerCase();
    return rows.find((r) => String(r.slug).toLowerCase() === n)
        ?? (/^\d+$/.test(n) ? rows.find((r) => String(r.allied_id) === n) : undefined)
        ?? rows.find((r) => String(r.name).trim().toLowerCase() === n);
};

/** Dónde está el comercio `q` (slug, id o nombre) en una base. `null` si no está; `undefined` si la base no contestó. */
export async function findIn(base: Base, q: string): Promise<Found | null | undefined> {
    const rows = await catalogOf(base);
    if (!rows) return undefined;
    const r = pick(rows, q);
    if (!r) return null;
    let branch = r.test_branch ? String(r.test_branch) : '';
    if (!branch && base === 'prod') branch = String(r.branch || '');
    if (!branch) branch = String((await dbops(['list', r.slug || r.name], BASE_TARGET[base]))?.find?.((m: any) => Number(m.allied_id) === Number(r.allied_id))?.hash || '');
    return { base, allied_id: Number(r.allied_id), name: String(r.name), slug: String(r.slug || ''), branch, test: !!r.test_branch };
}

/** Los comercios de una base cuyo nombre o slug contiene `q`: para sugerir cuando no hubo uno exacto. */
export async function suggest(base: Base, q: string, max = 8): Promise<any[]> {
    const rows = (await catalogOf(base)) ?? [];
    const n = q.trim().toLowerCase();
    return rows.filter((r) => String(r.name).toLowerCase().includes(n) || String(r.slug).toLowerCase().includes(n)).slice(0, max);
}

/** Qué hashes existen en una base → {hash: {allied_id, allied_name}}. `null` si la base no contestó. */
export async function branchesIn(base: Base, hashes: string[]): Promise<Record<string, { allied_id: number; allied_name: string }> | null> {
    const hs = hashes.filter((h) => /^[0-9a-f]{8}$/i.test(h));
    if (!hs.length) return {};
    let rows: any[] | null;
    if (base === 'prod') { try { rows = await prodBranches(hs); } catch { rows = null; } }
    else { const r = await dbops(['branches', ...hs], BASE_TARGET[base]); rows = Array.isArray(r) ? r : null; }
    if (!rows) return null;
    return Object.fromEntries(rows.map((r) => [String(r.hash), { allied_id: Number(r.allied_id), allied_name: String(r.allied_name || '') }]));
}

/** El país del comercio de una sucursal, como lo dice la base (`countries.name`). '' si no se supo. */
export async function countryOf(base: Base, hash: string): Promise<string> {
    if (base === 'prod' || !/^[0-9a-f]{8}$/i.test(hash)) return '';
    const r = await dbops(['merchant-tags', hash], BASE_TARGET[base]);
    return String(r?.[hash]?.pais || '');
}

export { baseOf };

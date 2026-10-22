// flows.ts — EL REGISTRO DE COMERCIOS del harness (`harness.json`, versionado), en un solo lugar: leerlo, saber contra qué
// sucursal se corre en cada ambiente y escribirlo. Lo usan el panel, `bin/advisor` (por `bin/flows.ts`), `bin/merchants.ts`,
// el autorrelleno, el chequeo de sucursal y los runners que montan o barren comercios.
//
// ES LA ÚNICA FUENTE (desde el 2026-10-21): la barra del panel son sus entradas con `panel: true`, en el orden del archivo,
// con su país (`country`, como lo dice la base) y su nota (`note`: lo que ejercita). Se agregan y se asocian por consola
// (`make harness-merchants`), no desde la UI. Antes la lista curada estaba escrita en `panel/index.html` y los agregados en
// `.flows.json` (gitignoreado); sin `harness.json` se lee ese, para no romper una máquina que todavía no lo tiene.
//
// EL FORMATO (versión 2, desde el 2026-10-21): el COMERCIO arriba y las BASES adentro, porque el comercio es uno solo y lo
// que cambia de una base a otra es la sucursal (el hash es otra fila en cada base). dev, qa y staging comparten base, así
// que son una sola (`shared`): repetir su sucursal tres veces era invitar a que diverjan.
//
//   { "version": 2, "otp_bypass_phone": "3131010101",
//     "merchants": { "sonria": { "name": "Sonría", "panel": true, "country": "Colombia", "note": "9 entidades…",
//                                "allied_slug": "sonria", "channels": ["asesor"],
//                                "bases": { "local": { "branch": "f581714b" }, "shared": { "branch": "44ed36af" },
//                                           "prod": { "branch": "d6b88e5e" } } } } }
//
// ⚠ EL FORMATO VIEJO SE SIGUE LEYENDO (`branch_hash` + `por_target.<ambiente>`, `fav`/`favorite` = `panel`, `canales`): hay comandos guardados
// en las tareas que dependen de él y otra sesión puede estar con un `.flows.json` viejo. La primera vez que se ESCRIBE un
// archivo viejo, se deja la copia `.flows.json.v1.bak`. La equivalencia: `branch_hash` valía para todas las bases salvo
// que `por_target` dijera otra cosa, así que pasa a `local` y `shared` (y `prod` sólo si estaba declarada).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `HARNESS_FLOWS_FILE` apunta a otro registro (para probar un formato sin tocar el de la máquina). */
export const FLOWS_FILE = process.env.HARNESS_FLOWS_FILE || fileURLToPath(new URL('../harness.json', import.meta.url));
/** El registro de antes, gitignoreado: sólo se LEE, y sólo si no hay `harness.json`. */
const LEGACY_FILE = fileURLToPath(new URL('../.flows.json', import.meta.url));

export type Base = 'local' | 'shared' | 'prod';
/** La base de un ambiente: local es la de Docker, dev/qa/staging la compartida y prod la de producción. */
export const baseOf = (target: string): Base => (target === 'local' ? 'local' : target === 'prod' ? 'prod' : 'shared');

export interface MerchantEntry {
    name?: string;
    /** En la barra del panel (en el orden del archivo). Sin esto, la entrada sólo sirve para correr por consola. */
    panel?: boolean;
    /** El país del comercio como lo dice la base (`countries.name`: Colombia, Peru, Dominican Republic). */
    country?: string;
    /** Lo que ejercita: va en el tooltip de la barra. */
    note?: string;
    allied_slug?: string;
    allied_id?: number;
    allied_name?: string;
    branch_id?: number;
    channels?: string[];
    otp_bypass_phone?: string;
    bases: Partial<Record<Base, { branch: string }>>;
}
export interface Flows { version: 2; otp_bypass_phone?: string; merchants: Record<string, MerchantEntry> }

const HASH = /^[0-9a-f]{8}$/i;
const branchOf = (h: unknown) => (typeof h === 'string' && HASH.test(h) ? { branch: h.toLowerCase() } : undefined);

/** Una entrada en el formato nuevo, venga del que venga. */
export function normalizeEntry(raw: any): MerchantEntry {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out: MerchantEntry = { bases: {} };
    for (const k of ['name', 'country', 'note', 'allied_slug', 'allied_name', 'otp_bypass_phone'] as const) if (r[k] !== undefined && r[k] !== '') out[k] = String(r[k]);
    for (const k of ['allied_id', 'branch_id'] as const) if (r[k] !== undefined && r[k] !== '') out[k] = Number(r[k]);
    const channels = r.channels ?? r.canales;
    if (Array.isArray(channels) && channels.length) out.channels = channels.map(String);
    if (r.panel ?? r.favorite ?? r.fav) out.panel = true;
    if (r.bases && typeof r.bases === 'object') {
        for (const b of ['local', 'shared', 'prod'] as const) { const v = branchOf(r.bases[b]?.branch); if (v) out.bases[b] = v; }
    } else {
        const pt = r.por_target ?? {};
        const local = branchOf(pt.local ?? r.branch_hash);
        const shared = branchOf(pt.dev ?? pt.qa ?? pt.staging ?? r.branch_hash);
        const prod = branchOf(pt.prod);
        if (local) out.bases.local = local;
        if (shared) out.bases.shared = shared;
        if (prod) out.bases.prod = prod;
    }
    return out;
}

/** El registro, ya en el formato nuevo. Sin archivo (o ilegible), vacío: quien lo necesite lo dice. */
export function readFlows(file = FLOWS_FILE): Flows {
    let raw: any = {};
    const src = file === FLOWS_FILE && !existsSync(file) && existsSync(LEGACY_FILE) ? LEGACY_FILE : file;
    try { raw = JSON.parse(readFileSync(src, 'utf8')); } catch { /* sin archivo */ }
    const merchants: Record<string, MerchantEntry> = {};
    for (const [k, v] of Object.entries<any>(raw?.merchants ?? {})) merchants[k] = normalizeEntry(v);
    return { version: 2, ...(raw?.otp_bypass_phone ? { otp_bypass_phone: String(raw.otp_bypass_phone) } : {}), merchants };
}

/** Escribe el registro en el formato nuevo. Si el archivo que había era del formato viejo, antes deja su copia. */
export function writeFlows(flows: Flows, file = FLOWS_FILE): void {
    try {
        if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8'))?.version !== 2 && !existsSync(file + '.v1.bak')) copyFileSync(file, file + '.v1.bak');
    } catch { /* ilegible: se reescribe igual */ }
    // Cada entrada con sus claves en un orden fijo (lo que se lee primero arriba, las bases al final): el archivo está
    // versionado y se lee en los diffs.
    const ORDER = ['name', 'panel', 'country', 'note', 'allied_slug', 'allied_id', 'allied_name', 'branch_id', 'channels', 'otp_bypass_phone', 'bases'];
    const merchants = Object.fromEntries(Object.entries(flows.merchants).map(([k, e]) => [k,
        Object.fromEntries(ORDER.filter((f) => (e as any)[f] !== undefined).map((f) => [f, (e as any)[f]]))]));
    writeFileSync(file, JSON.stringify({ version: 2, ...(flows.otp_bypass_phone ? { otp_bypass_phone: flows.otp_bypass_phone } : {}), merchants }, null, 2) + '\n');
}

/** La sucursal contra la que se CORRE un comercio en un ambiente ('' si el registro no la sabe). */
export function branchFor(key: string, target: string, flows = readFlows()): string {
    return flows.merchants[key]?.bases[baseOf(target)]?.branch ?? '';
}

/** Anota la sucursal de un comercio en la base de un ambiente (lo crea si no estaba). */
export function setBranch(key: string, target: string, hash: string, extra: Partial<MerchantEntry> = {}): void {
    if (!HASH.test(hash)) throw new Error(`«${hash}» no es un hash de sucursal`);
    const flows = readFlows();
    const cur = flows.merchants[key] ?? { bases: {} };
    flows.merchants[key] = { ...cur, ...extra, bases: { ...cur.bases, [baseOf(target)]: { branch: hash.toLowerCase() } } };
    writeFlows(flows);
}

/** Todos los hashes que el registro le conoce a un comercio (en cualquier base). */
export const branchesOf = (e: MerchantEntry): string[] => Object.values(e.bases).map((b) => b!.branch);

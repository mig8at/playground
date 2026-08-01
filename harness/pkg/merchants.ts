// merchants.ts — resolución de comercio/sucursal (allieds + allied_branches). Port de db.go
// (resolveMerchant/ensureBranch) + ops.go (opListMerchants/opListEcommerce).
import { one, query } from './db.ts';

export interface Merchant { branchId: number; alliedId: number; hash: string; name: string; slug: string; }
export interface Branch { id: number; name: string; hash: string; }
export interface MerchantRow { allied_id: number; name: string; hash: string; slug: string; }
export interface EcommerceBranch { allied_id: number; name: string; hash: string; }

/** Resuelve UN comercio por hash, slug o nombre. Lanza si no existe. */
export async function resolveMerchant(q: string): Promise<Merchant> {
    const row = await one<{ id: number; allied_id: number; hash: string; name: string; slug: string }>(
        `SELECT ab.id, ab.allied_id, COALESCE(ab.hash,'') AS hash, a.name, COALESCE(a.slug,'') AS slug
         FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id
         WHERE ab.hash = ? OR a.slug = ? OR a.name LIKE ?
         ORDER BY ab.status DESC, ab.id LIMIT 1`,
        [q, q, '%' + q + '%'],
    );
    if (!row) throw new Error(`comercio no encontrado: ${JSON.stringify(q)}`);
    return { branchId: row.id, alliedId: row.allied_id, hash: row.hash, name: row.name, slug: row.slug };
}

/** Sucursal ACTIVA del allied: prefiere preferHash si pertenece al allied, si no la primera por id. */
export async function ensureBranch(alliedID: number, preferHash = ''): Promise<Branch> {
    if (preferHash) {
        const b = await one<{ id: number; name: string; hash: string }>(
            "SELECT id, name, COALESCE(hash,'') AS hash FROM allied_branches WHERE allied_id=? AND hash=? AND status=1 LIMIT 1",
            [alliedID, preferHash],
        );
        if (b) return { id: b.id, name: b.name, hash: b.hash };
    }
    const b = await one<{ id: number; name: string; hash: string }>(
        "SELECT id, name, COALESCE(hash,'') AS hash FROM allied_branches WHERE allied_id=? AND status=1 ORDER BY id LIMIT 1",
        [alliedID],
    );
    if (!b) throw new Error(`comercio #${alliedID} sin branch activo`);
    return { id: b.id, name: b.name, hash: b.hash };
}

/** Lista comercios (allieds con sucursal activa). Filtro opcional por nombre/slug/hash. */
export async function listMerchants(q = '', limit = 20): Promise<MerchantRow[]> {
    const lim = limit <= 0 || limit > 100 ? 20 : limit;
    const like = '%' + q + '%';
    return query<MerchantRow>(
        `SELECT a.id AS allied_id, a.name, COALESCE(MIN(ab.hash),'') AS hash, COALESCE(a.slug,'') AS slug
         FROM allieds a JOIN allied_branches ab ON ab.allied_id = a.id AND ab.status = 1
         WHERE (? = '' OR a.name LIKE ? OR a.slug LIKE ? OR ab.hash = ?)
         GROUP BY a.id ORDER BY a.id DESC LIMIT ?`,
        [q, like, like, q, lim],
    );
}

/** Sucursales con credencial ecommerce (las únicas que pueden hacer el handshake base64). */
export async function listEcommerce(q = ''): Promise<EcommerceBranch[]> {
    const like = '%' + q + '%';
    return query<EcommerceBranch>(
        `SELECT a.id AS allied_id, a.name, COALESCE(ab.hash,'') AS hash
         FROM allied_ecommerce_credentials aec
         JOIN allied_branches ab ON ab.id = aec.allied_branch_id
         JOIN allieds a ON a.id = ab.allied_id
         WHERE (? = '' OR a.name LIKE ? OR a.slug LIKE ?)
         ORDER BY a.id DESC LIMIT 40`,
        [q, like, like],
    );
}

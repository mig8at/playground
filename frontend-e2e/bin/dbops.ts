#!/usr/bin/env node
// dbops — CLI de operaciones de DB para frontend-e2e (sin shellear a backend-mcp). Salida JSON, igual
// que el Go que reemplaza, para que bin/asesor siga parseando con node json_pick. Target = E2E_TARGET
// (default dev). Las escrituras a dev exigen I_KNOW_THIS_TOUCHES_SHARED_DEV=1 (lo trae .env.dev).
//   node bin/dbops.ts whois <email|sub>
//   node bin/dbops.ts assign <email|sub> <merchant> [branchHash] [realSub]
//   node bin/dbops.ts revoke
//   node bin/dbops.ts scrubphone <telefono>
//   node bin/dbops.ts list [merchant]
//   node bin/dbops.ts ecommerce-url <merchant> [phone] [amount]
//   node bin/dbops.ts synth-fill <uReqID> [lender] [income] [score]
import { close, one, query } from '../pkg/db.ts';
import { whois, assign, revoke, scrubphone } from '../pkg/asesor.ts';
import { listMerchants, listEcommerce } from '../pkg/merchants.ts';
import { buildEcommerceUrl } from '../pkg/ecommerce.ts';
import { synthFill, requestEstado11 } from '../pkg/inject.ts';

const [cmd, ...a] = process.argv.slice(2);
const num = (s: string | undefined): number => (s ? Number(s) : 0);

try {
    let r: unknown;
    switch (cmd) {
        case 'whois': r = await whois(a[0] ?? ''); break;
        case 'assign': r = await assign(a[0] ?? '', a[1] ?? '', a[2] ?? '', a[3] ?? ''); break;
        case 'revoke': r = await revoke(); break;
        case 'scrubphone': r = await scrubphone(a[0] ?? ''); break;
        case 'list': r = await listMerchants(a[0] ?? ''); break;
        case 'ecommerce-url': r = await buildEcommerceUrl(a[0] ?? '', a[1] ?? '', num(a[2])); break;
        case 'synth-fill':
            r = await synthFill(num(a[0]), { lender: a[1] || undefined, income: num(a[2]) || undefined, score: num(a[3]) || undefined });
            break;
        case 'estado11': case 'creditopx': r = await requestEstado11(num(a[0])); break;
        case 'lender-rt': // response_type del lender por nombre o id (2=creditopx, 1=integración, 0=estándar)
            r = await one(
                "SELECT id, COALESCE(name,'') AS name, response_type AS rt FROM lenders WHERE status=1 AND (CAST(id AS CHAR)=? OR name LIKE ?) ORDER BY id LIMIT 1",
                [a[0] ?? '', '%' + (a[0] ?? '') + '%'],
            );
            break;
        case 'ecommerce-ok': // ¿el comercio tiene checkout ecommerce (alguna sucursal con credencial)? → {ok}
            r = { merchant: a[0] ?? '', ok: (await listEcommerce(a[0] ?? '')).length > 0 };
            break;
        case 'ecommerce-merchants': { // de un set de branch_hashes (coma-sep), cuáles tienen checkout ecommerce
            const hashes = (a[0] ?? '').split(',').filter(Boolean);   // (por allied del branch) → [hash]
            if (!hashes.length) { r = []; break; }
            const ph = hashes.map(() => '?').join(',');
            const rows = await query<{ hash: string }>(
                `SELECT DISTINCT ab0.hash FROM allied_branches ab0
                 WHERE ab0.hash IN (${ph})
                   AND EXISTS (SELECT 1 FROM allied_branches ab JOIN allied_ecommerce_credentials aec ON aec.allied_branch_id = ab.id WHERE ab.allied_id = ab0.allied_id)`,
                hashes,
            );
            r = rows.map((x) => x.hash);
            break;
        }
        case 'lenders-for': // lenders del comercio a NIVEL SUCURSAL (lenders_by_allied_branches), igual que la
            // VISIBILIDAD real del wizard (LenderListingService::resolveLenderIdsByBranch): pluck por
            // allied_branch_id + Lender.status=1 (NO filtra lab.status — lo exponemos como branch_status para
            // poder anotarlo). Difiere del nivel allied (lenders_by_allieds), que sobre-reporta. → [{id,name,rt,branch_status}]
            r = await query(
                `SELECT l.id, COALESCE(l.name,'') AS name, l.response_type AS rt, lab.status AS branch_status
                 FROM allied_branches ab
                 JOIN lenders_by_allied_branches lab ON lab.allied_branch_id = ab.id
                 JOIN lenders l ON l.id = lab.lender_id
                 WHERE ab.hash = ? AND l.status = 1
                 ORDER BY l.response_type, l.name`,
                [a[0] ?? ''],
            );
            break;
        default:
            throw new Error(`comando desconocido: ${cmd || '(vacío)'} — whois|assign|revoke|scrubphone|list|ecommerce-url|synth-fill|lender-rt`);
    }
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    await close();
} catch (e) {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + '\n');
    await close();
    process.exit(1);
}

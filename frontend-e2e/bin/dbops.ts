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
import { close, one, query, exec, assertWriteAllowed } from '../pkg/db.ts';
import { whois, assign, revoke, scrubphone } from '../pkg/asesor.ts';
import { listMerchants, listEcommerce } from '../pkg/merchants.ts';
import { buildEcommerceUrl } from '../pkg/ecommerce.ts';
import { synthFill, requestEstado11 } from '../pkg/inject.ts';
import { verifyLaravelMac } from '../pkg/laravel-crypt.ts';
import { appKey } from '../pkg/db.ts';

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
            // `lender_status` = lenders.status (GLOBAL) → ES el que corta la visibilidad del listado
            // (getLenders: Lender::where('status',1)). `branch_status` = lenders_by_allied_branches.status,
            // que el listado NO respeta (resolveLenderIdsByBranch pluckea por branch sin filtrar lab.status) → informativo.
            // `lenders.product` NO existe en todos los ambientes: la agrega una migración que hoy solo
            // está aplicada en local. `COALESCE` no salva eso —maneja NULL, no una columna ausente— así
            // que contra dev la consulta ENTERA moría con "Unknown column 'l.product'" y el panel, que se
            // comía el error, dibujaba el recorrido vacío como si el comercio no tuviera flujos (F-64).
            // Se degrada a `product = NULL`, que el panel sabe leer (agrupa por rt y lo avisa).
            {
            const hayProduct = (await query(`SHOW COLUMNS FROM lenders LIKE 'product'`)).length > 0;
            const productoExpr = hayProduct ? `COALESCE(l.product,'credit')` : `NULL`;
            r = await query(
                `SELECT l.id, COALESCE(l.name,'') AS name, l.response_type AS rt, ${productoExpr} AS product, COALESCE(p.name,'default') AS path, l.status AS lender_status, lab.status AS branch_status, COALESCE(la.sort, 9999) AS allied_sort
                 FROM allied_branches ab
                 JOIN lenders_by_allied_branches lab ON lab.allied_branch_id = ab.id
                 JOIN lenders l ON l.id = lab.lender_id
                 LEFT JOIN paths p ON p.id = l.path_id
                 LEFT JOIN lenders_by_allieds la ON la.allied_id = ab.allied_id AND la.lender_id = l.id
                 WHERE ab.hash = ?
                 ORDER BY COALESCE(la.sort, 9999), l.response_type, l.name`,
                [a[0] ?? ''],
            );
            }
            break;
        case 'cryptocheck': { // ¿el APP_KEY es el de ESTE target? Recomputa el HMAC de una fila Experian
            // REAL y lo compara con el `mac` guardado. Rescatado de backend-mcp antes de borrarlo.
            //
            // EL DETALLE QUE LO HACE SERVIR: se prueba contra una fila NO sintética (documento fuera del
            // rango 2.9B). Contra una fila que forjamos nosotros el MAC SIEMPRE valida —la escribimos con
            // la misma llave— y el chequeo no dice nada.
            //
            // POR QUÉ IMPORTA: con un APP_KEY equivocado, injectDatacredito escribe un blob que Laravel no
            // puede desencriptar. No hay error: /lenders simplemente no ofrece nada, igual que si el perfil
            // no calificara. `appKey()` solo valida PRESENCIA, no que sea la correcta.
            const fila = await one<{ data: string; doc: string }>(
                `SELECT CAST(rcud.data AS CHAR) AS data, COALESCE(u.document_number,'') AS doc
                   FROM risk_central_user_data rcud
                   JOIN users u ON u.id = rcud.user_id
                  WHERE rcud.data IS NOT NULL AND COALESCE(u.document_number,'') NOT LIKE '29%'
                  ORDER BY rcud.id DESC LIMIT 1`);
            if (!fila) { r = { ok: false, msg: 'no hay ninguna fila Experian REAL para probar (solo sintéticas)' }; break; }
            let payload = fila.data;
            try { const j = JSON.parse(fila.data); payload = typeof j === 'string' ? j : fila.data; } catch { /* ya es el payload */ }
            const ok = verifyLaravelMac(payload, appKey());
            r = {
                ok,
                probado_contra: `documento ${fila.doc.slice(0, 4)}… (fila real, no sintética)`,
                msg: ok
                    ? 'el APP_KEY es el de este target: el MAC de una fila real valida'
                    : '⚠ APP_KEY EQUIVOCADO — la inyección de buró va a escribir un blob ilegible y /lenders no va a ofrecer nada, SIN error visible',
            };
            break;
        }
        case 'branches': // resuelve VARIOS hashes de sucursal de una: nombre del comercio y si existe en
            // este target. Existe para que el panel muestre en la card el hash que REALMENTE se lanza (el de
            // .flows.json) en vez del que devolvía una búsqueda por slug, que podía ser OTRA sucursal del
            // mismo comercio — y entonces la card mostraba una sucursal y el flujo corría contra otra.
            // → [{hash, allied_id, allied_name, lenders}]
            r = await query(
                `SELECT ab.hash, a.id AS allied_id, COALESCE(a.name,'') AS allied_name,
                        (SELECT COUNT(*) FROM lenders_by_allied_branches x
                          JOIN lenders l2 ON l2.id = x.lender_id AND l2.status = 1
                         WHERE x.allied_branch_id = ab.id) AS lenders
                   FROM allied_branches ab
                   JOIN allieds a ON a.id = ab.allied_id
                  WHERE ab.hash IN (?)`,
                [a.length ? a : ['']],
            );
            break;
        case 'branches-of': // TODAS las sucursales de un comercio, para poder elegir contra CUÁL correr sin
            // depender de que esté quemada en .flows.json. Ordena por status (las activas primero) porque
            // un comercio grande arrastra sucursales viejas apagadas y no son las que se quieren probar.
            // → [{id, hash, name, status, lenders}]
            r = await query(
                `SELECT ab.id, ab.hash, COALESCE(ab.name,'') AS name, ab.status,
                        (SELECT COUNT(*) FROM lenders_by_allied_branches x
                          JOIN lenders l2 ON l2.id = x.lender_id AND l2.status = 1
                         WHERE x.allied_branch_id = ab.id) AS lenders
                   FROM allied_branches ab
                  WHERE ab.allied_id = ?
                  ORDER BY ab.status DESC, ab.id`,
                [num(a[0])],
            );
            break;
        case 'lender-sort': { // fija el ORDEN de los lenders del comercio (lenders_by_allieds.sort) desde una lista de ids
            // en orden. Es la palanca que respeta orderByGroupProbability DENTRO de cada bucket de probabilidad.
            assertWriteAllowed();
            const hash = a[0] ?? '';
            const ids = (a[1] ?? '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
            const br = await one<{ allied_id: number }>('SELECT allied_id FROM allied_branches WHERE hash = ? LIMIT 1', [hash]);
            if (!br) throw new Error(`sucursal no encontrada: ${hash}`);
            let updated = 0;
            for (let i = 0; i < ids.length; i++) {
                const res = await exec('UPDATE lenders_by_allieds SET sort = ? WHERE allied_id = ? AND lender_id = ?', [i, br.allied_id, ids[i]]);
                updated += res.affectedRows;
            }
            r = { ok: true, allied_id: br.allied_id, order: ids, updated };
            break;
        }
        case 'lender-set': { // prende/apaga un lender por su status GLOBAL (lenders.status) — lo que el listado filtra.
            // OJO: es global (afecta todas las sucursales/comercios en LOCAL). Reversible. hash = solo para la API.
            assertWriteAllowed();
            const lenderId = num(a[1]);
            const status = a[2] === '1' ? 1 : 0;
            const res = await exec('UPDATE lenders SET status = ? WHERE id = ?', [status, lenderId]);
            r = { ok: true, lender_id: lenderId, status, affected: res.affectedRows, scope: 'global (lenders.status)' };
            break;
        }
        case 'flow-id': // flow_id + status de un user_request (para asserts del flujo pre-aprobado/omit-experian)
            r = await one(
                'SELECT id, flow_id AS flowId, user_request_status_id AS status FROM user_requests WHERE id = ?',
                [num(a[0])],
            );
            break;
        default:
            throw new Error(`comando desconocido: ${cmd || '(vacío)'} — whois|assign|revoke|scrubphone|list|ecommerce-url|synth-fill|lender-rt|flow-id`);
    }
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    await close();
} catch (e) {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + '\n');
    await close();
    process.exit(1);
}

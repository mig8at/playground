#!/usr/bin/env node
// dbops — CLI de operaciones de DB para harness (sin shellear a backend-mcp). Salida JSON, igual
// que el Go que reemplaza, para que bin/advisor siga parseando con node json_pick. Target = E2E_TARGET
// (default dev). Las escrituras a dev exigen I_KNOW_THIS_TOUCHES_SHARED_DEV=1 exportado A MANO en la
// shell (ya NO vive en .env.dev — F-53); el panel lo inyecta solo para sus corridas (panel/server.ts).
//   node bin/dbops.ts whois <email|sub>
//   node bin/dbops.ts assign <email|sub> <merchant> [branchHash] [realSub]
//   node bin/dbops.ts revoke
//   node bin/dbops.ts scrubphone <telefono>
//   node bin/dbops.ts scrub-sinteticos          (SÓLO LOCAL: borra los usuarios sintéticos que creó el arnés)
//   node bin/dbops.ts list [merchant]
//   node bin/dbops.ts ecommerce-url <merchant> [phone] [amount]
//   node bin/dbops.ts synth-fill <uReqID> [lender] [income] [score]
//   node bin/dbops.ts sucursal-check <merchant|hash> <sub>   (SÓLO LECTURA: ¿la sucursal que vamos a anunciar es la que el backend le da a ese asesor?)
import { close, one, query, scalar, exec, assertWriteAllowed, TARGET } from '../pkg/db.ts';
import { whois, assign, revoke, scrubphone, scrubHarnessUsers } from '../pkg/advisor.ts';
import { listMerchants, listEcommerce } from '../pkg/merchants.ts';
import { buildEcommerceUrl } from '../pkg/ecommerce.ts';
import { branchCorbeta } from '../pkg/merchants.ts';
import { preflightBranch, mismatchNotice } from '../pkg/preflight-branch.ts';
import { synthFill, requestStatus11 } from '../pkg/inject.ts';
import { verifyLaravelMac } from '../pkg/laravel-crypt.ts';
import { appKey } from '../pkg/db.ts';

const [cmd, ...a] = process.argv.slice(2);

/** Los flags del comercio que el panel deja prender y apagar: nombre → columna de `allieds`. Una lista
 *  blanca a propósito: el nombre llega del panel y termina en un UPDATE. */
const MERCHANT_FLAGS: Record<string, string> = {
    initial_fee: 'initial_fee',
};
const num = (s: string | undefined): number => (s ? Number(s) : 0);

try {
    let r: unknown;
    switch (cmd) {
        case 'scrub-sinteticos': r = await scrubHarnessUsers(); break;
        case 'whois': r = await whois(a[0] ?? ''); break;
        case 'assign': r = await assign(a[0] ?? '', a[1] ?? '', a[2] ?? '', a[3] ?? ''); break;
        case 'revoke': r = await revoke(); break;
        case 'scrubphone': r = await scrubphone(a[0] ?? ''); break;
        case 'list': r = await listMerchants(a[0] ?? ''); break;
        case 'ecommerce-url': r = await buildEcommerceUrl(a[0] ?? '', a[1] ?? '', num(a[2])); break;
        case 'synth-fill':
            r = await synthFill(num(a[0]), { lender: a[1] || undefined, income: num(a[2]) || undefined, score: num(a[3]) || undefined });
            break;
        case 'estado11': case 'creditopx': r = await requestStatus11(num(a[0])); break;
        case 'lender-rt': // response_type del lender por nombre o id (2=creditopx, 1=integración, 0=estándar)
            r = await one(
                "SELECT id, COALESCE(name,'') AS name, response_type AS rt FROM lenders WHERE status=1 AND (CAST(id AS CHAR)=? OR name LIKE ?) ORDER BY id LIMIT 1",
                [a[0] ?? '', '%' + (a[0] ?? '') + '%'],
            );
            break;
        case 'ecommerce-ok': // ¿el comercio tiene checkout ecommerce (alguna sucursal con credencial)? → {ok}
            r = { merchant: a[0] ?? '', ok: (await listEcommerce(a[0] ?? '')).length > 0 };
            break;
        case 'ecommerce-vinculo': { // ¿la solicitud quedó ATADA al pedido de la tienda, y qué datos entregó el comercio? → lo imprime el panel al cerrar una corrida ecommerce
            const ureq = num(a[0]);
            const link = await one<{ ecommerce_request_id: number }>(
                'SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id = ? ORDER BY id DESC LIMIT 1',
                [ureq],
            );
            const er = link ? await one<{ id: number; order_key: string; processed: number; data: string }>(
                'SELECT id, order_key, processed, data FROM ecommerce_requests WHERE id = ?',
                [link.ecommerce_request_id],
            ) : null;
            // `data` es el JSON del pedido seguido de una cola literal `config[]` (medido el 2026-09-14
            // en la fila 6945), así que un JSON.parse directo falla: se corta en el último `}`.
            let billing: Record<string, unknown> = {};
            try {
                const raw = String(er?.data ?? '');
                billing = JSON.parse(raw.slice(0, raw.lastIndexOf('}') + 1))?.billing ?? {};
            } catch { billing = {}; }
            // LA MISMA REGLA QUE EL FRONT (`resolvePrefillDelComercio`): cuenta como dato lo que no está vacío
            // y no es un «---». Es lo que decide qué campos llegan prellenados y bloqueados.
            const real = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !/^-+$/.test(v.trim());
            const FIELDS: Record<string, string> = {
                first_name: 'nombre', last_name: 'apellido', document_number: 'documento',
                document_type: 'tipo doc', email: 'email', phone: 'celular',
            };
            const withData = Object.entries(FIELDS).filter(([k]) => real(billing[k])).map(([, n]) => n);
            const withoutData = Object.entries(FIELDS).filter(([k]) => !real(billing[k])).map(([, n]) => n);
            r = {
                ureq,
                vinculada: !!link,
                ecommerceRequestId: link?.ecommerce_request_id ?? null,
                orderKey: er?.order_key ?? null,
                processed: er ? Number(er.processed) === 1 : null,
                conDato: withData, sinDato: withoutData,
            };
            break;
        }
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
            const productExists = (await query(`SHOW COLUMNS FROM lenders LIKE 'product'`)).length > 0;
            const productExpr = productExists ? `COALESCE(l.product,'credit')` : `NULL`;
            r = await query(
                `SELECT l.id, COALESCE(l.name,'') AS name, l.response_type AS rt, ${productExpr} AS product, COALESCE(p.name,'default') AS path, l.status AS lender_status, lab.status AS branch_status, COALESCE(la.sort, 9999) AS allied_sort
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
            const row = await one<{ data: string; doc: string }>(
                `SELECT CAST(rcud.data AS CHAR) AS data, COALESCE(u.document_number,'') AS doc
                   FROM risk_central_user_data rcud
                   JOIN users u ON u.id = rcud.user_id
                  WHERE rcud.data IS NOT NULL AND COALESCE(u.document_number,'') NOT LIKE '29%'
                  ORDER BY rcud.id DESC LIMIT 1`);
            if (!row) { r = { ok: false, msg: 'no hay ninguna fila Experian REAL para probar (solo sintéticas)' }; break; }
            let payload = row.data;
            try { const j = JSON.parse(row.data); payload = typeof j === 'string' ? j : row.data; } catch { /* ya es el payload */ }
            const ok = verifyLaravelMac(payload, appKey());
            r = {
                ok,
                probado_contra: `documento ${row.doc.slice(0, 4)}… (fila real, no sintética)`,
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
        // La RADICACIÓN de una solicitud: el paso POSTERIOR al estado 11 que no lo mueve. Existe como
        // subcomando propio porque el panel lo pide por uReq —no por usuario— y porque sin él una corrida
        // «Autorizada» es indistinguible de una donde el paquete nunca llegó a la entidad (F-168).
        // La entidad de una solicitud, con su `response_type`: el panel lo necesita para saber si la
        // corrida quedó esperando un webhook y de cuál de las dos formas (rt=0 genérico vs rt=1 por entidad).
        case 'lender-de': {
            const ur = Number(a[0] || 0);
            if (!ur) { r = { id: null, rt: null }; break; }
            const f = await one<{ id: number; rt: number; name: string }>(
                `SELECT l.id, l.response_type rt, l.name
                   FROM user_requests u JOIN lenders l ON l.id = u.lender_id WHERE u.id = ?`, [ur])
                .catch(() => null);
            r = f ?? { id: null, rt: null };
            break;
        }
        case 'radicacion': {
            const ur = Number(a[0] || 0);
            if (!ur) { r = { estado: null }; break; }
            const f = await one<{ n: string }>(
                `SELECT s.name n FROM lender_transactions t
                   LEFT JOIN lender_transaction_statuses s ON s.id = t.status_id
                  WHERE t.user_request_id = ? ORDER BY t.id DESC LIMIT 1`, [ur]).catch(() => null);
            r = { estado: f?.n ?? null };   // null = esta entidad no radica por transacción
            break;
        }
        case 'activity': { // qué escribió ESTA corrida en la BD, por tabla. → {user, tablas:[{tabla, eventos:[…]}]}
            //
            // La ventana se calcula con el reloj de la BD (`NOW() - INTERVAL n SECOND`), NO con el de
            // node: contra dev la base es remota y una diferencia de reloj de segundos te haría perder
            // eventos o traer basura vieja. El caller pasa CUÁNTOS SEGUNDOS lleva la corrida.
            //
            // ALCANCE, para que no mienta: solo estas tablas y solo filas del usuario de la corrida.
            // No es un tail del binlog — dev es compartida y todo el equipo escribe ahí. Y no ve
            // DELETEs (el scrub borra ANTES de que exista el usuario, así que queda fuera igual).
            const seg = Math.max(1, num(a[0]) || 300);
            const uid = num(a[1]) || (await scalar<number>(
                'SELECT user_id FROM user_requests WHERE created_at >= NOW() - INTERVAL ? SECOND ORDER BY id DESC LIMIT 1', [seg]));
            if (!uid) { r = { user: null, tablas: [] }; break; }
            // `extra` es una expresión SQL opcional que da contexto legible en el hover. Cada tabla va en
            // su propio try: si una columna no existe en este ambiente, se pierde ESA tabla y no la vista
            // entera (la lección de F-64, donde un `l.product` ausente dejaba el panel en blanco).
            const TABLES: Array<{ t: string; where: string; extra?: string }> = [
                { t: 'users', where: 'id = ?', extra: "CONCAT('doc ', COALESCE(document_number,'—'))" },
                { t: 'user_requests', where: 'user_id = ?', extra: "CONCAT('estado ', user_request_status_id, COALESCE(CONCAT(' · flow ', flow_id), ''))" },
                { t: 'user_request_records', where: 'user_id = ?' },
                { t: 'risk_central_user_data', where: 'user_id = ?', extra: "CONCAT('central ', risk_central_id)" },
                { t: 'user_request_risk_central_user_data', where: 'user_request_id IN (SELECT id FROM user_requests WHERE user_id = ?)' },
                { t: 'user_summaries', where: 'user_id = ?' },
                { t: 'user_field_values', where: 'user_id = ?' },
                { t: 'creditop_x_user_requests_records', where: 'user_id = ?' },
                // LA RADICACIÓN al lender: un paso POSTERIOR al estado 11 que NO lo mueve. Sin esta
                // fila, una corrida que quedó en «Autorizada» es indistinguible de una donde el
                // paquete nunca llegó a la entidad (F-168). Sólo `CREDIT_COMPLETED` significa llegó.
                { t: 'lender_transactions',
                  where: 'user_request_id IN (SELECT id FROM user_requests WHERE user_id = ?)',
                  extra: "CONCAT('estado ', COALESCE((SELECT s.name FROM lender_transaction_statuses s WHERE s.id = status_id), 'SIN_ESTADO'))" },
                { t: 'logs', where: 'user_id = ?', extra: 'name' },
            ];
            // Las 9 tablas EN PARALELO: son SELECT independientes (cada uno con su try) y contra dev cada
            // uno paga ~100ms de round-trip. En serie eran ~1s por tick, y el panel pollea cada 2s durante
            // TODA la corrida → cargaba la BD (compartida) casi a la mitad del tiempo. En paralelo baja a
            // ~el más lento. Se preserva el ORDEN de TABLES (mapa por índice) para que la vista no baile.
            const tables = (await Promise.all(TABLES.map(async (d) => {
                try {
                    const rowList = await query(
                        `SELECT id, updated_at AS at,
                                (created_at >= NOW() - INTERVAL ? SECOND) AS nuevo,
                                ${d.extra ?? "''"} AS detalle
                           FROM \`${d.t}\`
                          WHERE ${d.where} AND updated_at >= NOW() - INTERVAL ? SECOND
                          ORDER BY updated_at, id LIMIT 60`, [seg, uid, seg]);
                    if (!rowList.length) return null;
                    return { tabla: d.t, eventos: rowList.map((f: any) => ({
                        id: f.id, at: f.at, op: Number(f.nuevo) === 1 ? 'INSERT' : 'UPDATE', detalle: String(f.detalle ?? ''),
                    })) };
                } catch { return null; /* tabla o columna ausente en este ambiente: se omite, no tumba la vista */ }
            }))).filter(Boolean);
            r = { user: uid, ventanaSeg: seg, tablas: tables };
            break;
        }
        case 'orphans': { // solicitudes que apuntan a un usuario INEXISTENTE. `--fix` las borra.
            // Las produce mezclar ambientes: un `user_id` de una base insertado en otra (F-65). Quedan
            // como minas en la base COMPARTIDA — el siguiente que abra esa solicitud se come un 500
            // opaco de `lenders-v2` sin ningún contexto. Sin `--fix` solo reporta.
            const rowList = await query(
                `SELECT ur.id, ur.user_id, ur.allied_id, ur.user_request_status_id AS estado, ur.created_at
                   FROM user_requests ur LEFT JOIN users u ON u.id = ur.user_id
                  WHERE u.id IS NULL ORDER BY ur.id DESC LIMIT 200`);
            if (a[0] === '--fix' && rowList.length) {
                assertWriteAllowed();
                const ids = rowList.map((x: any) => x.id);
                await exec('DELETE FROM user_requests WHERE id IN (?)', [ids]);
                r = { huerfanas: rowList.length, borradas: ids.length, ids };
            } else {
                r = { huerfanas: rowList.length, filas: rowList,
                      nota: rowList.length ? 'corré con --fix para borrarlas (exige el guard de escritura)' : 'sin huérfanas' };
            }
            break;
        }
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
        case 'merchant-flags': { // los flags del COMERCIO de una sucursal → {hash, alliedId, allied, flags: {initial_fee: bool}}
            // Lectura. Los flags viven en `allieds`, no en la sucursal: cambiar uno cambia TODAS sus sucursales.
            const row = await one<Record<string, any>>(
                `SELECT a.id AS alliedId, a.name AS allied, ${Object.values(MERCHANT_FLAGS).map((c) => `a.${c}`).join(', ')}
                   FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`,
                [String(a[0] ?? '')],
            );
            if (!row) { r = { ok: false, msg: `no encontré la sucursal ${a[0] ?? ''}` }; break; }
            const flags = Object.fromEntries(Object.entries(MERCHANT_FLAGS).map(([k, c]) => [k, Number(row[c]) === 1]));
            r = { ok: true, hash: String(a[0]), alliedId: row.alliedId, allied: row.allied, flags };
            break;
        }
        case 'merchant-flag-set': { // prende/apaga un flag del COMERCIO de una sucursal → {ok, alliedId, flag, value}
            // ⚠ ESCRIBE `allieds`, o sea el comercio entero (todas sus sucursales), y queda puesto después
            // de la corrida. Sólo los flags de MERCHANT_FLAGS: el nombre no llega a la sentencia sin pasar
            // por esa lista.
            assertWriteAllowed('merchant-flag-set');
            const flag = String(a[1] ?? '');
            const column = MERCHANT_FLAGS[flag];
            if (!column) { r = { ok: false, msg: `flag desconocido: ${flag} — válidos: ${Object.keys(MERCHANT_FLAGS).join(', ')}` }; break; }
            const br = await one<{ allied_id: number }>('SELECT allied_id FROM allied_branches WHERE hash = ? LIMIT 1', [String(a[0] ?? '')]);
            if (!br) { r = { ok: false, msg: `no encontré la sucursal ${a[0] ?? ''}` }; break; }
            const value = a[2] === '1' ? 1 : 0;
            const res = await exec(`UPDATE allieds SET ${column} = ? WHERE id = ?`, [value, br.allied_id]);
            r = { ok: true, alliedId: br.allied_id, flag, value: value === 1, affected: res.affectedRows };
            break;
        }
        case 'is-corbeta': { // ¿esta SUCURSAL pertenece al grupo Corbeta? → {hash, alliedId, corbeta, selfManaged, allieds}
            // La lógica vive en `pkg/merchants.ts` porque la comparten este subcomando y `guided.spec.ts`.
            const hash = String(a[0] ?? '');
            r = { hash, ...(await branchCorbeta(hash)) };
            break;
        }
        case 'sucursal-check': { // ¿la sucursal ANUNCIADA es la que el backend le da a ese asesor? → {coincide, esperada, asesor, aviso[]}
            // SÓLO LECTURA: le pregunta al backend por el sub (lo mismo que hace el wizard) y lo
            // compara con el hash del catálogo. No escribe, no reasigna, no borra sesiones — devuelve
            // el desajuste y quien llama decide. Ver la cabecera de `pkg/preflight-branch.ts`.
            const d = await preflightBranch(String(a[0] ?? ''), TARGET, String(a[1] ?? ''));
            r = { ...d, aviso: mismatchNotice(d) };
            break;
        }
        default:
            throw new Error(`comando desconocido: ${cmd || '(vacío)'} — whois|assign|revoke|scrubphone|scrub-sinteticos|list|ecommerce-url|ecommerce-vinculo|synth-fill|lender-rt|flow-id|is-corbeta|sucursal-check`);
    }
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    await close();
} catch (e) {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + '\n');
    await close();
    process.exit(1);
}

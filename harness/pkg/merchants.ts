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

// El teléfono sintético se mudó a `pkg/phones.ts`: había DOS derivaciones del mismo número y
// cada una sabía la mitad (ésta el largo, la de `case.ts` el prefijo). Ver el encabezado de ese archivo.

/** Qué contesta `corbeta_allieds` sobre una sucursal: su allied, si pertenece al grupo, y la lista.
 *
 * ⚠ LA FUENTE DE VERDAD ES EL SETTING, no la lista `[24,209,210,211]` escrita a mano: ese hardcode ya
 * existe 24 veces en el producto (nodo `hardcodes-entidades`) y sumar el 25 acá lo desincronizaría el
 * día que negocio agregue un comercio al grupo. El backend lo lee en tres sitios
 * (`IsCorbetaOnboardingService`, `OnboardingService`, `PurchaseCodeService::isCorbetaAllied`).
 *
 * Vive acá y no en `bin/dbops.ts` porque lo necesitan DOS: el subcomando `is-corbeta` (que el panel
 * consulta) y `dev/guided.spec.ts`, que sin esto elegía el checkout equivocado. Escribirlo dos veces
 * era exactamente lo que el comentario de `is-corbeta` advertía que no se hiciera.
 */
export async function branchCorbeta(branchHash: string): Promise<{ alliedId: number | null; corbeta: boolean; selfManaged: boolean | null; allieds: number[] }> {
    // `self_managed` viaja en la MISMA consulta: es lo que el panel necesita para preseleccionar el
    // canal, y pedirlo aparte sería un viaje más para un dato que ya está en el join.
    const br = await one<{ alliedId: number; selfManaged: number }>(
        'SELECT ab.allied_id AS alliedId, al.self_managed AS selfManaged'
        + ' FROM allied_branches ab JOIN allieds al ON al.id = ab.allied_id WHERE ab.hash = ?',
        [branchHash]);
    const raw = await one<{ value: string }>("SELECT value FROM settings WHERE `key` = 'corbeta_allieds'");
    let allieds: number[] = [];
    try {
        const v = raw?.value as unknown;
        const arr = Array.isArray(v) ? v : JSON.parse(String(v ?? '[]'));
        allieds = (Array.isArray(arr) ? arr : []).map((x: unknown) => Number(x)).filter(Number.isFinite);
    } catch { allieds = []; }
    return {
        alliedId: br?.alliedId ?? null,
        corbeta: br ? allieds.includes(Number(br.alliedId)) : false,
        // null cuando la sucursal no se encontró: no es lo mismo que «no la tiene», y el panel no debe
        // preseleccionar sobre una suposición.
        selfManaged: br ? Number(br.selfManaged) === 1 : null,
        allieds,
    };
}

/**
 * ¿EL FLOW DE CUPO SIGNED DEJA ALGO QUE LISTAR? — F-214.
 *
 * Cuando el cliente contesta «Sí» en «Confirmación de cupo», la solicitud nace con `flow_id = 2` y el
 * listado **se recorta a `rt=0`**: se descartan TODAS las entidades integradas. En una sucursal sin
 * ninguna `rt=0` activa eso deja la pantalla vacía —«No encontramos una opción para ti»— y el cliente
 * no puede volver atrás a cambiar su respuesta.
 *
 * ⚠ Y el `response_type` NO es el mismo en todos los ambientes, que es lo que hace esto difícil de ver:
 * medido el 2026-09-15, Sistecrédito (#9) en la sucursal `13874eb6` es **rt=0 en qa y rt=1 en local**.
 * O sea que el mismo comercio, el mismo «Sí», lista en un ambiente y sale vacío en el otro. Por eso se
 * pregunta a la BASE del target y no se decide de memoria.
 *
 * Vive acá para que haya UNA definición: la usan el panel (aviso previo, condicional) y el runner
 * (aviso en caliente, cuando ya sabe que el flujo quedó firmado).
 */
export async function branchActiveRt0(branchHash: string): Promise<Array<{ id: number; name: string }>> {
      return query<{ id: number; name: string }>(
            `SELECT l.id, l.name
               FROM lenders_by_allied_branches lab
               JOIN allied_branches ab ON ab.id = lab.allied_branch_id
               JOIN lenders l ON l.id = lab.lender_id
              WHERE ab.hash = ? AND l.response_type = 0 AND l.status = 1 AND lab.status = 1
              ORDER BY l.id`,
            [branchHash],
      ).catch(() => []);
}

/**
 * El aviso EN CALIENTE: el flujo ya quedó firmado y se sabe qué hay en la sucursal.
 *
 * A diferencia del aviso del panel —que es previo y condicional («si contestás Sí…»), y por eso se lee
 * y se sigue—, éste se imprime en el momento en que el resultado ya está decidido y antes de que se vea
 * la pantalla vacía. Vacío cuando sí hay con qué listar.
 */
export function quotaWithoutExitNotice(
      rt0: Array<{ id: number; name: string }>,
      branchHash: string,
      uReqID: number | string = '',
      apiBase = '',
): string[] {
      if (rt0.length) return [];
      const lines = [
            `⚠ EL LISTADO VA A SALIR VACÍO, y no es la config del comercio (F-214).`,
            `  El flujo quedó firmado como «cupo ya confirmado» (flow_id=2), y eso recorta el listado a`,
            `  rt=0 — descarta TODAS las integradas. La sucursal ${branchHash} no tiene ninguna rt=0 activa`,
            `  en este ambiente, así que no queda nada que mostrar: vas a ver «No encontramos una opción`,
            `  para ti», y desde ahí el cliente no puede volver a cambiar su respuesta.`,
            `  ⚠ Y ojo que el response_type cambia entre ambientes: Sistecrédito (#9) en esta sucursal es`,
            `  rt=0 en qa y rt=1 en local, así que el mismo «Sí» lista allá y sale vacío acá.`,
      ];
      /**
       * LA CORRIDA SE PUEDE RESCATAR, y decirlo importa tanto como el diagnóstico: hasta ahora este
       * aviso sólo servía para empezar de nuevo, que contra un ambiente desplegado son minutos y un
       * cliente sintético más en la base compartida.
       *
       * La firma del flujo se puede REHACER mientras la solicitud esté en estado 1 o 9
       * (`FLOW_ASSIGNABLE_STATUS_IDS` del backend), y en esta pantalla está en 9. Verificado contra
       * local el 2026-09-15: re-firmar como `standard` devolvió `flowId: 1`, y el listado que usa el
       * front (`lenders-v2`) pasó de 0 a 4 entidades, CrediPullman incluida.
       *
       * Se imprime el comando y NO se ejecuta: cambiar el flujo que el cliente eligió es una decisión
       * de quien prueba, y hacerlo solo dejaría la corrida diciendo que probó un escenario que no era.
       */
      if (uReqID && apiBase) {
            lines.push(
                  `  Para RESCATAR esta corrida sin reiniciarla —el flujo se puede re-firmar en estado 1 o 9—:`,
                  `      curl -s -X POST '${apiBase.replace(/\/$/, '')}/api/v1/user-request/${uReqID}/flow-signature/standard' \\`,
                  `           -H 'Accept: application/json' -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_5)'`,
                  `  y recargá /lenders. Para la próxima, contestá «No» en «Confirmación de cupo».`,
            );
      } else {
            lines.push(`  Para recorrer el flujo entero, contestá «No» en «Confirmación de cupo».`);
      }
      return lines;
}

// ─── Resolver una SUCURSAL para una corrida ─────────────────────────────────────────────────────

export interface ResolvedBranch { id: number; hash: string; com: string; allied: number }

/**
 * Qué sucursal se quiere cuando el comercio se nombró por slug o por nombre (con `#hash` no hay dónde
 * elegir). No es un detalle: un comercio tiene muchas sucursales y la respuesta correcta depende del
 * CANAL por el que se va a entrar.
 *
 * - `con-mas-entidades` — la de mostrador, la que más entidades tiene habilitadas. Es lo que quiere una
 *   corrida que va a mirar el listado.
 * - `con-tienda` — la que tiene credencial de ecommerce. Sin esto, una corrida del canal de tienda caía
 *   en la de mostrador y moría en la entrada, porque ahí no hay checkout que valga.
 */
export type BranchCriterion = 'con-mas-entidades' | 'con-tienda';

/**
 * LA resolución de sucursal para las corridas. Devuelve `null` en vez de tirar: quien la llama ya tiene
 * un mensaje mejor que el que se podría dar acá.
 *
 * ⚠ HABÍA TRES RESOLUCIONES DISTINTAS, y no daban la misma sucursal. Dos copias de esto —una en
 * `case.ts` y otra en `walk-wizard.ts`, y sólo la segunda sabía de `con-tienda`—, más
 * `resolveMerchant` de acá arriba, que ordena por `status DESC, id` en vez de por cantidad de
 * entidades. `resolveMerchant` se queda como está porque sirve a OTRA pregunta (el panel y el
 * ecommerce quieren *un* comercio, tiran si no existe, y devuelven su slug); ésta sirve a las corridas.
 * Si algún día hay que unificarlas, lo que hay que decidir primero es el ORDEN, que es lo que cambia la
 * respuesta.
 *
 * ⚠ Y el orden de intento es `#hash` → slug EXACTO → nombre por subcadena, en ese orden. Antes era sólo
 * nombre con `LIKE`: `pullman` andaba porque «Amoblando Pullman» lo contiene, y `viva-tu-credito` —el
 * slug real— daba «no encontré el comercio». Una tanda de 40 sacada de la base por slug falló entera.
 */
export async function findBranch(ref: string, criterion: BranchCriterion = 'con-mas-entidades'): Promise<ResolvedBranch | null> {
    const byHash = ref.startsWith('#');
    const withStore = criterion === 'con-tienda' && !byHash;
    return one<ResolvedBranch>(
        byHash
            ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE b.hash = ? LIMIT 1`
            : withStore
            ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id
                 JOIN allied_ecommerce_credentials c ON c.allied_branch_id = b.id
                WHERE x.slug = ? OR x.name LIKE ?
                ORDER BY (x.slug = ?) DESC, b.id LIMIT 1`
            : `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id
                WHERE x.slug = ? OR x.name LIKE ?
                ORDER BY (x.slug = ?) DESC,
                         (SELECT COUNT(*) FROM lenders_by_allied_branches l WHERE l.allied_branch_id = b.id) DESC LIMIT 1`,
        byHash ? [ref.slice(1)] : [ref, `%${ref}%`, ref],
    ).catch(() => null);
}

/**
 * El tipo de documento que el comercio acepta, según el propio backend.
 *
 * ⚠ SE LE PREGUNTA AL BACKEND Y NO A LA BASE porque el payload ya viene recortado por el catálogo del
 * país: es la misma lista que ve el cliente en el formulario. Sin esto, un comercio dominicano moría
 * con «el tipo de documento no está habilitado en este punto de venta».
 *
 * Si el backend no publica la lista, queda `CC` — que es lo que había antes de que la lista existiera,
 * así que no cambia el comportamiento de los comercios colombianos.
 *
 * La caché es por proceso y estaba DUPLICADA junto con la función, o sea dos cachés para el mismo dato.
 */
const typesByMerchant = new Map<string, string>();

export async function merchantDocumentType(apiBase: string, hash: string): Promise<string> {
    const cached = typesByMerchant.get(hash);
    if (cached) return cached;

    let kind = 'CC';
    try {
        const r = await fetch(`${apiBase}/api/loans/allied/${hash}`, { signal: AbortSignal.timeout(20_000) });
        const j = await r.json() as { data?: { allowed_document_types?: string[] } };
        const list = j?.data?.allowed_document_types;
        if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'string') kind = list[0];
    } catch { /* sin payload, queda 'CC' */ }

    typesByMerchant.set(hash, kind);
    return kind;
}

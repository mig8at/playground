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

/** El TELÉFONO que acepta el comercio, por el largo que declara SU país.
 *
 * El harness traía un móvil colombiano fijo, y contra un comercio de otro país el registro se cae con
 * un 422 de validación —«el número de celular debe tener 9 dígitos» con Perú— antes de llegar a nada
 * interesante. El largo no es una regla del código: está en `countries.cell_phone_lenght`, así que se
 * le pregunta al país en vez de mantener una tabla acá.
 *
 * El prefijo se toma del primer dígito del móvil colombiano (3) o, para el resto, del `phone_code` sin
 * el `+` — lo que importa para pasar la validación es el LARGO, no que el número sea plausible en la
 * red real: es un teléfono sintético que nunca recibe nada. */
export async function telefonoDeLaSucursal(branchHash: string, semilla = 3131010101): Promise<string> {
    const [fila]: any[] = await query(
        `SELECT c.cell_phone_lenght AS largo, c.name AS pais
           FROM allied_branches b JOIN allieds a ON a.id=b.allied_id
           JOIN countries c ON c.id=a.country_id WHERE b.hash=? LIMIT 1`, [branchHash]);
    const largo = Number(fila?.largo) || 10;
    const base = String(semilla).replace(/\D/g, '');
    // Se recorta o se rellena hasta el largo del país, conservando el primer dígito para que no
    // arranque en 0 (que varias validaciones rechazan aparte).
    const cuerpo = (base + base).slice(0, Math.max(largo - 1, 1));
    return (base[0] || '9') + cuerpo.slice(0, largo - 1);
}

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
export async function corbetaDeLaSucursal(branchHash: string): Promise<{ alliedId: number | null; corbeta: boolean; selfManaged: boolean | null; allieds: number[] }> {
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
 * ¿EL FLUJO DE CUPO FIRMADO DEJA ALGO QUE LISTAR? — F-214.
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
export async function rt0ActivasDeLaSucursal(branchHash: string): Promise<Array<{ id: number; name: string }>> {
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
export function avisoDeCupoSinSalida(
      rt0: Array<{ id: number; name: string }>,
      branchHash: string,
      uReqID: number | string = '',
      apiBase = '',
): string[] {
      if (rt0.length) return [];
      const lineas = [
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
            lineas.push(
                  `  Para RESCATAR esta corrida sin reiniciarla —el flujo se puede re-firmar en estado 1 o 9—:`,
                  `      curl -s -X POST '${apiBase.replace(/\/$/, '')}/api/v1/user-request/${uReqID}/flow-signature/standard' \\`,
                  `           -H 'Accept: application/json' -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_5)'`,
                  `  y recargá /lenders. Para la próxima, contestá «No» en «Confirmación de cupo».`,
            );
      } else {
            lineas.push(`  Para recorrer el flujo entero, contestá «No» en «Confirmación de cupo».`);
      }
      return lineas;
}

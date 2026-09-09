// montar-alta.ts — deja el comercio ALTA FLEET y su entidad propia usables en LOCAL.
//
// QUÉ ES ALTA FLEET. Un comercio de motos que entró como marca de upselling con SaaS de $250.000 y
// **línea de crédito propia** (Slack #comercial, 2026-08-27). Línea propia = modelo **CreditopX**
// (`response_type = 2`): el capital y el riesgo son del comercio y CreditOp opera y cobra comisión.
// Es el mismo molde que Motai, y hereda dos rasgos suyos: producto sobre moto y población
// gig/migrante, que necesita el tipo de documento **PEP** (Permiso Especial de Permanencia).
//
// ⚠ EN PRODUCCIÓN EL COMERCIO YA EXISTE Y ESTÁ A MEDIAS: `allieds` 346 «Alta», Colombia, creado el
// 2026-08-31, con una sucursal (2262 «Calle 90», Bogotá) cableada a las DOS entidades de Bancolombia
// (68 y 100, las dos `rt=1`) y **cero solicitudes**. O sea que lo que falta allá es su entidad propia.
// Acá NO se reproduce ese estado a medias: se monta el destino, para poder ejercitarlo.
//
// PRODUCTO: **Rent to Own** — el cliente se queda con la moto (decisión de Miguel, 2026-09-09). Eso no
// es cosmético: con opción de compra hay saldo, hay interés y **aplica el techo de usura**; sin ella el
// cliente paga por usar y no hay nada que amortizar. Y ⚠ la terminología del código está invertida
// respecto del PRD de Motai: el `renting` del código es el *rent-to-own* del PRD.
//
// EL MOLDE ESTÁ PARTIDO EN DOS, y no por gusto: en esta base ninguna entidad tiene el árbol completo.
//   · **170 (Motai RB)** — `product = 'rto'`, y es la que tiene lo operativo que la 173 no tiene:
//     proveedor de identidad, `lender_requirements` y reglas de datacrédito.
//   · **173 (Rent to Own)** — es la que tiene el **catálogo de documentos del RTO**: contrato con
//     opción de adquisición, acuerdo de codeudoría, pagaré + carta, **garantía mobiliaria** y plan de
//     pagos. La 170 tiene CERO documentos.
// Medido el 2026-09-09 sobre la base local; si eso cambia, el script lo dice al arrancar.
//
// ⚠⚠ ESTO ES CONFIG DE PRUEBA, NO DE NEGOCIO. Las reglas duras, los perfiles y la calculadora salen de
// Motai sin revisar — exactamente lo que el docblock de la migración del clon del RTO desaconseja
// («un gemelo a medias con reglas de riesgo copiadas sin revisar, que es peor que no tenerlas»).
// Sirve para EJERCITAR el flujo. Cualquier conclusión sobre conducta —a quién se le ofrece, con qué
// cupo, con qué cuota— medida sobre esta config está midiendo a Motai, no a Alta Fleet.
//
// Uso:   E2E_TARGET=local node dev/montar-alta.ts
//        E2E_TARGET=local node dev/montar-alta.ts --clean
import { query, one, exec, assertWriteAllowed, TARGET } from '../pkg/db.ts';
import { readFileSync, writeFileSync } from 'node:fs';

assertWriteAllowed();
if (TARGET !== 'local') {
    // Es data sintética de un comercio que en el ambiente compartido existe DE VERDAD (allied 346):
    // sembrar un homónimo en dev/staging —que además comparten la misma base— dejaría dos «Alta» y
    // nadie sabría cuál es el real.
    throw new Error(`montar-alta sólo corre en local (E2E_TARGET=${TARGET}); es data sintética`);
}

const PAIS_COLOMBIA = 47;
const CIUDAD_BOGOTA = 149;          // `country_cities`.id — la misma que usan las sucursales de Motai
const MOLDE_OPERATIVO = 170;        // Motai RB: identidad, requirements, reglas de datacrédito
const MOLDE_DOCUMENTOS = 173;       // Rent to Own: el catálogo de documentos con opción de adquisición
const TIPO_TITULAR = 1, TIPO_COSIGNER = 3;

/* EL ID VA FIJO, y el motivo es la suite. Con auto-increment cada re-siembra da un id nuevo (208,
   209, 210…) y `suites/alta.json` no puede declarar a quién espera en el listado: la suite se
   rompería sola en cada corrida. Es la misma decisión que `montar-peru.ts` toma con 206/207, sólo que
   ahí el id además lo referencia el código.
   ⚠ Y NO significa que el id sea el mismo en otros ambientes: en producción lo asigna el admin. Por
   eso las migraciones del Rent to Own resuelven por `slug` y no por id — y por eso el mapa de
   builders que rompe la firma (F-188) está roto justamente por confiar en el id. */
const ID_LENDER = 211;
const SLUG_LENDER = 'altax';
const NOMBRE_COMERCIO = 'Alta Fleet';
const SLUG_COMERCIO = 'alta-fleet';
const NOMBRE_SUCURSAL = 'Calle 90';
const NOMBRE_LENDER = 'AltaX';

/* LA CALCULADORA. Es la del Rent to Own que corre HOY en producción (lender 193), leída el 2026-09-09.
 * Va literal y no inventada porque es la única referencia de un `product = 'rto'` en operación: plazos
 * en MESES (12/18/24) que la fórmula convierte a semanas (52/78/104), y la cuota como PMT sobre la tasa
 * semanal equivalente `(1+rate)^(12/52) − 1`.
 *
 * ⚠ LOS NÚMEROS SON DE MOTAI, NO DE ALTA FLEET. `margin`, `setup_fee`, `extras`, `initial_fee` y `rate`
 * son el precio del negocio de Motai. La calculadora propia de Alta Fleet es una decisión de producto
 * que todavía no está tomada, y cuando lo esté va por migración: `lenders.calculator` no lo puede poner
 * ningún panel (verificado por ausencia en `main`, ni en el admin de `legacy-application` ni en
 * `Modules/Backoffice`).
 *
 * ⚠ Y ojo con «arreglar» el prorrateo: el parámetro se llama `anchor_rate` en el renting justamente
 * porque ahí NO es una tasa. Acá sí lo es (`rate`), porque el producto con opción de compra sí tiene
 * saldo. Convertir uno en el otro no es un fix, es recaracterizar el producto. */
const CALCULADORA_RTO = {
    plans: [
        { id: '12', label: '12', weeks: 52, default: true },
        { id: '18', label: '18', weeks: 78 },
        { id: '24', label: '24', weeks: 104 },
    ],
    params: { tax: 0.19, rate: 0.018, extras: 1000000, margin: 1, setup_fee: 1500000, initial_fee: 2000000 },
    formulas: [
        { name: 'amount', expression: '((amount - initial_fee + setup_fee) * (1 + margin) + extras) * (1 + tax)' },
        { name: 'payment', expression: 'amount * ((1 + rate) ** (12 / 52) - 1) / (1 - (1 + rate) ** (-weeks * 12 / 52))' },
    ],
};

const CLEAN = process.argv.includes('--clean');
const paso = (t: string, d = '') => console.log(`  ${t}${d ? ` · ${d}` : ''}`);

/** El hash de entrada, con la misma forma que el admin: crc32 del segundo (`AlliedController::store`). */
const nuevoHash = () => {
    // No se usa el mismo `date('Y-m-d H:i:s')` del admin porque acá se generan DOS en el mismo segundo
    // (comercio y sucursal) y saldrían idénticos; el hash de la sucursal es la llave de TODO el flujo.
    let h = 0xffffffff;
    for (const c of `${Date.now()}-${Math.random()}`) {
        h ^= c.charCodeAt(0);
        for (let i = 0; i < 8; i++) h = (h >>> 1) ^ (0xedb88320 & -(h & 1));
    }
    return ((h ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
};

/** Clona una fila cambiando lo que se le diga. Los objetos se serializan (las columnas JSON). */
async function clonar(tabla: string, fila: any, cambios: Record<string, any>): Promise<number> {
    const r: any = { ...fila, ...cambios };
    if (!('id' in cambios)) delete r.id;
    delete r.created_at; delete r.updated_at;
    const cols = Object.keys(r);
    const vals = cols.map((c) => (r[c] !== null && typeof r[c] === 'object') ? JSON.stringify(r[c]) : r[c]);
    const res = await exec(
        `INSERT INTO \`${tabla}\` (${cols.map((c) => '`' + c + '`').join(',')}, created_at, updated_at) ` +
        `VALUES (${cols.map(() => '?').join(',')}, NOW(), NOW())`, vals);
    return res.insertId;
}

// ── LIMPIEZA ────────────────────────────────────────────────────────────────────────────────────
// Se borra POR ALCANCE (el comercio por slug, la entidad por slug) y no «todo lo que haya»: en esta
// base conviven Motai, Pullman y los comercios de los otros países.
async function limpiar() {
    /* Se busca por slug O por el id fijo: una corrida interrumpida puede haber dejado la fila del id
       sin el resto, y entonces buscar sólo por slug la dejaría ahí para que el INSERT choque con un
       duplicado — que es un error que no dice nada sobre la causa. */
    const lender = await one<{ id: number }>('SELECT id FROM lenders WHERE slug=? OR id=?', [SLUG_LENDER, ID_LENDER]);
    const comercio = await one<{ id: number }>('SELECT id FROM allieds WHERE slug=?', [SLUG_COMERCIO]);
    const sucursales = comercio
        ? (await query<{ id: number }>('SELECT id FROM allied_branches WHERE allied_id=?', [comercio.id])).map((s) => s.id)
        : [];

    if (lender) {
        /* ⚠ `lender_users_category_rules` ANTES que `lender_users_categories`: la regla apunta a la
           categoría, así que al revés corta con un 1451. Y `lender_rules` antes que `group_rules`, por
           lo mismo. */
        for (const t of ['lender_users_category_rules', 'lender_users_categories', 'lender_signing_documents',
                         'lender_identity_validation_types', 'lender_requirements', 'lender_datacredito_rules',
                         'lender_rules', 'credit_line_by_lenders', 'lenders_by_allied_branches', 'lenders_by_allieds'])
            await exec(`DELETE FROM ${t} WHERE lender_id=?`, [lender.id]);
        await exec('DELETE FROM lenders WHERE id=?', [lender.id]);
    }
    if (sucursales.length) {
        const marcas = sucursales.map(() => '?').join(',');
        // Los `group_rules` son de la SUCURSAL, no de la entidad: se borran con ella y no con el lender.
        await exec(`DELETE FROM lender_rules WHERE group_rule_id IN (SELECT id FROM group_rules WHERE allied_branch_id IN (${marcas}))`, sucursales);
        await exec(`DELETE FROM group_rules WHERE allied_branch_id IN (${marcas})`, sucursales);
        await exec(`DELETE FROM lenders_by_allied_branches WHERE allied_branch_id IN (${marcas})`, sucursales);
        await exec(`DELETE FROM allied_branches WHERE id IN (${marcas})`, sucursales);
    }
    if (comercio) {
        await exec('DELETE FROM lenders_by_allieds WHERE allied_id=?', [comercio.id]);
        await exec('DELETE FROM allieds WHERE id=?', [comercio.id]);
    }
    return { lender: lender?.id, comercio: comercio?.id, sucursales: sucursales.length };
}

const borrado = await limpiar();
if (CLEAN) {
    console.log(`\n  ✓ limpieza hecha · comercio=${borrado.comercio ?? '—'} sucursales=${borrado.sucursales} entidad=${borrado.lender ?? '—'}\n`);
    process.exit(0);
}
if (borrado.comercio || borrado.lender) paso('lo anterior', 'borrado antes de volver a sembrar (el script es idempotente por reemplazo)');

// ── LOS MOLDES, comprobados antes de usarlos ────────────────────────────────────────────────────
// Se comprueba lo que hace posible este montaje, porque si un molde perdió su parte el error sale acá
// y no tres pasos más adelante disfrazado de «el flujo no genera documentos».
const moldeLender = await one<any>('SELECT * FROM lenders WHERE id=?', [MOLDE_DOCUMENTOS]);
if (!moldeLender) {
    console.log(`\n  ✗ no existe el lender ${MOLDE_DOCUMENTOS} (rent-to-own). Corré primero su migración:`);
    console.log('    php artisan migrate --path=database/migrations/2026_08_15_140000_clone_motai_renting_lender_as_rent_to_own.php\n');
    process.exit(2);
}
const moldeMotai = await one<any>('SELECT * FROM allieds WHERE id=158');
if (!moldeMotai) { console.log('\n  ✗ no existe el comercio Motai (158): es el molde de los toggles del comercio.\n'); process.exit(2); }

const docsMolde = await query<any>('SELECT * FROM lender_signing_documents WHERE lender_id=? ORDER BY sort', [MOLDE_DOCUMENTOS]);
const catsMolde = await query<any>('SELECT * FROM lender_users_categories WHERE lender_id=? ORDER BY id', [MOLDE_DOCUMENTOS]);
if (!docsMolde.length) console.log(`  ⚠ el molde ${MOLDE_DOCUMENTOS} no tiene catálogo de documentos: la entidad va a nacer sin documentos que firmar`);
if (!catsMolde.length) console.log(`  ⚠ el molde ${MOLDE_DOCUMENTOS} no tiene perfiles: sin perfiles una entidad rt=2 NO lista`);

console.log(`\n  Alta Fleet · Rent to Own · molde operativo ${MOLDE_OPERATIVO} + documentos ${MOLDE_DOCUMENTOS}\n`);

// ── 1 · EL COMERCIO ─────────────────────────────────────────────────────────────────────────────
// Se clona el de Motai y se pisa la identidad. Clonar y no construir a mano es deliberado: `allieds`
// tiene 30 columnas NOT NULL —la mayoría toggles que se fueron acumulando— y armarlas de cero es una
// lista que caduca sola. Lo que se pisa es lo que Alta Fleet decide por ser Alta Fleet.
const hashComercio = nuevoHash();
const idComercio = await clonar('allieds', moldeMotai, {
    name: NOMBRE_COMERCIO,
    slug: SLUG_COMERCIO,
    hash: hashComercio,
    country_id: PAIS_COLOMBIA,
    status: 1,
    /* Los toggles que en producción tiene el comercio 346, para que local no describa otro comercio:
       medidos el 2026-09-09 → `have_ctopx=0`, `initial_fee=0`, `show_products=0`, `self_managed=0`,
       `flow_type=0`. ⚠ `have_ctopx = 0` NO impide que liste una entidad rt=2: Motai lo tiene en 0 y
       Pullman también, y los dos listan sus CreditopX. Es un toggle de PANTALLAS del comercio. */
    have_ctopx: 0, initial_fee: 0, show_products: 0, self_managed: 0, flow_type: 0,
});
paso('comercio', `${idComercio} «${NOMBRE_COMERCIO}» · Colombia · hash ${hashComercio}`);

// ── 2 · LA SUCURSAL ─────────────────────────────────────────────────────────────────────────────
// El `hash` de la sucursal es la llave de TODO el flujo: la ruta del wizard es
// `/merchant/{partner_hash}/solicitar` y el contexto de entrada se resuelve por él.
const moldeSucursal = await one<any>('SELECT * FROM allied_branches WHERE allied_id=158 LIMIT 1');
const hashSucursal = nuevoHash();
const idSucursal = await clonar('allied_branches', moldeSucursal, {
    allied_id: idComercio,
    name: NOMBRE_SUCURSAL,
    hash: hashSucursal,
    country_city_id: CIUDAD_BOGOTA,
    status: 1,
});
paso('sucursal', `${idSucursal} «${NOMBRE_SUCURSAL}» · Bogotá D.C. · hash ${hashSucursal}`);

// ── 3 · LA ENTIDAD ──────────────────────────────────────────────────────────────────────────────
// `document_types` con PEP va ACÁ, en la entidad, y no en la fila de sucursal. Es el mecanismo nuevo:
// `DocumentTypesService::resolver()` toma las entidades ACTIVAS del punto de venta, une sus
// `lenders.document_types` y **recorta con el catálogo del país** (Colombia = ["CC","CE","PEP"]). El
// país es TECHO, no piso. El mecanismo viejo —copiar los tipos a `lenders_by_allied_branches`— es el
// que produjo F-76: la fila nueva nacía en NULL y el PEP desaparecía sin error y sin log.
const idLender = await clonar('lenders', moldeLender, {
    id: ID_LENDER,
    name: NOMBRE_LENDER,
    slug: SLUG_LENDER,
    response_type: 2,
    product: 'rto',
    document_types: ['CC', 'CE', 'PEP'],
    calculator: CALCULADORA_RTO,
    country_id: PAIS_COLOMBIA,
    status: 1,
    /* La `url` se limpia: es de la entidad molde y en un rt=2 no se usa (no hay redirect externo),
       pero dejarla adentro hace que una traza mienta sobre a dónde iba el cliente. */
    url: null,
});
paso('entidad', `${idLender} «${NOMBRE_LENDER}» · rt=2 · product=rto · ["CC","CE","PEP"]`);

// ── 4 · EL CABLEADO: comercio (economía) + sucursal (membresía) ─────────────────────────────────
// La asimetría es el hecho central del modelo y conviene tenerla presente al leer esto: la SUCURSAL
// no tiene economía propia —su fila son 5 columnas de membresía— y toda la plata vive en
// `lenders_by_allieds`, a nivel COMERCIO.
const economiaMolde = await one<any>('SELECT * FROM lenders_by_allieds WHERE lender_id=? LIMIT 1', [MOLDE_OPERATIVO]);
if (economiaMolde) {
    await clonar('lenders_by_allieds', economiaMolde, { lender_id: idLender, allied_id: idComercio, url_utm: null });
    paso('lenders_by_allieds', `la economía, clonada del ${MOLDE_OPERATIVO} (comisión, seguros, FGA, iva, tope)`);
} else paso('lenders_by_allieds', `⚠ el molde ${MOLDE_OPERATIVO} no tiene fila: la entidad queda sin economía`);

const membresiaMolde = await one<any>('SELECT * FROM lenders_by_allied_branches WHERE lender_id=? LIMIT 1', [MOLDE_OPERATIVO]);
await clonar('lenders_by_allied_branches', membresiaMolde ?? { sort: 1 }, {
    lender_id: idLender, allied_branch_id: idSucursal, status: 1, url_utm: null,
    /* Se deja en NULL a propósito: el respaldo por sucursal ya no lo lee `resolver()` —manda
       `lenders.document_types`—, así que poner un valor acá sería un dato que no decide nada. */
    document_types: null,
});
paso('lenders_by_allied_branches', 'activada en la sucursal (status=1)');

for (const l of await query<any>('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [MOLDE_OPERATIVO]))
    await clonar('credit_line_by_lenders', l, { lender_id: idLender });
paso('credit_line_by_lenders', `línea de crédito, clonada del ${MOLDE_OPERATIVO}`);

// ── 5 · LA POLÍTICA DURA: plantilla Y clon por sucursal, alineados ──────────────────────────────
// ESTO ES LO QUE MÁS IMPORTA DE TODO EL SCRIPT, y es lo que el admin viejo NO puede hacer para una
// entidad nueva.
//
// Hay DOS puertas sobre el mismo solicitante: la **plantilla** (`group_rule_id IS NULL`) la evalúa el
// cupo de CreditopX, y los **clones por sucursal** los evalúa el listado del onboarding. Verlas
// divergir es lo que hace que una entidad aparezca en el listado y después falle al pedir cupo.
//
// El admin (`LenderRulesController::addNewLenderRule`) usa como plantilla las `lender_rules`
// HUÉRFANAS de la entidad — que en una entidad nueva son CERO —, así que crea el `GroupRule`
// `AB<sucursal>` **vacío**. Y según el docblock del writer del backoffice, esa sucursal «ofrecería el
// lender sin ningún filtro mientras el cupo lo rechaza con la política recién guardada». En esta base
// ya hay cuatro grupos así en la sucursal 682 de Motai (7846, 7847, 3603, 7861, con 0 reglas).
//
// La forma correcta en producción es `PUT /api/backoffice/lenders/{id}/rules`, que escribe las dos en
// una transacción (`LenderRulesWriterService`). Acá se hace lo mismo a mano porque esa ruta pide un
// token del pool de STAFF que el harness no tiene.
/* Se toman las reglas de UN grupo y no un `GROUP BY name` sobre todos: la base local corre con
   `only_full_group_by`, así que agrupar por nombre y pedir `*` es un error 1055 — y además, si dos
   sucursales tuvieran el mismo nombre de regla con valores distintos, quedaría el valor de una al
   azar. Un grupo entero es un conjunto coherente. */
const reglasMolde = await query<any>(
    `SELECT * FROM lender_rules
      WHERE lender_id = ?
        AND group_rule_id = (SELECT MIN(group_rule_id) FROM lender_rules
                              WHERE lender_id = ? AND group_rule_id IS NOT NULL)
      ORDER BY id`, [MOLDE_OPERATIVO, MOLDE_OPERATIVO]);
if (!reglasMolde.length) paso('lender_rules', `⚠ el molde ${MOLDE_OPERATIVO} no tiene reglas duras: la entidad nace sin filtros`);
else {
    for (const r of reglasMolde) await clonar('lender_rules', r, { lender_id: idLender, group_rule_id: null });
    const idGrupo = await clonar('group_rules', { allied_branch_id: idSucursal, rule_name: `AB${idSucursal}` }, {});
    for (const r of reglasMolde) await clonar('lender_rules', r, { lender_id: idLender, group_rule_id: idGrupo });
    paso('lender_rules', `${reglasMolde.length} en la plantilla + ${reglasMolde.length} en el grupo AB${idSucursal} (${idGrupo}) — alineadas`);
}

// Las reglas de DATACRÉDITO son filtro duro del listado y se reparten igual: una genérica
// (`allied_branch_id IS NULL`) más una copia por sucursal. El admin las clona con una compuerta de
// país que acá se cumple (Colombia), pero cae al lender 5 (BdB) si la entidad no tiene plantilla.
const dcMolde = await one<any>('SELECT * FROM lender_datacredito_rules WHERE lender_id=? AND allied_branch_id IS NULL', [MOLDE_OPERATIVO])
    ?? await one<any>('SELECT * FROM lender_datacredito_rules WHERE lender_id=? LIMIT 1', [MOLDE_OPERATIVO]);
if (dcMolde) {
    await clonar('lender_datacredito_rules', dcMolde, { lender_id: idLender, allied_branch_id: null });
    await clonar('lender_datacredito_rules', dcMolde, { lender_id: idLender, allied_branch_id: idSucursal });
    paso('lender_datacredito_rules', `genérica + copia de la sucursal, clonadas del ${MOLDE_OPERATIVO}`);
} else paso('lender_datacredito_rules', `⚠ el molde ${MOLDE_OPERATIVO} no tiene: el filtro de buró queda sin fila`);

// ── 6 · LOS PERFILES ────────────────────────────────────────────────────────────────────────────
// Van los CUATRO tiers, no uno: con sólo el «Premium» —el más estricto— un cliente que no lo pasa se
// queda sin categoría y la tarjeta desaparece del listado. Medido en la tarea del Rent to Own.
//
// Y van TODOS con `requires_cosigner = 1`, que es la consecuencia directa de haber elegido Rent to Own:
// el catálogo de documentos del RTO **sólo tiene la rama con codeudor** (legal entregó únicamente las
// versiones con deudor solidario), y `SigningDocumentResolver::resolveForPolicy()` filtra por
// `requires_cosigner`. Un tier sin codeudor no encontraría documentos y el flujo seguiría como si no
// hubiera catálogo — sin error y sin log.
if (!catsMolde.length) paso('lender_users_categories', '⚠ sin perfiles: la entidad rt=2 NO va a listar');
else {
    for (const c of catsMolde) {
        const nuevoId = await clonar('lender_users_categories', c, { lender_id: idLender, requires_cosigner: 1 });
        for (const g of await query<any>('SELECT * FROM lender_users_category_rules WHERE lender_users_category_id=?', [c.id])) {
            /* Una copia de cada criterio por TIPO: la política del codeudor es de otro tipo que la del
               titular, y sin la de tipo 3 el endpoint de cupo del codeudor no responde `has_quota`. */
            for (const tipo of [TIPO_TITULAR, TIPO_COSIGNER])
                await clonar('lender_users_category_rules', g, {
                    lender_id: idLender, lender_users_category_id: nuevoId, lender_users_category_type_id: tipo,
                });
        }
    }
    paso('lender_users_categories', `${catsMolde.length} perfiles con criterios de titular Y codeudor, todos requires_cosigner=1`);
}

// ── 7 · LO QUE HACE QUE EL FLUJO NO SE CAIGA ────────────────────────────────────────────────────
// Sin proveedor de identidad ACTIVO en `order 1`, `validation/providers` responde «Lender has no
// primary identity validation provider configured» — y es uno de los cinco chequeos de
// `LenderReadinessService`, el que dice que sin él «el flujo de validación no falla ordenadamente».
for (const t of ['lender_identity_validation_types', 'lender_requirements']) {
    const filas = await query<any>(`SELECT * FROM ${t} WHERE lender_id=?`, [MOLDE_OPERATIVO]);
    if (!filas.length) { paso(t, `⚠ el molde ${MOLDE_OPERATIVO} no tiene fila`); continue; }
    /* ⚠ ÁBACO SE APAGA A MANO, y encontrarlo prendido fue el motivo de esta línea. El molde 170 lo
       tiene en 1 —no porque alguien lo decidiera para él, sino porque la migración de la v2 hizo
       backfill desde `product IN ('renting','rto')`—, así que clonarlo tal cual le habría dado a Alta
       Fleet el underwriting alternativo por ingresos gig SIN que nadie lo pidiera. Es justo el «gemelo
       a medias» que hay que evitar: heredar una decisión de negocio de Motai por venir en la misma
       fila. Y además rompería la corrida: en local el camino feliz de Ábaco sólo existe con
       `bin/mock-abaco`, y en dev/qa no hay mock, así que el login va al proveedor real.
       El día que Alta Fleet lo pida, es un UPDATE de esta columna. */
    const apagarAbaco = t === 'lender_requirements' ? { abaco_is_enabled: 0 } : {};
    for (const f of filas) await clonar(t, f, { lender_id: idLender, ...apagarAbaco });
    paso(t, `${filas.length}, clonada(s) del ${MOLDE_OPERATIVO}`
        + (t === 'lender_requirements' ? ' · Ábaco APAGADO (el molde lo trae en 1)' : ''));
}

// El catálogo de documentos: la pieza que DISTINGUE renting de rent-to-own. No es el `product` ni la
// calculadora — los dos productos comparten `response_type`, wizard y motor de pasos. La diferencia
// vive acá: contrato con opción de adquisición + garantía mobiliaria (`chattel_mortgage`, que no podía
// llamarse `guarantee` porque ese nombre ya es del FGA y tiene su propia tabla y su propio guard).
for (const d of docsMolde) await clonar('lender_signing_documents', d, { lender_id: idLender });
paso('lender_signing_documents', `${docsMolde.length} del ${MOLDE_DOCUMENTOS}: ${docsMolde.map((d) => d.document_type).join(', ')}`);

// ── 8 · QUE EL HARNESS SEPA NOMBRARLO ───────────────────────────────────────────────────────────
// Sin esta entrada el comercio existe en la base y los runners no lo saben direccionar por slug, que
// es la mitad más frustrante de montar un ambiente.
const RUTA_FLOWS = new URL('../.flows.json', import.meta.url);
try {
    const flows = JSON.parse(readFileSync(RUTA_FLOWS, 'utf8'));
    flows.merchants ??= {};
    flows.merchants.alta = {
        branch_hash: hashSucursal, allied_id: idComercio, branch_id: idSucursal, name: NOMBRE_COMERCIO,
    };
    writeFileSync(RUTA_FLOWS, JSON.stringify(flows, null, 2) + '\n');
    paso('.flows.json', `slug «alta» → sucursal ${idSucursal} (hash ${hashSucursal})`);
} catch (e: any) {
    paso('.flows.json', `✗ no pude escribirlo: ${e.message}`);
}

console.log(`
  Comprobalo:
    make harness-listado COMERCIO=alta          ¿le sale AltaX (${idLender}) al cliente, y por qué no las otras?
    make harness-caso CASOS='alta' CERRAR=1 LAMBDA=1
    make harness-suite SUITE=harness/suites/alta.json CERRAR=1 LAMBDA=1

  ⚠ Y el flujo va a PEDIR CODEUDOR antes de firmar: es la conducta correcta del Rent to Own, no un
    fallo. Los perfiles exigen codeudor porque su catálogo de documentos sólo tiene esa rama.
`);
process.exit(0);

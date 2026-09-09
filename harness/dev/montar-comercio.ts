// montar-comercio.ts — SIEMBRA UN COMERCIO ENTERO EN LOCAL desde un spec declarativo.
//
// Nació como `montar-alta.ts`, un script de un comercio, y se generalizó en el mismo día: la tercera
// vez que se copia un seeder de comercio, lo que hay que versionar es el DATO, no el script. Los
// comercios viven en `harness/comercios/<slug>.json` y esto sólo sabe montarlos.
//
// QUÉ CONTESTA. «¿Cómo se porta un comercio configurado ASÍ?» sin tener que pedirle a nadie que lo
// arme en el admin. Cubre la forma COMÚN —comercio, sucursales, entidades `rt=2` con molde— que es la
// que se repite. Lo que NO cubre, y a propósito: las integraciones de un país o de una entidad
// externa (credenciales cifradas, estados de transacción, plantillas de formulario). Eso vive en su
// propio script —`montar-peru.ts` es el ejemplo— porque es lógica, no dato, y meterlo acá volvería
// este archivo un `switch` por comercio: exactamente el anti-patrón que el nodo
// `hardcodes-entidades` documenta como el dolor que frena la plataforma.
//
// ⚠⚠ ES CONFIG DE PRUEBA, NO DE NEGOCIO. Las reglas duras, los perfiles y la calculadora salen de un
// molde SIN REVISAR — exactamente lo que el docblock de la migración del clon del Rent to Own
// desaconseja («un gemelo a medias con reglas de riesgo copiadas sin revisar, que es peor que no
// tenerlas»). Sirve para EJERCITAR el flujo. Cualquier conclusión sobre conducta —a quién se le
// ofrece, con qué cupo, con qué cuota— medida sobre esto está midiendo al MOLDE, no al comercio.
//
// EL SPEC, campo por campo:
//
//   nombre, slug, porque   identidad del comercio. `porque` es prosa para el próximo que lo lea.
//   pais                   `countries`.id (Colombia 47 · RD 60 · Perú 167).
//   molde_comercio         de qué comercio se clonan los 30 toggles NOT NULL de `allieds`.
//   comercio {…}           los toggles que este comercio decide por ser él. `self_managed` es el que
//                          apaga el «continuá con el asesor comercial». Y cualquier columna de
//                          `allieds` que quieras pisar — `image` es la que evita que el comercio salga
//                          con el LOGO DEL MOLDE, que es la confusión más barata de eliminar: un
//                          comercio de prueba con el logo de Motai se lee como si fuera Motai. Las
//                          imágenes de prueba viven en `harness/images/` y las sirve el panel
//                          (`http://localhost:5195/images/<archivo>.png`); `allieds.image` es
//                          varchar(255), así que un data URI no entra.
//                          Y `pages` son las PANTALLAS propias del comercio — hoy sólo
//                          `pages.welcome` (logo, description con `\n`, background, cta), la
//                          bienvenida que se muestra al entrar, antes del monto. Ausente = cero
//                          páginas, que es lo que tiene todo el resto del padrón.
//   sucursales[]           `{ nombre, ciudad }` — `ciudad` es `country_cities`.id (Bogotá 149).
//   entidades[]            una por lender:
//     id                   FIJO, para que una suite pueda declarar a quién espera en el listado.
//     response_type        2 = CreditopX in-platform (el comercio pone el capital).
//     product              `credit` · `renting` · `rto`. NINGÚN panel lo pone: es columna de migración.
//     document_types       los tipos que acepta ESTA entidad. Con `PEP` acá aparece el PEP en el
//                          selector — el país es el TECHO, no el piso (`DocumentTypesService`).
//     molde_operativo      de dónde salen identidad, requirements y reglas de datacrédito.
//     molde_documentos     de dónde sale el catálogo `lender_signing_documents`.
//     requiere_codeudor    fuerza `requires_cosigner` en los perfiles. Tiene que coincidir con las
//                          ramas que EXISTEN en el catálogo de documentos, o no se genera ninguno.
//     abaco                el underwriting por ingresos gig. Se apaga salvo que se pida.
//     user_self_management si la entidad le manda el link al cliente por WhatsApp.
//     bienvenida {…}       la pantalla de bienvenida a pantalla completa (`show_intro_screen`).
//     calculadora {…}      el JSON de `lenders.calculator`. Tampoco lo pone ningún panel.
//
// Uso:   E2E_TARGET=local node dev/montar-comercio.ts alta
//        E2E_TARGET=local node dev/montar-comercio.ts alta --clean
import { query, one, exec, assertWriteAllowed, TARGET } from '../pkg/db.ts';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

assertWriteAllowed();
if (TARGET !== 'local') {
    // Es data sintética de comercios que en el ambiente compartido pueden existir DE VERDAD: sembrar
    // un homónimo en dev/staging —que además comparten la MISMA base— dejaría dos y nadie sabría cuál
    // es el real. Alta ya es ese caso: existe en producción como allied 346.
    throw new Error(`montar-comercio sólo corre en local (E2E_TARGET=${TARGET}); es data sintética`);
}

const CLEAN = process.argv.includes('--clean');
const PEDIDO = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DIR_SPECS = new URL('../comercios/', import.meta.url);

if (!PEDIDO) {
    const hay = readdirSync(DIR_SPECS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    console.log(`\n  falta el comercio. Los que hay: ${hay.join(' · ') || '(ninguno)'}\n`);
    // Se sugiere la forma `make` y no la del script: `make` es la puerta única del repo, y un hint que
    // enseña a saltearla es cómo se termina con dos maneras de correr lo mismo.
    console.log(`  uso:  make harness-comercio COMERCIO=<comercio> [CLEAN=1]\n`);
    process.exit(2);
}

type Bienvenida = { descripcion?: string; fondo?: string; cta?: string };
type Entidad = {
    id: number; nombre: string; slug: string; response_type?: number; product?: string;
    document_types?: string[]; molde_operativo: number; molde_documentos?: number;
    requiere_codeudor?: boolean; abaco?: boolean; user_self_management?: boolean;
    bienvenida?: Bienvenida; calculadora?: unknown;
};
type Spec = {
    nombre: string; slug: string; porque?: string; pais: number; molde_comercio: number;
    comercio?: Record<string, unknown>;
    sucursales: { nombre: string; ciudad: number }[];
    entidades: Entidad[];
};

let spec: Spec;
try {
    spec = JSON.parse(readFileSync(new URL(`${PEDIDO}.json`, DIR_SPECS), 'utf8'));
} catch (e: any) {
    console.log(`\n  ✗ no pude leer el spec de «${PEDIDO}»: ${e.message}\n`);
    process.exit(2);
}

const TIPO_TITULAR = 1, TIPO_COSIGNER = 3;
const paso = (t: string, d = '') => console.log(`  ${t}${d ? ` · ${d}` : ''}`);

/** El hash de entrada, con la misma forma que el admin: crc32 (`AlliedController::store`). */
const nuevoHash = () => {
    // No se usa el `date('Y-m-d H:i:s')` del admin porque acá se generan VARIOS en el mismo segundo
    // (el comercio y cada sucursal) y saldrían idénticos; el hash de la sucursal es la llave de TODO
    // el flujo, así que dos iguales serían dos comercios apuntando al mismo wizard.
    let h = 0xffffffff;
    for (const c of `${Date.now()}-${Math.random()}`) {
        h ^= c.charCodeAt(0);
        for (let i = 0; i < 8; i++) h = (h >>> 1) ^ (0xedb88320 & -(h & 1));
    }
    return ((h ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
};

/** Clona una fila cambiando lo que se le diga. Los objetos se serializan (las columnas JSON). */
async function clonar(tabla: string, fila: any, cambios: Record<string, unknown>): Promise<number> {
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
// Se borra POR ALCANCE —el comercio por slug, cada entidad por slug o por su id fijo— y no «todo lo
// que haya»: en esta base conviven Motai, Pullman y los comercios de los otros países.
async function limpiar() {
    const idsLender: number[] = [];
    for (const e of spec.entidades) {
        /* Por slug O por el id fijo: una corrida interrumpida puede haber dejado la fila del id sin el
           resto, y entonces buscar sólo por slug la dejaría ahí para que el INSERT choque con un
           duplicado — un error que no dice nada sobre la causa. */
        const l = await one<{ id: number }>('SELECT id FROM lenders WHERE slug=? OR id=?', [e.slug, e.id]);
        if (l) idsLender.push(l.id);
    }
    const comercio = await one<{ id: number }>('SELECT id FROM allieds WHERE slug=?', [spec.slug]);
    const sucursales = comercio
        ? (await query<{ id: number }>('SELECT id FROM allied_branches WHERE allied_id=?', [comercio.id])).map((s) => s.id)
        : [];

    for (const id of idsLender) {
        /* ⚠ El ORDEN no es cosmético: `lender_users_category_rules` antes que sus categorías y
           `lender_rules` antes que sus grupos, porque las hijas apuntan a las madres y al revés MySQL
           corta con un 1451 a mitad del borrado. */
        for (const t of ['lender_users_category_rules', 'lender_users_categories', 'lender_signing_documents',
                         'lender_identity_validation_types', 'lender_requirements', 'lender_datacredito_rules',
                         'lender_rules', 'credit_line_by_lenders', 'lenders_by_allied_branches', 'lenders_by_allieds'])
            await exec(`DELETE FROM ${t} WHERE lender_id=?`, [id]);
        await exec('DELETE FROM lenders WHERE id=?', [id]);
    }
    if (sucursales.length) {
        const m = sucursales.map(() => '?').join(',');
        // Los `group_rules` son de la SUCURSAL, no de la entidad: se van con ella y no con el lender.
        await exec(`DELETE FROM lender_rules WHERE group_rule_id IN (SELECT id FROM group_rules WHERE allied_branch_id IN (${m}))`, sucursales);
        await exec(`DELETE FROM group_rules WHERE allied_branch_id IN (${m})`, sucursales);
        await exec(`DELETE FROM lenders_by_allied_branches WHERE allied_branch_id IN (${m})`, sucursales);
        await exec(`DELETE FROM allied_branches WHERE id IN (${m})`, sucursales);
    }
    if (comercio) {
        await exec('DELETE FROM lenders_by_allieds WHERE allied_id=?', [comercio.id]);
        await exec('DELETE FROM allieds WHERE id=?', [comercio.id]);
    }
    return { comercio: comercio?.id, sucursales: sucursales.length, entidades: idsLender.length };
}

const borrado = await limpiar();
if (CLEAN) {
    console.log(`\n  ✓ limpieza hecha · comercio=${borrado.comercio ?? '—'} sucursales=${borrado.sucursales} entidades=${borrado.entidades}\n`);
    process.exit(0);
}
if (borrado.comercio || borrado.entidades) paso('lo anterior', 'borrado antes de sembrar (idempotente por reemplazo)');

// ── LOS MOLDES, comprobados ANTES de usarlos ────────────────────────────────────────────────────
// Se comprueba lo que hace posible el montaje, porque si un molde perdió su parte el error sale acá y
// no tres pasos más adelante disfrazado de «el flujo no genera documentos».
const moldeComercio = await one<any>('SELECT * FROM allieds WHERE id=?', [spec.molde_comercio]);
if (!moldeComercio) { console.log(`\n  ✗ no existe el comercio molde ${spec.molde_comercio}\n`); process.exit(2); }
const moldeSucursal = await one<any>('SELECT * FROM allied_branches WHERE allied_id=? LIMIT 1', [spec.molde_comercio]);
if (!moldeSucursal) { console.log(`\n  ✗ el comercio molde ${spec.molde_comercio} no tiene sucursal\n`); process.exit(2); }

console.log(`\n  ${spec.nombre} · país ${spec.pais} · molde ${spec.molde_comercio}\n`);

// ── 1 · EL COMERCIO ─────────────────────────────────────────────────────────────────────────────
// Se clona el molde y se pisa la identidad. Clonar y no construir a mano es deliberado: `allieds`
// tiene 30 columnas NOT NULL —la mayoría toggles que se fueron acumulando— y armarlas de cero es una
// lista que caduca sola. Lo que se pisa es lo que este comercio decide por ser él.
const hashComercio = nuevoHash();
const idComercio = await clonar('allieds', moldeComercio, {
    name: spec.nombre, slug: spec.slug, hash: hashComercio, country_id: spec.pais, status: 1,
    ...(spec.comercio ?? {}),
});
paso('comercio', `${idComercio} «${spec.nombre}» · hash ${hashComercio}`
    + (spec.comercio?.self_managed ? ' · AUTOGESTIÓN (self_managed=1)' : ''));

// ── 2 · LAS SUCURSALES ──────────────────────────────────────────────────────────────────────────
// El `hash` de la sucursal es la llave de TODO el flujo: la ruta del wizard es
// `/merchant/{partner_hash}/solicitar` y el contexto de entrada se resuelve por él.
const sucursales: { id: number; hash: string; nombre: string }[] = [];
for (const s of spec.sucursales) {
    const hash = nuevoHash();
    const id = await clonar('allied_branches', moldeSucursal, {
        allied_id: idComercio, name: s.nombre, hash, country_city_id: s.ciudad, status: 1,
    });
    sucursales.push({ id, hash, nombre: s.nombre });
    paso('sucursal', `${id} «${s.nombre}» · ciudad ${s.ciudad} · hash ${hash}`);
}

// ── 3 · LAS ENTIDADES ───────────────────────────────────────────────────────────────────────────
for (const e of spec.entidades) {
    const moldeDocs = e.molde_documentos ?? e.molde_operativo;
    const moldeLender = await one<any>('SELECT * FROM lenders WHERE id=?', [moldeDocs])
        ?? await one<any>('SELECT * FROM lenders WHERE id=?', [e.molde_operativo]);
    if (!moldeLender) { paso(`✗ ${e.nombre}`, `no existe el molde ${moldeDocs}/${e.molde_operativo}, se saltea`); continue; }

    /* `document_types` va en la ENTIDAD y no en la fila de sucursal. Es el mecanismo nuevo:
       `DocumentTypesService::resolver()` toma las entidades ACTIVAS del punto de venta, une sus
       `lenders.document_types` y RECORTA con el catálogo del país — el país es TECHO, no piso. El
       mecanismo viejo (copiar los tipos a `lenders_by_allied_branches`) es el que produjo F-76: la
       fila nueva nacía en NULL y el PEP desaparecía sin error y sin log. */
    const idLender = await clonar('lenders', moldeLender, {
        id: e.id, name: e.nombre, slug: e.slug,
        response_type: e.response_type ?? 2,
        product: e.product ?? moldeLender.product,
        document_types: e.document_types ?? null,
        calculator: e.calculadora ?? moldeLender.calculator,
        country_id: spec.pais, status: 1,
        /* La `url` se limpia: es del molde y en un rt=2 no se usa (no hay redirect externo), pero
           dejarla adentro hace que una traza mienta sobre a dónde iba el cliente. */
        url: null,
        /* LA PANTALLA DE BIENVENIDA. Es config desde la migración de abril: `show_intro_screen` +
           `intro_background_url`, y el front la dibuja con `LenderIntroduction`. Hoy la usa una sola
           entidad en producción (CREDIMOVIL, 164).
           ⚠ El titular de esa pantalla es `lenders.description`, que es LA MISMA columna que la
           descripción de la tarjeta del marketplace (`lender-response.mapper.ts`). Credimovil la tiene
           corta («El celular que quieres, más cerca con CrediMovil») porque le sirve de titular; una
           entidad con el párrafo largo de Motai renderizaría ese párrafo como `h1`. O sea que prender
           la bienvenida OBLIGA a escribir la descripción como titular, y eso se ve también en la
           tarjeta. Es una restricción del esquema, no una preferencia de diseño. */
        show_intro_screen: e.bienvenida ? 1 : 0,
        intro_background_url: e.bienvenida?.fondo ?? null,
        ...(e.bienvenida?.descripcion ? { description: e.bienvenida.descripcion } : {}),
    });
    paso('entidad', `${idLender} «${e.nombre}» · rt=${e.response_type ?? 2} · product=${e.product ?? moldeLender.product}`
        + ` · ${JSON.stringify(e.document_types ?? null)}`
        + (e.bienvenida ? ' · CON PANTALLA DE BIENVENIDA' : ''));

    // ── el cableado: comercio (economía) + sucursales (membresía) ──
    // La asimetría es el hecho central del modelo: la SUCURSAL no tiene economía propia —su fila son 5
    // columnas de membresía— y toda la plata vive en `lenders_by_allieds`, a nivel COMERCIO.
    const economia = await one<any>('SELECT * FROM lenders_by_allieds WHERE lender_id=? LIMIT 1', [e.molde_operativo]);
    if (economia) {
        await clonar('lenders_by_allieds', economia, {
            lender_id: idLender, allied_id: idComercio, url_utm: null,
            /* AUTOGESTIÓN, mitad de la entidad: `user_self_management` significa «esta entidad le manda
               el link al cliente por WhatsApp». En 0, no se manda nada y el cliente sigue donde está.
               ⚠ Y en `legacy-application` este flag NO se respeta para rt=2 — ver el aviso del final. */
            user_self_management: e.user_self_management ? 1 : 0,
        });
        paso('  economía', `clonada del ${e.molde_operativo} · user_self_management=${e.user_self_management ? 1 : 0}`);
    } else paso('  ⚠ economía', `el molde ${e.molde_operativo} no tiene fila en lenders_by_allieds`);

    const membresia = await one<any>('SELECT * FROM lenders_by_allied_branches WHERE lender_id=? LIMIT 1', [e.molde_operativo]);
    for (const su of sucursales) {
        await clonar('lenders_by_allied_branches', membresia ?? { sort: 1 }, {
            lender_id: idLender, allied_branch_id: su.id, status: 1, url_utm: null,
            /* NULL a propósito: el respaldo por sucursal ya no lo lee `resolver()` —manda
               `lenders.document_types`—, así que un valor acá sería un dato que no decide nada. */
            document_types: null,
        });
    }
    paso('  membresía', `activada en ${sucursales.length} sucursal(es)`);

    for (const l of await query<any>('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [e.molde_operativo]))
        await clonar('credit_line_by_lenders', l, { lender_id: idLender });

    // ── LA POLÍTICA DURA: plantilla Y clon por sucursal, alineados ──
    //
    // ESTO ES LO QUE MÁS IMPORTA, y es lo que el admin viejo NO puede hacer para una entidad nueva.
    //
    // Hay DOS puertas sobre el mismo solicitante: la PLANTILLA (`group_rule_id IS NULL`) la evalúa el
    // cupo de CreditopX, y los CLONES por sucursal los evalúa el listado del onboarding. Verlas
    // divergir es lo que hace que una entidad aparezca en el listado y después falle al pedir cupo.
    //
    // El admin (`LenderRulesController::addNewLenderRule`) usa como plantilla las `lender_rules`
    // HUÉRFANAS de la entidad — que en una entidad nueva son CERO —, así que crea el `GroupRule`
    // `AB<sucursal>` VACÍO. Y según el docblock del writer del backoffice, esa sucursal «ofrecería el
    // lender sin ningún filtro mientras el cupo lo rechaza con la política recién guardada».
    // Medido en producción el 2026-09-09: la entidad 199 de Alta quedó exactamente así.
    //
    // La forma correcta en producción es `PUT /api/backoffice/lenders/{id}/rules`, que escribe las dos
    // en una transacción (`LenderRulesWriterService`). Acá se hace lo mismo a mano porque esa ruta
    // pide un token del pool de STAFF que el harness no tiene.
    const reglas = await query<any>(
        `SELECT * FROM lender_rules
          WHERE lender_id = ?
            AND group_rule_id = (SELECT MIN(group_rule_id) FROM lender_rules
                                  WHERE lender_id = ? AND group_rule_id IS NOT NULL)
          ORDER BY id`, [e.molde_operativo, e.molde_operativo]);
    if (!reglas.length) paso('  ⚠ reglas duras', `el molde ${e.molde_operativo} no tiene: la entidad nace SIN FILTROS`);
    else {
        for (const r of reglas) await clonar('lender_rules', r, { lender_id: idLender, group_rule_id: null });
        for (const su of sucursales) {
            const grupo = await clonar('group_rules', { allied_branch_id: su.id, rule_name: `AB${su.id}` }, {});
            for (const r of reglas) await clonar('lender_rules', r, { lender_id: idLender, group_rule_id: grupo });
        }
        paso('  reglas duras', `${reglas.length} en la plantilla + ${reglas.length} por sucursal — alineadas`);
    }

    // Las de DATACRÉDITO son filtro duro del listado y se reparten igual: una genérica
    // (`allied_branch_id IS NULL`) más una copia por sucursal.
    const dc = await one<any>('SELECT * FROM lender_datacredito_rules WHERE lender_id=? AND allied_branch_id IS NULL', [e.molde_operativo])
        ?? await one<any>('SELECT * FROM lender_datacredito_rules WHERE lender_id=? LIMIT 1', [e.molde_operativo]);
    if (dc) {
        await clonar('lender_datacredito_rules', dc, { lender_id: idLender, allied_branch_id: null });
        for (const su of sucursales) await clonar('lender_datacredito_rules', dc, { lender_id: idLender, allied_branch_id: su.id });
        paso('  buró', 'regla genérica + copia por sucursal');
    } else paso('  ⚠ buró', `el molde ${e.molde_operativo} no tiene regla de datacrédito`);

    // ── LOS PERFILES ──
    // Van TODOS los tiers del molde, no uno: con sólo el más estricto, un cliente que no lo pasa se
    // queda sin categoría y la tarjeta DESAPARECE del listado (medido en la tarea del Rent to Own).
    // Y `requires_cosigner` tiene que coincidir con las ramas que EXISTEN en el catálogo de
    // documentos: `SigningDocumentResolver::resolveForPolicy()` filtra por esa columna, así que un
    // tier cuya rama no está en el catálogo no encuentra documentos y el flujo sigue como si no
    // hubiera catálogo — sin error y sin log.
    const cats = await query<any>('SELECT * FROM lender_users_categories WHERE lender_id=? ORDER BY id', [e.molde_operativo]);
    if (!cats.length) paso('  ⚠ perfiles', `el molde ${e.molde_operativo} no tiene: una entidad rt=2 sin perfiles NO LISTA`);
    else {
        for (const c of cats) {
            const nuevo = await clonar('lender_users_categories', c, {
                lender_id: idLender,
                ...(e.requiere_codeudor === undefined ? {} : { requires_cosigner: e.requiere_codeudor ? 1 : 0 }),
            });
            for (const g of await query<any>('SELECT * FROM lender_users_category_rules WHERE lender_users_category_id=?', [c.id])) {
                /* Una copia por TIPO: la política del codeudor es de otro tipo que la del titular, y sin
                   la de tipo 3 el endpoint de cupo del codeudor no responde `has_quota`. */
                for (const tipo of [TIPO_TITULAR, TIPO_COSIGNER])
                    await clonar('lender_users_category_rules', g, {
                        lender_id: idLender, lender_users_category_id: nuevo, lender_users_category_type_id: tipo,
                    });
            }
        }
        paso('  perfiles', `${cats.length} con criterios de titular Y codeudor`
            + (e.requiere_codeudor === undefined ? '' : ` · requires_cosigner=${e.requiere_codeudor ? 1 : 0}`));
    }

    // ── lo que hace que el flujo no se caiga ──
    // Sin proveedor de identidad ACTIVO en `order 1`, `validation/providers` responde «Lender has no
    // primary identity validation provider configured» — y es uno de los cinco chequeos de
    // `LenderReadinessService`, el que dice que sin él «el flujo de validación no falla ordenadamente».
    for (const t of ['lender_identity_validation_types', 'lender_requirements']) {
        const filas = await query<any>(`SELECT * FROM ${t} WHERE lender_id=?`, [e.molde_operativo]);
        if (!filas.length) { paso(`  ⚠ ${t}`, `el molde ${e.molde_operativo} no tiene fila`); continue; }
        /* ⚠ ÁBACO SE DECIDE EN EL SPEC, y encontrarlo prendido fue el motivo de esta línea. El molde de
           Motai lo trae en 1 —no porque alguien lo decidiera para él, sino porque la migración de la v2
           hizo backfill desde `product IN ('renting','rto')`—, así que clonarlo tal cual le da al
           comercio nuevo el underwriting alternativo por ingresos gig SIN que nadie lo pida. Es justo
           el «gemelo a medias»: heredar una decisión de negocio por venir en la misma fila. Y además
           rompe la corrida: en local el camino feliz de Ábaco sólo existe con `bin/mock-abaco`, y en
           dev/qa no hay mock. */
        const abaco = t === 'lender_requirements' ? { abaco_is_enabled: e.abaco ? 1 : 0 } : {};
        for (const f of filas) await clonar(t, f, { lender_id: idLender, ...abaco });
        if (t === 'lender_requirements') paso('  requirements', `Ábaco ${e.abaco ? 'ENCENDIDO' : 'apagado'}`);
    }

    // El catálogo de documentos: la pieza que DISTINGUE renting de rent-to-own. No es el `product` ni
    // la calculadora — los dos productos comparten `response_type`, wizard y motor de pasos.
    const docs = await query<any>('SELECT * FROM lender_signing_documents WHERE lender_id=? ORDER BY sort', [moldeDocs]);
    if (!docs.length) paso('  ⚠ documentos', `el molde ${moldeDocs} no tiene catálogo: la entidad no firma nada`);
    else {
        for (const d of docs) await clonar('lender_signing_documents', d, { lender_id: idLender });
        paso('  documentos', `${docs.length} del ${moldeDocs}: ${docs.map((d: any) => d.document_type).join(', ')}`);
    }
}

// ── 4 · QUE EL HARNESS SEPA NOMBRARLO ───────────────────────────────────────────────────────────
// Sin esta entrada el comercio existe en la base y los runners no lo saben direccionar por slug, que
// es la mitad más frustrante de montar un ambiente.
const RUTA_FLOWS = new URL('../.flows.json', import.meta.url);
try {
    const flows = JSON.parse(readFileSync(RUTA_FLOWS, 'utf8'));
    flows.merchants ??= {};
    flows.merchants[PEDIDO] = {
        branch_hash: sucursales[0]?.hash, allied_id: idComercio,
        branch_id: sucursales[0]?.id, name: spec.nombre,
    };
    writeFileSync(RUTA_FLOWS, JSON.stringify(flows, null, 2) + '\n');
    paso('.flows.json', `slug «${PEDIDO}» → sucursal ${sucursales[0]?.id} (hash ${sucursales[0]?.hash})`);
} catch (e: any) {
    paso('.flows.json', `✗ no pude escribirlo: ${e.message}`);
}

const autogestion = spec.entidades.some((e) => !e.user_self_management);
console.log(`
  Comprobalo:
    make harness-listado COMERCIO=${PEDIDO}
    make harness-caso CASOS='${PEDIDO}' CERRAR=1 LAMBDA=1
    make harness-suite SUITE=harness/suites/${PEDIDO}.json CERRAR=1 LAMBDA=1
`);
if (autogestion) console.log(`  ⚠ AUTOGESTIÓN — lo sembrado acá dice «no le mandes el link al cliente»
    (\`allieds.self_managed=1\` + \`lenders_by_allieds.user_self_management=0\`), y eso es lo que
    respeta legacy-BACKEND. legacy-APPLICATION lo IGNORA para rt=2: su condición es
    \`… || $lender->response_type === 2\`, con una lista quemada de excepciones (\`[6, 9]\`, Addi,
    marcada TEMP\`). O sea que el mismo comercio se porta distinto según qué monolito lo atienda.
`);
process.exit(0);

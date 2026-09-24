// LOCAL y reversible: monta la operación de PERÚ para poder correr su flujo por el harness.
//
// Perú es el país nuevo más fácil de cerrar, y el motivo está medido: NO tiene centrales de riesgo
// habilitadas, así que `RiskCentralCountryGate` apaga TODAS las validaciones de buró —identidad,
// reporte, lavado, plataformas—, que es justo la parte que en Colombia hay que mockear. Y del lado del
// servicio de preaprobados los dos productos de BCP son entidades MANUALES: el veredicto llega en el
// cuerpo del pedido, así que no hay proveedor externo que simular.
//
// Lo que falta para correr es configuración, y es lo que este script siembra. Los cuatro pendientes los
// dejó escritos el autor de la integración en `app/Actions/Lenders/Bcp/Bcp.php`:
//   1. `lender_transaction_statuses` del lender 206 con BCP_PENDING (sin eso register() no radica);
//   2. el credential en `lender_allied_credentials` — ⚠ la columna es `encrypted:collection`, así que
//      NO entra por SQL crudo: va por artisan (abajo);
//   3. `lenders.action` apuntando a la clase (en prod la fila 206 lo tiene en NULL);
//   4. CUOTEALO_REDIRECT_PATH, CUOTEALO_BACK_URL y el logo — CheckoutPayload ya no tiene defaults.
//
// Los ids 206 (consumo) y 207 (vehicular) NO son decorativos: `Bcp::LENDER_ID` es 206 y el vehicular
// sale de `services.cuotealo.vehicular_lender_id` (207 por defecto). Se crean con esos ids a propósito.
//
// Limpieza total:  E2E_TARGET=local node dev/mount-peru.ts --clean
import { query, exec, assertWriteAllowed, TARGET } from '../pkg/db.ts';
import { cloneRow } from '../pkg/db-safe.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

/* EL PAR DE KEYS del cifrado, generado acá. La ida cifra con la PÚBLICA que el credential declara
 * —`CuotealoCheckoutPayload` la exige del credential, no de config, aunque el encrypter también sepa
 * leerla de un archivo— y la vuelta descifra con la PRIVADA, que sale del mismo credential
 * (`cuotealo_private_key`). Teniendo las dos, el ida y vuelta se puede cerrar sin la contraparte.
 *
 * ⚠ ES UNA LLAVE DE PRUEBA LOCAL, no un secreto: nunca cifra nada de nadie. Se guarda para que
 * re-correr el seeder no deje indescifrable una operación en vuelo, y el archivo está gitignoreado.
 *
 * ⚠ Y el par de resúmenes del relleno queda como esté configurado: acá las dos puntas son nuestras,
 * así que cualquier par consistente sirve. Contra el BCP real ese par NO está confirmado, y si no
 * coincide el descifrado falla sin informar el motivo. */
const KEYS_PATH = new URL('../.bcp-llaves.json', import.meta.url);
function keyPair(): { publica: string; privada: string } {
    if (existsSync(KEYS_PATH)) return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const par = { publica: publicKey, privada: privateKey };
    writeFileSync(KEYS_PATH, JSON.stringify(par, null, 1) + '\n');
    return par;
}
const KEYS = keyPair();

/* LA TEMPLATE DEL FORMULARIO del vehicular, extraída de DEV (sólo lectura) el 2026-09-03. Va en un
 * fixture y no inline porque es DATO, no lógica: así se puede volver a extraer y ver el diff. */
const FORM_TEMPLATE: any = JSON.parse(
    readFileSync(new URL('./fixtures/bcp-vehicle-form.json', import.meta.url), 'utf8'));

assertWriteAllowed();
if (TARGET !== 'local') {
    // Data sintética de un país sin operación: en dev/staging ensuciaría el ambiente del equipo y
    // encima esas bases son la MISMA, así que el destrozo sería doble.
    throw new Error(`montar-peru sólo corre en local (E2E_TARGET=${TARGET}); es data sintética`);
}

const COUNTRY = 167;                    // Perú
const CONSUMER = 206, VEHICLE = 207;
const TEMPLATE = 9;                 // Sistecrédito: response_type=1 con action, la forma más simple del redirect externo
const ACTIONS: Record<number, string> = {
    [CONSUMER]: 'App\\Actions\\Lenders\\Bcp\\Bcp',
    [VEHICLE]: 'App\\Actions\\Lenders\\Bcp\\BcpVehicular',
};
const NAMES: Record<number, string> = { [CONSUMER]: 'BCP Consumo', [VEHICLE]: 'BCP Vehicular' };
/* ⚠ CON GUION BAJO, y no es cosmético: el `slug` del lender ES la clave de producto que el
   marketplace le manda al microservicio de pre-aprobados (`fetch-lender-preapproval` la arma con
   `lender.slug`), y ese microservicio la valida contra un registro CERRADO —`bcp_consumo` /
   `bcp_vehicular`—. Con guion medio, la corrida local registra cero decisiones y el fallo se lo traga
   `allSettled`: se ve idéntica a una corrida sana.

   Acá decía `bcp-consumo`, en kebab como la mayoría de los slugs de la tabla. Verificado el 2026-09-09
   contra las dos bases reales: dev tiene `bcp_consumo`/`bcp_vehicular` y producción `bcp_consumo`. O
   sea que local era el único ambiente donde la clave no coincidía, y por eso probar el registro acá no
   probaba nada. */
const SLUGS: Record<number, string> = { [CONSUMER]: 'bcp_consumo', [VEHICLE]: 'bcp_vehicular' };
const CLEAN = process.argv.includes('--clean');
const CONTAINER = 'legacy-backend-laravel.test-1';

async function clean() {
    /* El FORMULARIO y sus placements. Se borran por los ids del fixture (que son los de dev) y por
       alcance, no por «todo lo que haya»: en esta base pueden convivir los formularios de otros. */
    const idsForms = FORM_TEMPLATE.forms.map((x: any) => x.id);
    const fieldIds = FORM_TEMPLATE.fields.map((x: any) => x.id);
    const typeIds = FORM_TEMPLATE.form_types.map((x: any) => x.id);
    if (idsForms.length) await exec(`DELETE FROM forms WHERE id IN (${idsForms.map(() => '?').join(',')})`, idsForms);
    if (fieldIds.length) {
        await exec(`DELETE FROM field_options WHERE field_id IN (${fieldIds.map(() => '?').join(',')})`, fieldIds);
        await exec(`DELETE FROM fields WHERE id IN (${fieldIds.map(() => '?').join(',')})`, fieldIds);
    }
    if (typeIds.length) await exec(`DELETE FROM form_types WHERE id IN (${typeIds.map(() => '?').join(',')})`, typeIds);
    await exec('DELETE FROM dynamic_form_placements WHERE scope_type=? OR (scope_type=? AND scope_id IN (?,?))',
        ['allied_branch', 'lender', CONSUMER, VEHICLE]);
    for (const id of [CONSUMER, VEHICLE]) {
        /* ⚠ Las TRANSACCIONES van antes que sus estados: `lender_transactions.status_id` es una clave
           foránea a `lender_transaction_statuses`, así que borrar el estado primero corta con un 1451.
           Y son nuestras: las creó una corrida sintética de este mismo seeder. */
        for (const t of ['lender_transactions', 'lender_allied_credentials', 'lender_transaction_statuses', 'credit_line_by_lenders',
                         'lender_users_category_rules', 'lender_users_categories', 'lender_datacredito_rules',
                         'lender_rules', 'lenders_by_allied_branches', 'lenders_by_allieds'])
            await exec(`DELETE FROM ${t} WHERE lender_id=?`, [id]);
        await exec('DELETE FROM lenders WHERE id=?', [id]);
    }
}

// `clonar` vive en `pkg/db-safe.ts` como `cloneRow`: estaba escrito dos veces y las dos copias
// diferían en si re-sellaban `created_at`/`updated_at` — una clonaba filas nacidas hace dos años.
const clone = cloneRow;

await clean();
if (CLEAN) { console.log('✓ limpieza hecha (206 y 207 borrados con su cableado)'); process.exit(0); }

// ── el comercio de Perú y su sucursal, que ya existen ──
const [merchant]: any[] = await query('SELECT id, name FROM allieds WHERE country_id=? LIMIT 1', [COUNTRY]);
if (!merchant) throw new Error(`no hay comercio en el país ${COUNTRY}: creá uno desde el admin antes de correr esto`);
const [branch]: any[] = await query('SELECT id, name FROM allied_branches WHERE allied_id=? LIMIT 1', [merchant.id]);
if (!branch) throw new Error(`el comercio ${merchant.id} no tiene sucursal`);

// ⚠ Y se comprueba lo que hace fácil a Perú, porque si alguien habilita una central el flujo cambia
// entero y conviene enterarse acá y no depurando el buró.
const [{ n: bureaus }]: any[] = await query('SELECT COUNT(*) AS n FROM risk_centrals WHERE country_id=? AND enabled=1', [COUNTRY]);
if (bureaus > 0) console.log(`⚠ ojo: el país ${COUNTRY} tiene ${bureaus} central(es) habilitada(s); el buró YA NO se salta`);

// ── las dos entidades, clonando la forma del redirect externo ──
const [template]: any[] = await query('SELECT * FROM lenders WHERE id=?', [TEMPLATE]);
const [pBranch]: any[] = await query('SELECT * FROM lenders_by_allied_branches WHERE lender_id=? LIMIT 1', [TEMPLATE]);
const [pMerchant]: any[] = await query('SELECT * FROM lenders_by_allieds WHERE lender_id=? LIMIT 1', [TEMPLATE]);
const pLines: any[] = await query('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [TEMPLATE]);
// Sólo para copiarle los niveles de probabilidad, que son presentación y no decisión.
const [pDcRule]: any[] = await query(
    'SELECT probability_levels FROM lender_datacredito_rules WHERE lender_id=? AND allied_branch_id IS NULL LIMIT 1', [TEMPLATE]);

for (const id of [CONSUMER, VEHICLE]) {
    await clone('lenders', template, {
        id, name: NAMES[id], slug: SLUGS[id], action: ACTIONS[id],
        country_id: COUNTRY, response_type: 1, status: 1, abaco: 0,
        /* ⚠ La `url` del clon SE LIMPIA. Con la url de la plantilla adentro, elegir la entidad devuelve
           ESE redirect y la `action` de BCP nunca corre: el sweep lo clasificaba como
           «url→credinet.co», que es la plantilla hablando. En NULL, el que decide es el action. */
        url: null,
        /* Los tipos de documento los decide el BACKEND, no la entidad: se unen los que declara cada
           entidad activa del punto de venta y se RECORTAN con el catálogo del país, que es el TECHO
           (`DocumentTypesService`). El de Perú es `["DNI","CE"]`, así que declarar otra cosa acá no
           agrega nada: el cruce lo borra y manda el país. Se declara lo mismo para que el dato no
           mienta. ⚠ Y no confundir con el validador del OTRO sistema de formularios —el de los
           comercios dominicanos, sobre S3—, que sólo conoce CED/CI_VE/PAS/PAS_VE: ése no es el
           camino de Perú. */
        document_types: ['DNI', 'CE'],
    });
    await clone('lenders_by_allied_branches', pBranch, {
        lender_id: id, allied_branch_id: branch.id, status: 1, document_types: ['DNI', 'CE'],
        /* ⚠ Y la url del clon (la columna es `url_utm`, no `url`) SE LIMPIA en los dos niveles del
           cableado. Con la de la plantilla adentro, elegir la entidad devuelve ESE redirect y la
           `action` de BCP nunca corre: el sweep lo clasificaba «url→credinet.co», que es Sistecrédito
           hablando por la boca de BCP. Costó dos vueltas encontrarlo porque el nombre no es `url`. */
        url_utm: null,
    });
    if (pMerchant) await clone('lenders_by_allieds', pMerchant, { lender_id: id, allied_id: merchant.id, url_utm: null });
    for (const l of pLines) await clone('credit_line_by_lenders', l, { lender_id: id });
    /* LAS RULES DE DATACRÉDITO, que son FILTRO DURO del listado y son lo que hacía que las dos
       entidades quedaran cableadas y no salieran. La plantilla tiene una regla genérica
       (`allied_branch_id IS NULL`) más una copia por sucursal — así se reparte esta config.
       ⚠ Y van PERMISIVAS a propósito: en un país sin centrales habilitadas el cliente NO tiene score,
       así que una regla con `score` mínimo y `allow_0_score = 0` filtra a todo el mundo. El buró no se
       consulta, pero este filtro del listado sigue mirando la fila. */
    const permissiveRule = {
        lender_id: id, score: 0, allow_0_score: 1, current_dues: 99,
        time_finance_sector: 0, negative_historical_last_12_months: 1, consulted_last_6_months: 99,
        probability_levels: pDcRule?.probability_levels ?? null,
    };
    await clone('lender_datacredito_rules', permissiveRule, { allied_branch_id: null });
    await clone('lender_datacredito_rules', permissiveRule, { allied_branch_id: branch.id });
    /* Los estados locales que la integración escribe. Sin la fila que le toca, `resolveStatusId()`
       falla explícito y register() no radica — es el pendiente 1 del comentario de `Bcp.php`.
       ⚠ Y los nombres NO son los mismos en los dos productos: el de consumo usa `BCP_*` y el
       vehicular `BCP_VEHICULAR_*`. Sembrar los cinco de cada uno y no sólo el pendiente, porque la
       vuelta escribe aprobado/rechazado/cancelado y el desembolso el suyo. */
    const prefix = id === VEHICLE ? 'BCP_VEHICULAR' : 'BCP';
    for (const [suffix, desc] of [
        ['PENDING', 'Radicado, esperando el desenlace del checkout'],
        ['APPROVED', 'La contraparte aprobó'],
        ['REJECTED', 'La contraparte rechazó'],
        ['DISBURSED', 'Desembolsado'],
        ['CANCELLED', 'Cancelado por el cliente'],
    ] as const) {
        await clone('lender_transaction_statuses', { lender_id: id, name: `${prefix}_${suffix}`, description: desc }, {});
    }
    console.log(`✓ ${NAMES[id]}  id=${id}  país=${COUNTRY}  sucursal=${branch.id}  action=${ACTIONS[id].split('\\').pop()}`);
}

// ── el credential, que NO entra por SQL ──
// La columna es `encrypted:collection`: Eloquent la cifra con APP_KEY al guardar. Un INSERT crudo deja
// un valor que el modelo no puede descifrar, y el fallo aparece después, lejos de acá.
/* Los PEM viajan en base64: un PEM tiene saltos de línea y comillas que pelean con `--execute`. */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const keys = `[
  'cuotealo_ecommerce_id'  => 'HARNESS-ECOM-%ID%',
  'cuotealo_public_key'    => base64_decode('${b64(KEYS.publica)}'),
  'cuotealo_private_key'   => base64_decode('${b64(KEYS.privada)}'),
  'cuotealo_merchant_id'   => 'HARNESS-MERCH',
  'cuotealo_merchant_name' => 'Comercio pruebas Peru',
  'cuotealo_merchant_logo' => 'https://example.invalid/logo.png',
]`;
for (const id of [CONSUMER, VEHICLE]) {
    /* ⚠ El `allied_type` es la CLASE COMPLETA del morph, no una etiqueta: con `'allied'` la fila se
       guarda pero `findOrFailByLenderAndAlly` no la encuentra nunca —busca por `AlliedBranch` y cae a
       `Allied`, las dos por nombre de clase— y sin credential el flujo se va por la rama de «no hay
       integración»: `url` nula y el modal de «continuá con el asesor». Costó una vuelta.
       Se scopea a la SUCURSAL, que es el camino principal del buscador (y el más usado: 636 filas
       contra 551 por comercio). */
    /* ⚠ El morph se asocia por la RELACIÓN, no por asignación masiva: `allied_type` no está en el
       `$fillable` del modelo, así que `updateOrCreate` lo descarta del INSERT —lo usa en el WHERE pero
       no lo escribe— y MySQL corta con «Field 'allied_type' doesn't have a default value». Y se scopea
       a la SUCURSAL: `findOrFailByLenderAndAlly` busca primero por `AlliedBranch` y sólo después cae al
       comercio, las dos por nombre de clase completo. Sin credential, el flujo se va por la rama de «no
       hay integración»: url nula y el modal de «continuá con el asesor». */
    const php = `$c = \\App\\Models\\LenderAlliedCredential::firstOrNew(['lender_id' => ${id}]); `
        + `$c->allied()->associate(\\App\\Models\\AlliedBranch::find(${branch.id})); `
        + `$c->credential = ${keys.replace('%ID%', String(id))}; $c->save();`;
    try {
        /* Tinker avisa «Restricted Mode: skipping untrusted project features» y ejecuta igual: el
           aviso es por las extensiones del proyecto, no por el código. ⚠ Y `--trust-project` NO existe
           en esta versión —agregarlo hace fallar el comando entero—. Por eso abajo se VERIFICA la fila
           en vez de creerle al código de salida: la primera versión de esto reportaba ✓ con la fila
           ausente, y el síntoma aparecía lejos (sin credential el flujo se va por la rama de «no hay
           integración» y muestra el modal de «continuá con el asesor»). */
        execFileSync('docker', ['exec', CONTAINER, 'php', 'artisan', 'tinker', '--execute', php], { stdio: 'pipe' });
        const [there]: any[] = await query(
            'SELECT id FROM lender_allied_credentials WHERE lender_id=? AND allied_id=? LIMIT 1', [id, branch.id]);
        if (!there) throw new Error('tinker no falló pero la fila no está (¿Restricted Mode?)');
        console.log(`✓ credential de ${id} sembrado por Eloquent (cifrado con APP_KEY) y verificado en la base`);
    } catch (e: any) {
        console.log(`✗ el credential de ${id} NO se sembró: ${String(e.stderr || '')}${String(e.stdout || '')}${e.message}`.slice(0, 500));
        console.log(`  corrélo a mano:  docker exec ${CONTAINER} php artisan tinker --execute "${php.replace(/"/g, '\\"')}"`);
    }
}

/* ── EL FORMULARIO DEL VEHICLE, Y DÓNDE APARECE ─────────────────────────────────────────────
 *
 * Sin esto el comercio de Perú caía en el formulario del OTRO sistema —el de los comercios
 * dominicanos, cuyos schemas viven en S3 y el harness mockea— y la pantalla salía con el schema
 * genérico del mock. El de BCP es el «backend-driven»: su plantilla son cuatro tablas del legacy
 * (`form_types` → `forms` → `fields` → `field_options`, más la categoría) y **dónde aparece** lo dice
 * `dynamic_form_placements`.
 *
 * Los placements NO se adivinaron: se copiaron de dev, que ya los tiene. Dos cosas que enseñan:
 *   · el alcance es la SUCURSAL, no la entidad, y los dos pasos van ANTES y DESPUÉS del flujo
 *     alterno (`pre_alternate_flow` / `post_alternate_flow`), con `always_show`;
 *   · y hay dos filas más, en `pre_sign_documents` para la entidad, con `is_enabled = 0`. No son
 *     ruido: en este diseño **ausencia ≠ apagado** —sin fila se HEREDA la fuente legacy—, así que
 *     apagar de verdad exige una fila que lo diga. Se copian igual o el gate de firma reaparece. */
async function seedForm(alliedId: number, branchId: number) {
    for (const c of FORM_TEMPLATE.field_categories) await clone('field_categories', c, {});
    for (const ft of FORM_TEMPLATE.form_types) await clone('form_types', ft, { id: ft.id });
    for (const fi of FORM_TEMPLATE.fields) await clone('fields', fi, { id: fi.id });
    for (const fo of FORM_TEMPLATE.forms) await clone('forms', fo, { id: fo.id });
    for (const op of FORM_TEMPLATE.field_options) await clone('field_options', op, { id: op.id });
    console.log(`✓ formulario del vehicular: ${FORM_TEMPLATE.form_types.length} tipos, `
        + `${FORM_TEMPLATE.fields.length} campos, ${FORM_TEMPLATE.field_options.length} opciones`);

    /* El flujo alterno tiene que estar encendido en el COMERCIO: los dos placements se cuelgan de sus
       bordes, así que sin esta bandera no hay bordes de donde colgarse. */
    await exec('UPDATE allieds SET show_alternate_flow=1 WHERE id=?', [alliedId]);

    const placements = [
        { scope_type: 'allied_branch', scope_id: branchId, credit_line_id: 1, placement: 'pre_alternate_flow',    form_type_id: 8, sort: 1, is_enabled: 1, always_show: 1 },
        { scope_type: 'allied_branch', scope_id: branchId, credit_line_id: 1, placement: 'post_alternate_flow',   form_type_id: 9, sort: 1, is_enabled: 1, always_show: 1 },
        { scope_type: 'lender',        scope_id: VEHICLE, credit_line_id: 1, placement: 'pre_sign_documents',   form_type_id: 8, sort: 1, is_enabled: 0, always_show: 0 },
        { scope_type: 'lender',        scope_id: VEHICLE, credit_line_id: 1, placement: 'pre_sign_documents',   form_type_id: 9, sort: 1, is_enabled: 0, always_show: 0 },
    ];
    for (const p of placements) await clone('dynamic_form_placements', p, {});

    /* ⚠ ACÁ HUBO UN PARCHE, y se borró el 2026-09-07 por dos razones independientes. Queda escrito
     * porque el parche era `UPDATE forms SET editable=1 … field_id=260` y a alguien le va a dar ganas
     * de reponerlo.
     *
     * 1. YA NO HACE FALTA. «Monto a financiar» (campo 260) es visible, obligatorio y no editable, y su
     *    valor sale de `computed.financed_amount` — que hasta el 2026-09-03 no lo calculaba nadie, así
     *    que la pantalla pedía un dato imposible de dar. Ese día mergeó a `main`
     *    (`resolve-financed-amount.ts`, enganchado en `DynamicSection.tsx` vía `useFinancedAmount`),
     *    y el parche tenía por vencimiento justamente ese merge.
     * 2. Y ADEMÁS NUNCA TUVO EFECTO ACÁ. El esquema del formulario **no lo sirve el monolito**: lo
     *    sirve `form-service` leyendo la base de SU ambiente (los cinco repositorios del front cuelgan
     *    de `VITE_FORM_SERVICE_BASE_URL`). Así que tocar `forms` en la base local sólo se nota si corre
     *    un form-service local — y lo que hay es el mock, que sirve fixtures. Lo que sí se usa de lo
     *    sembrado acá son los `dynamic_form_placements`, que el monolito publica en el payload del
     *    comercio.
     *
     * Lo que se pierde al borrarlo: nada que estuviera probando. Lo que se gana: el ambiente local deja
     * de diferir del desplegado en un campo que en producción es derivado. */
    console.log(`✓ placements: paso 1 antes y paso 2 después del flujo alterno (sucursal ${branchId}), `
        + `y el gate de firma apagado con fila explícita`);
}

/* ── EL HOST AL QUE LA CONTRAPARTE DEVUELVE AL CUSTOMER ────────────────────────────────────────
 *
 * La URL de vuelta se arma como `<front_end_url>/<redirect_path>/<operationId>`, y ese host sale de
 * `settings`, NO de una variable de entorno. El motivo está escrito en el código y vale conocerlo: la
 * URL viaja DENTRO del payload de cada transacción y la contraparte la conserva, así que una operación
 * radicada hoy puede volver mañana — tenerlo donde ya se administra por ambiente evita que un
 * despliegue con la variable vieja mande al cliente a un dominio que no responde.
 *
 * En esta base apuntaba a STAGING, así que la vuelta de una corrida local se iba para allá. Se apunta
 * al asistente local y se guarda el valor previo para poder devolverlo con `--clean`. */
const FRONT_LOCAL = process.env.E2E_FRONT_URL || 'http://localhost:5174';
const [{ value: previousFront }]: any[] = await query("SELECT value FROM settings WHERE `key`='front_end_url'");
if (!previousFront?.includes(FRONT_LOCAL)) {
    writeFileSync(new URL('../.bcp-front-previo.json', import.meta.url), JSON.stringify({ frontPrevio: previousFront }) + '\n');
    await exec("UPDATE settings SET value=? WHERE `key`='front_end_url'", [JSON.stringify(FRONT_LOCAL)]);
    console.log(`✓ front_end_url → ${FRONT_LOCAL} (antes ${String(previousFront).slice(0, 44)}; guardado para --clean)`);
}

await seedForm(merchant.id, branch.id);

/* Y el comercio se registra en `.flows.json`, que es por donde los runners lo direccionan POR SLUG
   (`sweep.ts matrix peru`). Sin esta entrada el comercio existe en la base y el harness no lo sabe
   nombrar, que es la mitad más frustrante de montar un ambiente. */
const FLOWS_PATH = new URL('../.flows.json', import.meta.url);
try {
    const flows = JSON.parse(readFileSync(FLOWS_PATH, 'utf8'));
    const [{ hash }]: any[] = await query('SELECT hash FROM allied_branches WHERE id=?', [branch.id]);
    flows.merchants ??= {};
    flows.merchants.peru = { branch_hash: hash };
    writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 2) + '\n');
    console.log(`✓ .flows.json: slug «peru» → sucursal ${branch.id} (hash ${hash})`);
} catch (e: any) {
    console.log(`✗ no pude escribir .flows.json: ${e.message}`);
}

console.log(`\ncomercio ${merchant.id} «${merchant.name}» · sucursal ${branch.id} «${branch.name}» · centrales habilitadas: ${bureaus}`);
console.log(`falta en el .env del backend (pendiente 4 de Bcp.php, sin defaults):`);
console.log(`  CUOTEALO_MOCKS_ENABLED=true   # la punta que arma y cifra el sobre de ida`);
console.log(`  CUOTEALO_REDIRECT_PATH=…      # a dónde vuelve el cliente`);
console.log(`  CUOTEALO_BACK_URL=…           # el «volver» del checkout`);
process.exit(0);

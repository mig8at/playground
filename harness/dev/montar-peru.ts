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
// Limpieza total:  E2E_TARGET=local node dev/montar-peru.ts --clean
import { query, exec, assertWriteAllowed, TARGET } from '../pkg/db.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

/* EL PAR DE LLAVES del cifrado, generado acá. La ida cifra con la PÚBLICA que el credential declara
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
const RUTA_LLAVES = new URL('../.bcp-llaves.json', import.meta.url);
function parDeLlaves(): { publica: string; privada: string } {
    if (existsSync(RUTA_LLAVES)) return JSON.parse(readFileSync(RUTA_LLAVES, 'utf8'));
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const par = { publica: publicKey, privada: privateKey };
    writeFileSync(RUTA_LLAVES, JSON.stringify(par, null, 1) + '\n');
    return par;
}
const LLAVES = parDeLlaves();

/* LA PLANTILLA DEL FORMULARIO del vehicular, extraída de DEV (sólo lectura) el 2026-09-03. Va en un
 * fixture y no inline porque es DATO, no lógica: así se puede volver a extraer y ver el diff. */
const PLANTILLA_FORM: any = JSON.parse(
    readFileSync(new URL('./fixtures/bcp-formulario-vehicular.json', import.meta.url), 'utf8'));

assertWriteAllowed();
if (TARGET !== 'local') {
    // Data sintética de un país sin operación: en dev/staging ensuciaría el ambiente del equipo y
    // encima esas bases son la MISMA, así que el destrozo sería doble.
    throw new Error(`montar-peru sólo corre en local (E2E_TARGET=${TARGET}); es data sintética`);
}

const PAIS = 167;                    // Perú
const CONSUMO = 206, VEHICULAR = 207;
const PLANTILLA = 9;                 // Sistecrédito: response_type=1 con action, la forma más simple del redirect externo
const ACCIONES: Record<number, string> = {
    [CONSUMO]: 'App\\Actions\\Lenders\\Bcp\\Bcp',
    [VEHICULAR]: 'App\\Actions\\Lenders\\Bcp\\BcpVehicular',
};
const NOMBRES: Record<number, string> = { [CONSUMO]: 'BCP Consumo', [VEHICULAR]: 'BCP Vehicular' };
const SLUGS: Record<number, string> = { [CONSUMO]: 'bcp-consumo', [VEHICULAR]: 'bcp-vehicular' };
const CLEAN = process.argv.includes('--clean');
const CONTENEDOR = 'legacy-backend-laravel.test-1';

async function limpiar() {
    /* El FORMULARIO y sus placements. Se borran por los ids del fixture (que son los de dev) y por
       alcance, no por «todo lo que haya»: en esta base pueden convivir los formularios de otros. */
    const idsForms = PLANTILLA_FORM.forms.map((x: any) => x.id);
    const idsCampos = PLANTILLA_FORM.fields.map((x: any) => x.id);
    const idsTipos = PLANTILLA_FORM.form_types.map((x: any) => x.id);
    if (idsForms.length) await exec(`DELETE FROM forms WHERE id IN (${idsForms.map(() => '?').join(',')})`, idsForms);
    if (idsCampos.length) {
        await exec(`DELETE FROM field_options WHERE field_id IN (${idsCampos.map(() => '?').join(',')})`, idsCampos);
        await exec(`DELETE FROM fields WHERE id IN (${idsCampos.map(() => '?').join(',')})`, idsCampos);
    }
    if (idsTipos.length) await exec(`DELETE FROM form_types WHERE id IN (${idsTipos.map(() => '?').join(',')})`, idsTipos);
    await exec('DELETE FROM dynamic_form_placements WHERE scope_type=? OR (scope_type=? AND scope_id IN (?,?))',
        ['allied_branch', 'lender', CONSUMO, VEHICULAR]);
    for (const id of [CONSUMO, VEHICULAR]) {
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

async function clonar(tabla: string, fila: any, cambios: Record<string, any>) {
    const r: any = { ...fila, ...cambios };
    if (!('id' in cambios)) delete r.id;
    const cols = Object.keys(r);
    const vals = cols.map(c => (r[c] !== null && typeof r[c] === 'object') ? JSON.stringify(r[c]) : r[c]);
    await exec(`INSERT INTO \`${tabla}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
}

await limpiar();
if (CLEAN) { console.log('✓ limpieza hecha (206 y 207 borrados con su cableado)'); process.exit(0); }

// ── el comercio de Perú y su sucursal, que ya existen ──
const [comercio]: any[] = await query('SELECT id, name FROM allieds WHERE country_id=? LIMIT 1', [PAIS]);
if (!comercio) throw new Error(`no hay comercio en el país ${PAIS}: creá uno desde el admin antes de correr esto`);
const [sucursal]: any[] = await query('SELECT id, name FROM allied_branches WHERE allied_id=? LIMIT 1', [comercio.id]);
if (!sucursal) throw new Error(`el comercio ${comercio.id} no tiene sucursal`);

// ⚠ Y se comprueba lo que hace fácil a Perú, porque si alguien habilita una central el flujo cambia
// entero y conviene enterarse acá y no depurando el buró.
const [{ n: centrales }]: any[] = await query('SELECT COUNT(*) AS n FROM risk_centrals WHERE country_id=? AND enabled=1', [PAIS]);
if (centrales > 0) console.log(`⚠ ojo: el país ${PAIS} tiene ${centrales} central(es) habilitada(s); el buró YA NO se salta`);

// ── las dos entidades, clonando la forma del redirect externo ──
const [plantilla]: any[] = await query('SELECT * FROM lenders WHERE id=?', [PLANTILLA]);
const [pSucursal]: any[] = await query('SELECT * FROM lenders_by_allied_branches WHERE lender_id=? LIMIT 1', [PLANTILLA]);
const [pComercio]: any[] = await query('SELECT * FROM lenders_by_allieds WHERE lender_id=? LIMIT 1', [PLANTILLA]);
const pLineas: any[] = await query('SELECT * FROM credit_line_by_lenders WHERE lender_id=?', [PLANTILLA]);
// Sólo para copiarle los niveles de probabilidad, que son presentación y no decisión.
const [pReglaDc]: any[] = await query(
    'SELECT probability_levels FROM lender_datacredito_rules WHERE lender_id=? AND allied_branch_id IS NULL LIMIT 1', [PLANTILLA]);

for (const id of [CONSUMO, VEHICULAR]) {
    await clonar('lenders', plantilla, {
        id, name: NOMBRES[id], slug: SLUGS[id], action: ACCIONES[id],
        country_id: PAIS, response_type: 1, status: 1, abaco: 0,
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
    await clonar('lenders_by_allied_branches', pSucursal, {
        lender_id: id, allied_branch_id: sucursal.id, status: 1, document_types: ['DNI', 'CE'],
        /* ⚠ Y la url del clon (la columna es `url_utm`, no `url`) SE LIMPIA en los dos niveles del
           cableado. Con la de la plantilla adentro, elegir la entidad devuelve ESE redirect y la
           `action` de BCP nunca corre: el sweep lo clasificaba «url→credinet.co», que es Sistecrédito
           hablando por la boca de BCP. Costó dos vueltas encontrarlo porque el nombre no es `url`. */
        url_utm: null,
    });
    if (pComercio) await clonar('lenders_by_allieds', pComercio, { lender_id: id, allied_id: comercio.id, url_utm: null });
    for (const l of pLineas) await clonar('credit_line_by_lenders', l, { lender_id: id });
    /* LAS REGLAS DE DATACRÉDITO, que son FILTRO DURO del listado y son lo que hacía que las dos
       entidades quedaran cableadas y no salieran. La plantilla tiene una regla genérica
       (`allied_branch_id IS NULL`) más una copia por sucursal — así se reparte esta config.
       ⚠ Y van PERMISIVAS a propósito: en un país sin centrales habilitadas el cliente NO tiene score,
       así que una regla con `score` mínimo y `allow_0_score = 0` filtra a todo el mundo. El buró no se
       consulta, pero este filtro del listado sigue mirando la fila. */
    const reglaPermisiva = {
        lender_id: id, score: 0, allow_0_score: 1, current_dues: 99,
        time_finance_sector: 0, negative_historical_last_12_months: 1, consulted_last_6_months: 99,
        probability_levels: pReglaDc?.probability_levels ?? null,
    };
    await clonar('lender_datacredito_rules', reglaPermisiva, { allied_branch_id: null });
    await clonar('lender_datacredito_rules', reglaPermisiva, { allied_branch_id: sucursal.id });
    /* Los estados locales que la integración escribe. Sin la fila que le toca, `resolveStatusId()`
       falla explícito y register() no radica — es el pendiente 1 del comentario de `Bcp.php`.
       ⚠ Y los nombres NO son los mismos en los dos productos: el de consumo usa `BCP_*` y el
       vehicular `BCP_VEHICULAR_*`. Sembrar los cinco de cada uno y no sólo el pendiente, porque la
       vuelta escribe aprobado/rechazado/cancelado y el desembolso el suyo. */
    const prefijo = id === VEHICULAR ? 'BCP_VEHICULAR' : 'BCP';
    for (const [sufijo, desc] of [
        ['PENDING', 'Radicado, esperando el desenlace del checkout'],
        ['APPROVED', 'La contraparte aprobó'],
        ['REJECTED', 'La contraparte rechazó'],
        ['DISBURSED', 'Desembolsado'],
        ['CANCELLED', 'Cancelado por el cliente'],
    ] as const) {
        await clonar('lender_transaction_statuses', { lender_id: id, name: `${prefijo}_${sufijo}`, description: desc }, {});
    }
    console.log(`✓ ${NOMBRES[id]}  id=${id}  país=${PAIS}  sucursal=${sucursal.id}  action=${ACCIONES[id].split('\\').pop()}`);
}

// ── el credential, que NO entra por SQL ──
// La columna es `encrypted:collection`: Eloquent la cifra con APP_KEY al guardar. Un INSERT crudo deja
// un valor que el modelo no puede descifrar, y el fallo aparece después, lejos de acá.
/* Los PEM viajan en base64: un PEM tiene saltos de línea y comillas que pelean con `--execute`. */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const llaves = `[
  'cuotealo_ecommerce_id'  => 'HARNESS-ECOM-%ID%',
  'cuotealo_public_key'    => base64_decode('${b64(LLAVES.publica)}'),
  'cuotealo_private_key'   => base64_decode('${b64(LLAVES.privada)}'),
  'cuotealo_merchant_id'   => 'HARNESS-MERCH',
  'cuotealo_merchant_name' => 'Comercio pruebas Peru',
  'cuotealo_merchant_logo' => 'https://example.invalid/logo.png',
]`;
for (const id of [CONSUMO, VEHICULAR]) {
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
        + `$c->allied()->associate(\\App\\Models\\AlliedBranch::find(${sucursal.id})); `
        + `$c->credential = ${llaves.replace('%ID%', String(id))}; $c->save();`;
    try {
        /* Tinker avisa «Restricted Mode: skipping untrusted project features» y ejecuta igual: el
           aviso es por las extensiones del proyecto, no por el código. ⚠ Y `--trust-project` NO existe
           en esta versión —agregarlo hace fallar el comando entero—. Por eso abajo se VERIFICA la fila
           en vez de creerle al código de salida: la primera versión de esto reportaba ✓ con la fila
           ausente, y el síntoma aparecía lejos (sin credential el flujo se va por la rama de «no hay
           integración» y muestra el modal de «continuá con el asesor»). */
        execFileSync('docker', ['exec', CONTENEDOR, 'php', 'artisan', 'tinker', '--execute', php], { stdio: 'pipe' });
        const [hay]: any[] = await query(
            'SELECT id FROM lender_allied_credentials WHERE lender_id=? AND allied_id=? LIMIT 1', [id, sucursal.id]);
        if (!hay) throw new Error('tinker no falló pero la fila no está (¿Restricted Mode?)');
        console.log(`✓ credential de ${id} sembrado por Eloquent (cifrado con APP_KEY) y verificado en la base`);
    } catch (e: any) {
        console.log(`✗ el credential de ${id} NO se sembró: ${String(e.stderr || '')}${String(e.stdout || '')}${e.message}`.slice(0, 500));
        console.log(`  corrélo a mano:  docker exec ${CONTENEDOR} php artisan tinker --execute "${php.replace(/"/g, '\\"')}"`);
    }
}

/* ── EL FORMULARIO DEL VEHICULAR, Y DÓNDE APARECE ─────────────────────────────────────────────
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
async function sembrarFormulario(alliedId: number, branchId: number) {
    for (const c of PLANTILLA_FORM.field_categories) await clonar('field_categories', c, {});
    for (const ft of PLANTILLA_FORM.form_types) await clonar('form_types', ft, { id: ft.id });
    for (const fi of PLANTILLA_FORM.fields) await clonar('fields', fi, { id: fi.id });
    for (const fo of PLANTILLA_FORM.forms) await clonar('forms', fo, { id: fo.id });
    for (const op of PLANTILLA_FORM.field_options) await clonar('field_options', op, { id: op.id });
    console.log(`✓ formulario del vehicular: ${PLANTILLA_FORM.form_types.length} tipos, `
        + `${PLANTILLA_FORM.fields.length} campos, ${PLANTILLA_FORM.field_options.length} opciones`);

    /* El flujo alterno tiene que estar encendido en el COMERCIO: los dos placements se cuelgan de sus
       bordes, así que sin esta bandera no hay bordes de donde colgarse. */
    await exec('UPDATE allieds SET show_alternate_flow=1 WHERE id=?', [alliedId]);

    const placements = [
        { scope_type: 'allied_branch', scope_id: branchId, credit_line_id: 1, placement: 'pre_alternate_flow',    form_type_id: 8, sort: 1, is_enabled: 1, always_show: 1 },
        { scope_type: 'allied_branch', scope_id: branchId, credit_line_id: 1, placement: 'post_alternate_flow',   form_type_id: 9, sort: 1, is_enabled: 1, always_show: 1 },
        { scope_type: 'lender',        scope_id: VEHICULAR, credit_line_id: 1, placement: 'pre_sign_documents',   form_type_id: 8, sort: 1, is_enabled: 0, always_show: 0 },
        { scope_type: 'lender',        scope_id: VEHICULAR, credit_line_id: 1, placement: 'pre_sign_documents',   form_type_id: 9, sort: 1, is_enabled: 0, always_show: 0 },
    ];
    for (const p of placements) await clonar('dynamic_form_placements', p, {});

    /* ⚠ EL PARCHE LOCAL, y conviene entender qué se pierde con él.
     *
     * «Monto a financiar» (campo 260) es VISIBLE, OBLIGATORIO y **no editable**, y su valor debería
     * salir de `computed.financed_amount`. Verificado el 2026-09-03: **nadie lo calcula** — ni en main
     * ni en las ramas de BCP. El hidratador del formulario conoce el árbol de vehículos, los años, los
     * porcentajes, los países y el árbol de países, y cualquier otra fuente la ignora EN SILENCIO (el
     * aviso por consola está comentado). El campo de moneda sólo dibuja un input deshabilitado. Y el
     * validador exige todo campo visible obligatorio sin mirar si es editable.
     *
     * Resultado en la pantalla: «Monto a financiar es requerido» y ninguna forma de satisfacerlo.
     *
     * Acá se vuelve EDITABLE para que el flujo se pueda recorrer. Es un parche del entorno, no un
     * arreglo: en producción ese número es derivado (valor del vehículo − cuota inicial − bono, que es
     * lo que dice su mensaje de ayuda), así que escribirlo a mano prueba el resto del recorrido pero
     * NO prueba el cálculo. Cuando alguien implemente la fuente, esta línea se borra. */
    await exec('UPDATE forms SET editable=1 WHERE form_type_id=8 AND field_id=260');
    console.log('  ⚠ parche local: «Monto a financiar» quedó editable — su `computed.financed_amount` '
        + 'no lo calcula nadie (ni main ni las ramas de BCP), así que sin esto el formulario no se puede pasar');
    console.log(`✓ placements: paso 1 antes y paso 2 después del flujo alterno (sucursal ${branchId}), `
        + `y el gate de firma apagado con fila explícita`);
}

/* ── EL HOST AL QUE LA CONTRAPARTE DEVUELVE AL CLIENTE ────────────────────────────────────────
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
const [{ value: frontPrevio }]: any[] = await query("SELECT value FROM settings WHERE `key`='front_end_url'");
if (!frontPrevio?.includes(FRONT_LOCAL)) {
    writeFileSync(new URL('../.bcp-front-previo.json', import.meta.url), JSON.stringify({ frontPrevio }) + '\n');
    await exec("UPDATE settings SET value=? WHERE `key`='front_end_url'", [JSON.stringify(FRONT_LOCAL)]);
    console.log(`✓ front_end_url → ${FRONT_LOCAL} (antes ${String(frontPrevio).slice(0, 44)}; guardado para --clean)`);
}

await sembrarFormulario(comercio.id, sucursal.id);

/* Y el comercio se registra en `.flows.json`, que es por donde los runners lo direccionan POR SLUG
   (`sweep.ts matrix peru`). Sin esta entrada el comercio existe en la base y el harness no lo sabe
   nombrar, que es la mitad más frustrante de montar un ambiente. */
const RUTA_FLOWS = new URL('../.flows.json', import.meta.url);
try {
    const flows = JSON.parse(readFileSync(RUTA_FLOWS, 'utf8'));
    const [{ hash }]: any[] = await query('SELECT hash FROM allied_branches WHERE id=?', [sucursal.id]);
    flows.merchants ??= {};
    flows.merchants.peru = { branch_hash: hash };
    writeFileSync(RUTA_FLOWS, JSON.stringify(flows, null, 2) + '\n');
    console.log(`✓ .flows.json: slug «peru» → sucursal ${sucursal.id} (hash ${hash})`);
} catch (e: any) {
    console.log(`✗ no pude escribir .flows.json: ${e.message}`);
}

console.log(`\ncomercio ${comercio.id} «${comercio.name}» · sucursal ${sucursal.id} «${sucursal.name}» · centrales habilitadas: ${centrales}`);
console.log(`falta en el .env del backend (pendiente 4 de Bcp.php, sin defaults):`);
console.log(`  CUOTEALO_MOCKS_ENABLED=true   # la punta que arma y cifra el sobre de ida`);
console.log(`  CUOTEALO_REDIRECT_PATH=…      # a dónde vuelve el cliente`);
console.log(`  CUOTEALO_BACK_URL=…           # el «volver» del checkout`);
process.exit(0);

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
import { readFileSync, writeFileSync } from 'node:fs';

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
    for (const id of [CONSUMO, VEHICULAR]) {
        for (const t of ['lender_allied_credentials', 'lender_transaction_statuses', 'credit_line_by_lenders',
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
        /* ⚠ Los tipos de documento del flujo DINÁMICO —el que usa un comercio de fuera de Colombia—
           son OTRA taxonomía que la del clásico, y hoy son exactamente cuatro: CED (11 dígitos),
           CI_VE (6 a 11), y PAS/PAS_VE (6 a 9 alfanuméricos). Verificado contra main el 2026-09-03 en
           `dynamic-step-one.ts::isSupportedDocumentType`. **No existe DNI**, así que un DNI peruano de
           8 dígitos sólo pasa disfrazado (CI_VE o PAS lo aceptan por rango). Se declara PAS para poder
           recorrer el flujo, y queda dicho que es un disfraz, no la configuración correcta. */
        document_types: ['PAS', 'CI_VE'],
    });
    await clonar('lenders_by_allied_branches', pSucursal, {
        lender_id: id, allied_branch_id: sucursal.id, status: 1, document_types: ['PAS', 'CI_VE'],
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
    // El estado local que la integración escribe al radicar. Sin esta fila, resolveStatusId() falla
    // explícito y register() no radica — es el pendiente 1 del comentario de Bcp.php.
    await clonar('lender_transaction_statuses', { lender_id: id, name: 'BCP_PENDING', description: 'Radicado, esperando el desenlace del checkout' }, {});
    console.log(`✓ ${NOMBRES[id]}  id=${id}  país=${PAIS}  sucursal=${sucursal.id}  action=${ACCIONES[id].split('\\').pop()}`);
}

// ── el credential, que NO entra por SQL ──
// La columna es `encrypted:collection`: Eloquent la cifra con APP_KEY al guardar. Un INSERT crudo deja
// un valor que el modelo no puede descifrar, y el fallo aparece después, lejos de acá.
const llaves = `[
  'cuotealo_ecommerce_id'  => 'HARNESS-ECOM-%ID%',
  'cuotealo_public_key'    => 'harness-public-key-placeholder',
  'cuotealo_merchant_id'   => 'HARNESS-MERCH',
  'cuotealo_merchant_name' => 'Comercio pruebas Peru',
  'cuotealo_merchant_logo' => 'https://example.invalid/logo.png',
]`;
for (const id of [CONSUMO, VEHICULAR]) {
    const php = `\\App\\Models\\LenderAlliedCredential::updateOrCreate(`
        + `['lender_id' => ${id}, 'allied_type' => 'allied', 'allied_id' => ${comercio.id}], `
        + `['credential' => ${llaves.replace('%ID%', String(id))}]);`;
    try {
        execFileSync('docker', ['exec', CONTENEDOR, 'php', 'artisan', 'tinker', '--execute', php], { stdio: 'pipe' });
        console.log(`✓ credential de ${id} sembrado por Eloquent (cifrado con APP_KEY)`);
    } catch (e: any) {
        console.log(`✗ el credential de ${id} NO se sembró: ${String(e.stderr || e.message).split('\n')[0]}`);
        console.log(`  corrélo a mano:  docker exec ${CONTENEDOR} php artisan tinker --execute "${php.replace(/"/g, '\\"')}"`);
    }
}

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

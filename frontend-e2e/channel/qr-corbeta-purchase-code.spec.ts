import { test, expect } from '@playwright/test';

/**
 * CARACTERIZACIÓN del CÓDIGO DE COMPRA en caja (canal QR / Corbeta) — API level, sin navegador.
 *
 * PARA QUÉ SIRVE ESTA SUITE (y por qué existe ANTES de tocar código):
 *   El proyecto en curso reemplaza al emisor del código: hoy lo emite **Corbeta** (su "API Fondos") y
 *   va a emitirlo **Bancolombia** (*In Store Billing Code*). Ese cambio toca dos métodos:
 *     · `merchants/CodeGenerationService::getRequestNumber()`   (emisión)
 *     · `merchants/PurchaseCodeService::validateCurrentOrder()` (consulta de estado)
 *   y hoy ese camino tiene **cero** tests. Esto congela el comportamiento ACTUAL para que la
 *   conmutación de proveedor sea comparable: si un caso de acá cambia, cambió el producto, no el mock.
 *
 * ⚠ EL CASO MÁS IMPORTANTE es "ya facturada → no muestra", porque hoy **NO es una regla escrita**:
 *   `validateCurrentOrder()` pide a Corbeta las órdenes de ayer→mañana con `EstadoOrden = 2` y sólo
 *   busca el PIN en la lista. Cuando la orden pasa a facturada (estado 3) **desaparece del filtro** y
 *   por eso el código deja de mostrarse. Con Bancolombia el estado viene explícito (`billingStatus`)
 *   y habrá que escribir el mapeo a mano — con `default` fail-closed, porque `billingStatus` no es un
 *   enum en el contrato. Este test es el que va a decir si el comportamiento se preservó.
 *
 * REQUISITOS (el `beforeAll` los verifica y salta con un motivo claro, no con un fallo opaco):
 *   · `E2E_TARGET=local` — escribe en la BD. Contra dev/staging se salta a propósito.
 *   · `bin/mock-corbeta start` (:8103) y `CORBETA_HOST=http://host.docker.internal:8103` en el backend.
 *   · `CORBETA_CONVENIO_BNPL` / `_CONSUMO` en el `.env` del backend: si faltan, la emisión muere con un
 *     `TypeError` de PHP (el convenio llega null a `Corbeta::register()`), no con un error de negocio.
 *
 * NO recorre los 20 pasos de la máquina BNPL/Consumo: `seedPurchaseCodeReady()` deja la solicitud en el
 * estado 25 que el guard exige. Ese recorrido completo vive en `dev/qr-corbeta.ts` y es otra prueba.
 */

process.env.E2E_TARGET ||= 'local';

const { one, exec, close } = await import('../pkg/db.ts');
const { config } = await import('../pkg/config.ts');
const { seedPurchaseCodeReady, corbetaBranch } = await import('../pkg/qr.ts');

const API = config.mockUrl;
const MOCK = `http://localhost:${process.env.MOCK_CORBETA_PORT || 8103}`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const HDRS = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };

type Resp = { status: number; json: any };
const post = async (path: string, body: unknown = {}): Promise<Resp> => {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: HDRS, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
        .catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: r.message } };
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 300) } }; }
};
const mock = async (path: string, body?: unknown) => {
    const r = await fetch(`${MOCK}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    return r ? await r.json().catch(() => null) : null;
};

const generar = (ur: number) => post(`/api/onboarding/purchase-code/generate/${ur}`);
const tokenEnBd = (ur: number) => one<{ v: string | null }>(
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.verification_token')) v FROM user_request_additional_information WHERE user_request_id=? AND type_data LIKE '%barcode%' ORDER BY id DESC LIMIT 1", [ur]);

let USER_ID = 0;
let mockArriba = false;
const creadas: number[] = [];

test.beforeAll(async () => {
    mockArriba = !!(await mock('/'));
    // Un usuario propio de la suite: no se toca el teléfono de bypass (que el scrub de bin/asesor borra).
    const doc = `PC-${Date.now()}`;
    const ins = await exec(
        `INSERT INTO users (first_name, surname, full_name, password, document_type, document_number, cell_phone, created_at, updated_at)
         VALUES ('SYNTH','PURCHASE CODE','SYNTH PURCHASE CODE','x','CC',?,?,NOW(),NOW())`,
        [doc, '3130000000'],
    ).catch(() => null);
    USER_ID = ins?.insertId ?? 0;
});

test.afterAll(async () => {
    // Limpia SOLO lo que creó la suite (por id), nunca por teléfono: el scrub por teléfono es de bin/asesor.
    for (const ur of creadas) {
        await exec('DELETE FROM user_request_additional_information WHERE user_request_id=?', [ur]).catch(() => {});
        await exec('DELETE FROM purchase_codes WHERE user_request_id=?', [ur]).catch(() => {});
        await exec('DELETE FROM lender_integration_flows WHERE user_request_id=?', [ur]).catch(() => {});
        await exec('DELETE FROM user_requests WHERE id=?', [ur]).catch(() => {});
    }
    if (USER_ID) await exec('DELETE FROM users WHERE id=?', [USER_ID]).catch(() => {});
    await mock('/_control/reset');
    await close();
});

/** Siembra una solicitud lista (estado 25) y la registra para el cleanup. */
async function lista(producto: 'bnpl' | 'consumo' = 'bnpl') {
    const s = await seedPurchaseCodeReady({ userId: USER_ID, producto });
    if (s) creadas.push(s.userRequestId);
    return s;
}

// SERIAL y en UN worker, obligatorio: la suite comparte dos recursos con estado — la BD local y el
// registro en memoria del mock (que se factura y se resetea por PIN). En paralelo, el cleanup de un
// worker borra las filas de otro y los casos se pisan entre sí (se vio: la 2ª llamada devolvía PCS001
// porque otro worker ya había borrado el `purchase_codes` de la 1ª).
test.describe.configure({ mode: 'serial' });

test.describe('código de compra en caja — comportamiento ACTUAL (proveedor: Corbeta)', () => {
    test.skip(process.env.E2E_TARGET !== 'local', 'escribe en la BD: sólo local');
    test.beforeEach(() => {
        test.skip(!USER_ID, 'no se pudo crear el usuario de la suite');
        test.skip(!mockArriba, `mock-corbeta no responde en ${MOCK} → bin/mock-corbeta start`);
    });

    test('BNPL: emite el PIN, lo persiste y lo muestra', async () => {
        const s = await lista('bnpl');
        expect(s, 'sin sucursal Corbeta con 68/100 habilitados').not.toBeNull();

        const r = await generar(s!.userRequestId);
        expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);

        const code = r.json?.data?.code;
        // El PIN de la API Fondos es hex minúscula de 20 — el backend lo raspa del TEXTO de la respuesta
        // con `/PIN\s+([a-f0-9]{20,})/i` (CodeGenerationService.php:72). Si el charset cambia, se rompe.
        expect(code, 'el PIN no salió con la forma que el backend sabe extraer').toMatch(/^[a-f0-9]{20,}$/);
        expect(r.json?.data?.showBarCode).toBe(true);

        // Persistencia: la MISMA columna que va a seguir usando el proveedor nuevo (decisión D2).
        expect((await tokenEnBd(s!.userRequestId))?.v).toBe(code);
        // Y la orden tiene que existir del lado del proveedor.
        const ordenes = (await mock('/'))?.ordenes ?? [];
        expect(ordenes.some((o: any) => o.pin === code), 'la orden no quedó en el proveedor').toBe(true);
    });

    test('Consumo: mismo contrato que BNPL (cambia el convenio, no la forma)', async () => {
        const s = await lista('consumo');
        expect(s).not.toBeNull();
        const r = await generar(s!.userRequestId);
        expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
        expect(r.json?.data?.code).toMatch(/^[a-f0-9]{20,}$/);
        // `payment_method` es lo único que distingue los productos en la respuesta al front.
        expect(r.json?.data?.payment_method).toBe('BC_CONSUMO');
    });

    test('segunda llamada: devuelve EL MISMO código, no emite otro', async () => {
        const s = await lista('bnpl');
        const a = await generar(s!.userRequestId);
        const b = await generar(s!.userRequestId);
        expect(a.json?.data?.code).toBeTruthy();
        expect(b.json?.data?.code).toBe(a.json?.data?.code);
        // ⚠ LOS CÓDIGOS VAN AL REVÉS DE LO QUE SUGIERE EL NÚMERO, y el handoff los documenta invertidos.
        // Lo dice el propio catálogo del service (`PurchaseCodeService.php:63-68`):
        //   · PCS002 = «Código generado correctamente»  → recién EMITIDO   (return en :265)
        //   · PCS001 = «Código consultado, para la solicitud» → YA EXISTÍA (return en :163)
        // O sea la PRIMERA llamada devuelve PCS002 y la segunda PCS001.
        expect(a.json?.code, 'la 1ª llamada emite → PCS002').toBe('PCS002');
        expect(b.json?.code, 'la 2ª llamada consulta la existente → PCS001').toBe('PCS001');
        // Y NO puede haber una segunda orden en el proveedor por el mismo crédito.
        const pins = ((await mock('/'))?.ordenes ?? []).filter((o: any) => o.pin === a.json?.data?.code);
        expect(pins.length).toBe(1);
    });

    test('YA FACTURADA → deja de mostrar el código (hoy sale del FILTRO, no de una regla)', async () => {
        const s = await lista('bnpl');
        const primera = await generar(s!.userRequestId);
        const code = primera.json?.data?.code;
        expect(primera.json?.data?.showBarCode).toBe(true);

        // El cliente pagó en la caja: la orden pasa a facturada (EstadoOrden 3) del lado del proveedor.
        const f = await mock('/_control/facturar', { pin: code });
        expect(f?.ok, 'el mock no pudo facturar esa orden').toBe(true);

        const despues = await generar(s!.userRequestId);
        // ESTE es el invariante a preservar cuando el emisor pase a ser Bancolombia. Con el proveedor
        // nuevo tendrá que salir de mapear `billingStatus === 'INVOICED'`, explícito.
        //
        // ⚠ Y OJO CON DÓNDE se evalúa: `showBarCode` sale de `validateCurrentOrder()` SÓLO en la rama
        // PCS001 (código ya existente, `:163`). En la rama de emisión (PCS002, `:265`) va **hardcodeado
        // `true`** con el comentario "si llego a este punto es porque esta la orden lista para facturar".
        // O sea la regla de "ya facturada" existe únicamente al RE-consultar. Por eso este caso llama dos
        // veces: la segunda es la única que puede decir false.
        expect(despues.json?.code, 'la re-consulta pasa por la rama que sí mira el estado').toBe('PCS001');
        expect(despues.json?.data?.showBarCode, 'una orden ya facturada NO debe volver a mostrar el código').toBe(false);
        // El código sigue devolviéndose (es el histórico); lo que cambia es que no se muestra.
        expect(despues.json?.data?.code).toBe(code);
    });

    test('guard: fuera del estado 25 no emite (PCS000)', async () => {
        const s = await lista('bnpl');
        // 9 = "Formulario de perfil": cualquier estado que no sea 25 tiene que cortar.
        await exec('UPDATE user_requests SET user_request_status_id=9 WHERE id=?', [s!.userRequestId]);
        const r = await generar(s!.userRequestId);
        expect(r.json?.code).toBe('PCS000');
        expect(r.json?.data?.code ?? null).toBeNull();
    });

    test('guard: comercio que no es Corbeta no emite (PCS000)', async () => {
        const s = await lista('bnpl');
        // Se saca al comercio del gate moviendo la solicitud a un allied que no está en el Setting.
        const otro = await one<{ id: number }>(
            `SELECT a.id FROM allieds a WHERE a.id NOT IN (
                 SELECT CAST(jt.v AS UNSIGNED) FROM settings s,
                 JSON_TABLE(s.value,'$[*]' COLUMNS (v VARCHAR(16) PATH '$')) jt WHERE s.\`key\`='corbeta_allieds')
             LIMIT 1`);
        test.skip(!otro, 'no hay un allied no-Corbeta para el caso');
        await exec('UPDATE user_requests SET allied_id=? WHERE id=?', [otro!.id, s!.userRequestId]);
        const r = await generar(s!.userRequestId);
        expect(r.json?.code).toBe('PCS000');
    });

    test('proveedor caído (HTTP 400): corta con PCS000 y HTTP 500, sin emitir código', async () => {
        // MATIZA EL RIESGO P1 DEL HANDOFF (verificado corriendo, no leyendo): el 400 del proveedor NO
        // produce el `TypeError` de la variable no asignada — sale un **PCS000 controlado con HTTP 500**
        // («Error, la solicitud no puede mostrar el codigo»), porque la excepción se atrapa en el catch
        // general de `PurchaseCodeService` (`:229` → `:252`).
        //
        // El TypeError sí existe, pero su causa es OTRA: **falta la config del convenio**. Con
        // `CORBETA_CONVENIO_BNPL` vacío, `config()` devuelve null, y `Corbeta::register()` lo recibe en un
        // parámetro tipado `string $contract` → `TypeError` antes de cualquier HTTP. Son dos fallas
        // distintas que el handoff junta en una.
        //
        // Se congela el comportamiento REAL: si el proveedor nuevo lo mejora (un error de negocio con
        // código propio) o lo empeora, este test lo dice.
        const s = await lista('bnpl');
        await mock('/_control/reset');
        const antes = await fetch(`${MOCK}/_control/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fail: true }) }).catch(() => null);
        test.skip(!antes || !antes.ok, 'el mock no expone /_control/fail en esta versión');
        const r = await generar(s!.userRequestId);
        await fetch(`${MOCK}/_control/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fail: false }) }).catch(() => null);
        expect(r.status, 'el fallo del proveedor sale como 5xx').toBeGreaterThanOrEqual(500);
        expect(r.json?.code).toBe('PCS000');
        expect(r.json?.data?.code ?? null, 'no debe emitir código si el proveedor falló').toBeNull();
        // Y no debe quedar basura del lado del proveedor: la orden nunca se creó.
        expect(((await mock('/'))?.ordenes ?? []).length).toBe(0);
    });
});

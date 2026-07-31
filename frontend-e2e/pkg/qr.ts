// qr.ts — arma la ENTRADA POR QR: la puerta del cliente que escanea el código en la CAJA de un
// comercio del grupo Corbeta (Alkosto 209 / K-TRONIX 210 / Alkomprar 211).
//
// POR QUÉ EXISTE (tercer canal de entrada, junto a asesor y ecommerce):
//   Es el único canal de **autogestión pura**: no hay asesor, el cliente hace todo el flujo desde su
//   celular en el punto de venta, y termina con un CÓDIGO que presenta en la caja para facturar.
//   Sin este canal, todo el tramo QR → autogestión → producto Bancolombia → código de compra quedaba
//   sin ejercitar.
//
// EL RECORRIDO REAL (verificado contra origin/main, 2026-07-31):
//   1. `application` · `RegisterCellPhoneController@oldIndex` (`:23-51`) recibe `/aliados/onboarding?hash=`
//      y bifurca por 3 caminos: Pash `[218,219,221,222]` → WelcomeUser · **Corbeta** (ids del
//      `Setting('corbeta_allieds')`) → `NewFrontendUrlService::bancolombiaSelfService($hash)` · resto →
//      el flujo normal (`registrar-celular/{hash}`), que sí llega a `/lenders`.
//   2. Para Corbeta la redirección es a **`{wizard}/bancolombia/self-service/{hash}/solicitar`**.
//   3. `routes/bancolombia/onboarding/register.tsx:151` → `.../{phone}/otp`.
//   4. `routes/bancolombia/onboarding/otp.tsx` es el PUNTO DE DECISIÓN: resuelve la pre-aprobación y
//      salta a `/bancolombia/{bnpl|consumo}/start/{encryptCode}` (`:182`) o a `.../no-preapproved/` (`:121`).
//
//   ⚠ OJO: el QR de Corbeta **NO pasa por `/lenders`**. No hay marketplace: el `flowType` (bnpl vs
//   consumo) lo decide el OTP. Por eso este canal no puede reusar el "salto a lenders" de los otros;
//   su salto equivalente es a `/bancolombia/{tipo}/start/{encryptCode}` — ver `bancolombiaEncryptCode`.
//
// POR QUÉ ENTRAMOS EN EL PASO 2 Y NO EN EL 1:
//   El paso 1 vive en `application`, que el harness no levanta (trabaja contra legacy-backend + el
//   wizard). Y lo único que hace es un redirect de una línea a la URL del paso 2. Entrar en el 2 es
//   **el mismo aterrizaje** que produce el QR real, sin depender de otro servicio.
//   Si querés ejercitar la puerta de verdad, exportá `E2E_ALIADOS_URL` (ej. `http://localhost:8000`) y
//   `qrEntryUrl` arma la URL de `application`, redirect incluido.

import { config } from './config.ts';
import { one } from './db.ts';

/** Base del wizard (mismo criterio que el resto del harness). */
const wizard = () => config.feBaseUrl.replace(/\/+$/, '');

/**
 * La URL por la que entra el canal QR.
 *
 * Por defecto: el aterrizaje que produce el QR real (`/bancolombia/self-service/{hash}/solicitar`).
 * Con `E2E_ALIADOS_URL` seteado: la puerta original de `application`, para ejercitar el redirect.
 */
export function qrEntryUrl(branchHash: string): string {
    const aliados = (process.env.E2E_ALIADOS_URL || '').replace(/\/+$/, '');
    if (aliados) return `${aliados}/aliados/onboarding?hash=${encodeURIComponent(branchHash)}`;
    return `${wizard()}/bancolombia/self-service/${encodeURIComponent(branchHash)}/solicitar`;
}

/**
 * El `encryptCode` de las rutas `/bancolombia/{tipo}/{pantalla}/{encryptCode}`.
 *
 * **No es cifrado**: es aritmética en base36. La fórmula sale del propio backend —
 * `PurchaseCodeService::sendPurchaseCodeSms()` la usa para armar el link del SMS:
 *
 *     $crc      = hexdec($alliedBranch->hash);
 *     $combined = ($id << 32) | ($crc & 0xFFFFFFFF);
 *     $encoded  = strtoupper(base_convert($combined, 10, 36));
 *
 * y el front la deshace en `bancolombia-code.value-object.ts` (`userRequestId = decoded >> 32n`,
 * `crc = decoded & 0xffffffffn`). Sin secretos: **el harness puede MINTEAR el código de cualquier
 * solicitud que siembre** y saltar directo a la pantalla que quiera, incluida `purchase-code`.
 *
 * ⚠ TECHO LATENTE (no es nuestro bug, pero conviene saberlo): del lado PHP `base_convert()` convierte
 * vía float, así que arriba de 2^53 pierde precisión. Como el valor es `id << 32`, el límite práctico
 * es `user_request_id ≈ 2^21 = 2.097.152`. Hoy los ids van por ~400.000, así que hay aire; pasado ese
 * punto el link del SMS y el decoder del front dejarían de coincidir. Acá usamos BigInt: exacto siempre.
 */
export function bancolombiaEncryptCode(userRequestId: number, branchHash: string): string {
    const crc = BigInt(`0x${branchHash.trim()}`) & 0xffffffffn;
    const combined = (BigInt(userRequestId) << 32n) | crc;
    return combined.toString(36).toUpperCase();
}

/** Deshace `bancolombiaEncryptCode` — espejo del decoder del front, para poder assertear. */
export function decodeBancolombiaCode(code: string): { userRequestId: number; crc: number } | null {
    if (!/^[0-9A-Z]+$/i.test(code)) return null;
    let acc = 0n;
    for (const ch of code.toUpperCase()) {
        const d = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
        if (d < 0 || d > 35) return null;
        acc = acc * 36n + BigInt(d);
    }
    return { userRequestId: Number(acc >> 32n), crc: Number(acc & 0xffffffffn) };
}

/**
 * Elige una sucursal Corbeta usable para el canal.
 *
 * "Usable" = está en `Setting('corbeta_allieds')` **y** tiene los dos lenders de Bancolombia
 * habilitados en `lenders_by_allied_branches` (68 BNPL / 100 Consumo). Sin lo segundo el OTP resuelve
 * `no_preapproved` y el flujo muere antes de empezar.
 *
 * Default preferido: la **946** (Alkosto, Bogotá `11001`) — es la sucursal de las 4 solicitudes reales
 * que llegaron al estado 25 en marzo de 2026, así que es la que más se parece a producción.
 */
export async function corbetaBranch(preferId = 946): Promise<{ id: number; hash: string; alliedId: number } | null> {
    const sql = `
        SELECT ab.id, ab.hash, ab.allied_id AS alliedId
        FROM allied_branches ab
        WHERE ab.hash IS NOT NULL AND ab.hash <> ''
          AND ab.allied_id IN (
              SELECT CAST(jt.v AS UNSIGNED) FROM settings s,
              JSON_TABLE(s.value, '$[*]' COLUMNS (v VARCHAR(16) PATH '$')) jt
              WHERE s.\`key\` = 'corbeta_allieds'
          )
          AND (SELECT COUNT(DISTINCT lender_id) FROM lenders_by_allied_branches lbab
               WHERE lbab.allied_branch_id = ab.id AND lbab.lender_id IN (68, 100)) = 2
        ORDER BY (ab.id = ?) DESC, ab.id
        LIMIT 1`;
    return await one<{ id: number; hash: string; alliedId: number }>(sql, [preferId]);
}

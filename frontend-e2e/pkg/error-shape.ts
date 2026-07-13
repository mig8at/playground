/**
 * pkg/error-shape — aserciones tolerantes contra el shape heterogéneo de errores del backend real.
 *
 * Justificación: el backend NO emite errores en un único shape. El backend-e2e/channel/negative.go ya
 * documenta esta heterogeneidad usando un OR `errCode(body, code) || errSubcode(body, sub) || message...`.
 * Los shapes observados en el backend real incluyen:
 *   - `error_code` concatenado:  `error_code: "ONB005_EXPEDITION_DATE_INVALID"`
 *   - campos separados anidados: `errors.error_code: "ONB001"` + `errors.error_subcode: "CODE_INVALID"`
 *   - shape KYC anidado:         `error.code: "DOCUMENT_NOT_FOUND"`
 *   - mensaje libre fallback:    `message: "document number already in use"`
 *
 * En vez de probar cada shape uno por uno, ESTAS funciones buscan los markers (strings) en CUALQUIER
 * parte del body, recursivamente. Es lo más robusto sin asumir un contrato fijo. El catálogo de markers
 * válidos vive en pkg/config.ts::expectedSubcodes.
 *
 * Especificación dueña: docs/REFERENCIA-FLUJOS.md §13 (Nomenclatura).
 */

/** Recorre body recursivamente y devuelve true si encuentra `marker` como substring en cualquier string. */
export function bodyContains(body: unknown, marker: string): boolean {
    if (body == null) return false;
    if (typeof body === 'string') return body.includes(marker);
    if (typeof body === 'number' || typeof body === 'boolean') return false;
    if (Array.isArray(body)) return body.some((v) => bodyContains(v, marker));
    if (typeof body === 'object') {
        for (const v of Object.values(body as Record<string, unknown>)) {
            if (bodyContains(v, marker)) return true;
        }
    }
    return false;
}

/** Devuelve true si el body indica fallo (success false / status field / contiene "error" en keys). */
export function bodyIndicatesFailure(body: unknown): boolean {
    if (body == null || typeof body !== 'object') return false;
    const obj = body as Record<string, unknown>;
    if (obj.success === false) return true;
    if (typeof obj.error_code === 'string' && obj.error_code.length > 0) return true;
    if ('errors' in obj && obj.errors != null) return true;
    if ('error' in obj && obj.error != null) return true;
    return false;
}

/**
 * Aserción combinada para "el backend rechazó con este `error_code` Y este sufijo descriptivo".
 * Devuelve un objeto con resultados booleanos y un mensaje legible para incluir en el `expect(...).toBe(true)`.
 * Espera tolerar las 4 formas de transporte descritas arriba.
 */
export function assertSubcode(
    body: unknown,
    code: string,
    subcode: string,
): { hasFailure: boolean; hasCode: boolean; hasSubcode: boolean; ok: boolean; debug: string } {
    const hasFailure = bodyIndicatesFailure(body);
    const hasCode = bodyContains(body, code);
    const hasSubcode = bodyContains(body, subcode);
    return {
        hasFailure,
        hasCode,
        hasSubcode,
        ok: hasFailure && (hasCode || hasSubcode),
        debug: `code=${code} sub=${subcode} → failure=${hasFailure} code=${hasCode} sub=${hasSubcode} · body=${JSON.stringify(body).slice(0, 300)}`,
    };
}

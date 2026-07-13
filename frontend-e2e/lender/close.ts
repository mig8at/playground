import { expect, type Page } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';
import { seedRiskProfile } from '../merchant/seed';

/**
 * Eje LENDER — cierre por UI, espejo de `backend-e2e/lender/{lender.go,closes.go}`.
 *
 * ✅ VERIFICADO (la parte más difícil): `seedAndOfferLender` consigue que el marketplace OFREZCA un lender
 * que con el perfil de onboarding NO aparece (marketplace restrictivo). Patrón: llegar a /lenders → sembrar
 * un perfil que califique (score/reportado) → recargar → el lender aparece como `lender-action-{id}`.
 * Comprobado: CrediPullman #77 (rt=2) aparece con score 800 + reportado=no en el branch 3e67eade.
 *
 * ⏸️ PENDIENTE (cierre rt=2 completo por UI) — SECUENCIA REAL DESCIFRADA (dump del DOM):
 *   1. Seleccionar el PLAZO: en la card del lender hay un `combobox` (role="combobox", ej. "12 cuotas").
 *      → necesita testid `lender-term-{id}` (hoy sin testid; es un combobox, no un botón simple).
 *   2. Click `lender-action-{id}` ("Validar Pre aprobado"). LA PRE-APROBACIÓN SÍ PASA (con perfil sembrado);
 *      NO navega: la card se EXPANDE inline pidiendo la CUOTA INICIAL ("La cuota inicial mínima es $225.000").
 *   3. Llenar `initial-fee-input` (¡ya tiene testid!) con ≥ el mínimo → continuar.
 *   4. RAMA por cuota inicial (available-lenders.tsx:180): si `initial_fee > 0` → redirect a **initialFeePayment
 *      (Wompi)** — requiere mock de Wompi (otro hurdle); si `initial_fee == 0` → directo a first-payment-date.
 *   5. first-payment-date → payment-schedule → sign-documents → otp firma → loan-approved.
 *
 * ⛔ MURO (re-investigado 2026-06, leyendo wizard + legacy-backend): el cierre rt=2 → loan-approved POR UI
 *    NO se traba en el checkout de Wompi — ESO ya se resolvió con `pkg/wompi-mock.ts` (intercepta la
 *    navegación al checkout hosted y rebota a /down-payment-validation; el backend auto-aprueba con
 *    WOMPI_MOCK_ENABLED=true). La cadena post-pago SÍ está cableada: down-payment-validation → confirmation
 *    → first-payment-date → payment-schedule → sign-documents → loan-approved.
 *    El blocker REAL para #77 es el MOTOR DE SCORING: `getInitialFeeData` calcula
 *    initial_fee = (categoría.min_initial_fee/100) × amount, y la categoría que el motor SQL asigna a score
 *    800 tiene min_initial_fee=0 → monto $0 → el botón "Pagar cuota inicial" queda DISABLED → el redirect a
 *    Wompi (que el mock interceptaría) nunca se dispara. Forzar la fila lender_users_categories NO alcanza
 *    (la asignación es del motor de scoring SQL). Cerrar por UI exige: (a) un lender rt=2 con fee>0
 *    CONSISTENTE (categoría asignada con min_initial_fee>0), o (b) intervenir el motor de scoring —
 *    fuera del alcance "solo bypass". El mock está LISTO y VERIFICADO (lender/wompi-close.spec.ts test 1).
 *    El cierre rt=2 → Estado 11 YA está validado en BACKEND (`go run . asesor 3e67eade 77`).
 *
 * Testids del Grupo B/C (lender-term-{id}, first-payment-date-*, payment-schedule-*, sign-documents-*,
 * signature-otp-submit, loan-approved-title) quedan SIN AGREGAR: no desbloquean el cierre mientras persista
 * el muro de config (la UI nunca llega a esos pasos). Ver PLAN-PRUEBAS.md.
 */

export interface OfferOptions {
    score?: number;
    reportado?: boolean;
    amount?: string;
}

/**
 * Lleva el flujo hasta /lenders y SIEMBRA un perfil para que el marketplace ofrezca `lenderId`.
 * Devuelve {phone, loanRequestId} y deja la página en /lenders con `lender-action-{lenderId}` visible.
 * ✅ Verificado para rt=2 #77 en 3e67eade.
 */
export async function seedAndOfferLender(
    page: Page,
    merchantHash: string,
    lenderId: number,
    opts: OfferOptions = {},
): Promise<{ phone: string; loanRequestId: string }> {
    const { score = 800, reportado = false, amount } = opts;
    const ctx = await runHappyPathUntilLenders(page, merchantHash, { amount });
    seedRiskProfile(ctx.phone, Number(ctx.loanRequestId), { score, reportado });
    await page.reload();
    await page.waitForURL(/\/lenders/, { timeout: 15_000 });
    await expect(page.getByTestId(`lender-action-${lenderId}`)).toBeVisible({ timeout: 15_000 });
    return ctx;
}

/**
 * Cierre Creditop X (rt=2) por UI. Espejo de `lender.go::CreditopXClose`.
 * ⛔ BLOQUEADO por config de lender del mirror (ver doc arriba): #77 → Wompi hosted; #37 → continue?url=null (404).
 *    Lanza con el diagnóstico exacto. El cierre rt=2 → Estado 11 está validado en BACKEND (asesor 3e67eade 77).
 */
export async function creditopXClose(page: Page, merchantHash: string, lenderId: number): Promise<void> {
    await seedAndOfferLender(page, merchantHash, lenderId);
    await page.getByTestId(`lender-action-${lenderId}`).click(); // pre-aprobación OK → pero la ruta de cierre es externa/rota
    throw new Error(
        `creditopXClose: #${lenderId} se OFRECE y es seleccionable, pero el cierre rt=2 → loan-approved por UI está ` +
            'bloqueado por config de lender en el mirror local: la acción del FE rutea a Wompi hosted (#77, exige ' +
            'cuota inicial) o a /continue?url=null (#37, redirect con URL nula → 404). Ninguno cierra in-platform. ' +
            'El cierre rt=2 → Estado 11 está validado en BACKEND: backend-e2e `go run . asesor 3e67eade 77`.',
    );
}

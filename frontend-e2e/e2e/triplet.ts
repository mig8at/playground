import { expect, type Page } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * Modelo composable `canal → comercio → lender` por UI, espejo del backend-e2e (`go run . <canal> <comercio>
 * <lender>`). Aquí el "motor" es Playwright manejando el wizard real contra el legacy-backend en modo mock.
 *
 * EJES:
 *  - canal:    `asesor` (/self-service/...) · `web` (/ecommerce/... handshake)
 *  - comercio: el HASH del branch (resuelto en la BD, igual que backend-e2e merchant.Resolve)
 *  - lender:   a quién se cierra (opcional; el cierre in-platform por UI requiere testids en las pantallas
 *              de cierre — ver nota abajo).
 *
 * NOTA (cobertura por UI hoy):
 *  - canal `asesor` → /lenders: ✅ drivable (entrada + Quanto/Corbeta + marketplace).
 *  - canal `web` (ecommerce): ⏸️ el handshake real exige el contrato base64 completo (da 500 con
 *    placeholders); ver ecommerce-ui.spec.ts. Lanza error claro hasta replicar el contrato.
 *  - cierre del lender (rt=2 Creditop X: sign-documents → OTP firma → authorize → aprobado): ⏸️ las pantallas
 *    de cierre NO tienen data-testid (el stash solo llega a initial-fee). Falta extender el stash para
 *    drivearlas por UI. El cierre ya está validado en backend-e2e forzando el lender.
 */

export type Channel = 'asesor' | 'web';

export interface Triplet {
    channel: Channel;
    /** hash del comercio (branch) */
    merchant: string;
    /** id o nombre del lender (para asertar oferta / futuro cierre) */
    lender?: string;
    amount?: string;
}

/** Lee la tripleta de env (E2E_CHANNEL / E2E_MERCHANT / E2E_LENDER), como el CLI de backend. */
export function tripletFromEnv(): Triplet | null {
    const merchant = process.env.E2E_MERCHANT;
    if (!merchant) return null;
    const channel = (process.env.E2E_CHANNEL as Channel) ?? 'asesor';
    return { channel, merchant, lender: process.env.E2E_LENDER, amount: process.env.E2E_AMOUNT };
}

/**
 * Corre la entrada del canal hasta /lenders. Es el tramo composable que SÍ se valida por UI hoy.
 * Devuelve cuando el wizard aterriza en la pantalla de entidades.
 */
export async function runTripletToLenders(page: Page, t: Triplet): Promise<void> {
    if (t.channel === 'web') {
        throw new Error(
            'canal `web` (ecommerce) aún no drivable por UI: el handshake real exige el contrato base64 ' +
                'completo (ver ecommerce-ui.spec.ts). Usá canal `asesor` o completá el contrato.',
        );
    }
    await runHappyPathUntilLenders(page, t.merchant, { amount: t.amount });
    await expect(page).toHaveURL(/\/lenders/);
}

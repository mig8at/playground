/**
 * Helpers compartidos para el wizard self-service.
 *
 * Este archivo es un AGGREGATOR de back-compat: re-exporta los pasos atómicos
 * desde `pkg/wizard-steps.ts` y `runHappyPathUntilLenders` que es un wrapper sobre
 * `composeFlow({channel: 'self-service'})`. La implementación canónica del wizard
 * vive en `pkg/composer.ts` (preset `wizards.standard`).
 *
 * Por qué la indirección: ANTES `channel/steps.ts` tenía tanto los `fillX` como un
 * `Flow` inline que duplicaba lo del composer. Para eliminar la duplicación SIN romper
 * los imports de specs antiguos (`import { fillAmountStep, ... } from '../channel/steps'`),
 * los `fillX` se mudaron a `pkg/wizard-steps.ts` y este archivo los re-exporta.
 */
import type { Page } from '@playwright/test';
import { composeFlow } from '../pkg/composer';

export {
    fillAmountStep,
    fillEmploymentInfo,
    fillExpeditionDate,
    fillOtpStep,
    fillPersonalInfoIdentification,
    fillPhoneStep,
} from '../pkg/wizard-steps';

/**
 * Recorre el flujo completo amount → phone → otp → personal → employment y aterriza
 * en `/lenders`. Implementado como wrapper sobre `composeFlow({channel: 'self-service'})`
 * — los pasos del wizard standard son el preset `wizards.standard` del composer.
 *
 * Para encadenar pasos propios antes/después (login Cognito, seed de perfil), o para
 * usar otro canal (merchant-cognito), llama directamente a `composeFlow({...})` desde
 * tu spec; este wrapper existe solo para los specs que ya lo importan.
 */
export async function runHappyPathUntilLenders(
    page: Page,
    partnerHash: string,
    options: { entryPath?: string; amount?: string; phone?: string; flowName?: string; summary?: string } = {},
): Promise<{ phone: string; loanRequestId: string }> {
    const { flow, ctx } = composeFlow({
        page,
        partnerHash,
        channel: 'self-service',
        options: {
            entryPath: options.entryPath,
            amount: options.amount,
            phone: options.phone,
        },
        flowName: options.flowName ?? `Happy path · partner ${partnerHash}`,
        summary: options.summary ?? 'amount → phone → otp → [personal · employment] → /lenders',
    });
    await flow.run(ctx);
    return { phone: ctx.str('phone'), loanRequestId: ctx.str('loanRequestId') };
}

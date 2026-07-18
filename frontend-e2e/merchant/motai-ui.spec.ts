import { expect, test } from '@playwright/test';
import { cognitoCreds } from '../pkg/config';
import { acquireAccountLock, MOTAI_MERCHANT, pointAccount, releaseAccountLock } from '../pkg/account-lock';
import { composeFlow } from '../pkg/composer';
import { cognitoStorageState } from '../pkg/cognito';

/**
 * Motai (lender 158, branch f0548728) POR UI — flujo `/merchant/*` (requiere sesión Cognito).
 *
 * PRERREQUISITOS (entorno):
 *  - Credenciales Cognito en env: E2E_COGNITO_USER / E2E_COGNITO_PASS (de una cuenta MERCHANT).
 *  - Esa cuenta debe estar ligada a Motai en la BD local: la fila `users` cuyo `cognito_id` = el SUB real
 *    de la sesión debe tener allied_id=158, allied_branch_id=682, user_profile_id=4. (El sub real se captura
 *    backend-side: log temporal de `x-cognito-identity-id` en UserController@userData. Ver VALIDATION.md.)
 *
 * Verificado headed: login -> /merchant/f0548728/solicitar -> monto -> telefono -> OTP -> personal-info ->
 * fecha -> /lenders (marketplace Motai con Productos). La parte distintiva (seleccionar #158 -> IMEI/Abaco
 * device flow) necesita los testids del Grupo E/F (ver PLAN-PRUEBAS.md) + que el marketplace ofrezca #158.
 */

test.describe.configure({ mode: 'serial' });
// storageState: reusa la sesión Cognito cacheada (compartida con smartpay; el asesor es el mismo sub).
test.use({ launchOptions: { slowMo: 300 }, storageState: cognitoStorageState() });

// La cuenta 1827080 es un singleton compartido (ver pkg/account-lock). Tomamos el mutex y la apuntamos a
// Motai para no chocar con smartpay-dynamic (que la apunta a SmartPay). Liberamos al terminar.
test.beforeAll(async () => {
    if (!cognitoCreds.user) return;
    test.setTimeout(220_000); // el lock-wait puede tardar si smartpay-dynamic está corriendo
    await acquireAccountLock();
    pointAccount(MOTAI_MERCHANT.allied, MOTAI_MERCHANT.branch);
});
test.afterAll(() => {
    if (!cognitoCreds.user) return;
    releaseAccountLock();
});

test('Motai por UI: login Cognito → entrada → marketplace Motai (/lenders)', async ({ page }) => {
    test.skip(!cognitoCreds.user, 'Requiere credenciales Cognito (.cognito.json o env) + cuenta ligada a Motai (ver doc)');
    test.setTimeout(180_000);

    // Composer: 'motai' está mapeado a {channel: 'merchant-cognito', wizard: 'standard'}.
    // El mismo wizard estándar que usan Pullman/Corbeta — lo único que cambia es la entrada
    // (login Cognito + ruta /merchant/* en vez de /self-service/*).
    const { flow, ctx } = composeFlow({ page, partnerHash: 'f0548728', merchant: 'motai' });
    await flow.run(ctx);

    await expect(page).toHaveURL(/\/lenders/);
    expect(ctx.str('loanRequestId')).toMatch(/^\d+$/);
});

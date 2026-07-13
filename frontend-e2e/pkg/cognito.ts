import { expect, type Locator, type Page } from '@playwright/test';
import { cognitoCreds } from './config';

/**
 * Llena un input y VERIFICA que el valor quedó. El Managed Login de Cognito a veces ignora el primer
 * `fill()` (queda vacío → "Falta nombre de usuario" al avanzar); si pasa, reintenta tecla por tecla.
 */
async function robustFill(loc: Locator, value: string): Promise<void> {
    await expect(loc).toBeVisible({ timeout: 15_000 });
    await expect(loc).toBeEnabled({ timeout: 10_000 });
    await loc.click();
    // pressSequentially (no fill): el Managed Login usa inputs CONTROLADOS por React. `fill()` setea el
    // DOM pero NO siempre el estado React → al enviar va vacío ("Falta nombre de usuario"). Teclear char
    // por char dispara los eventos que React escucha. Reintenta una vez si no quedó.
    await loc.fill('');
    await loc.pressSequentially(value, { delay: 60 });
    if ((await loc.inputValue()) !== value) {
        await loc.fill('');
        await loc.pressSequentially(value, { delay: 90 });
    }
    await expect(loc).toHaveValue(value, { timeout: 5_000 });
}

/**
 * Login en el Hosted UI de Cognito (login.creditop.com) para desbloquear los flujos `/merchant/*`
 * (Motai, SmartPay, asesor), que exigen sesión. Dos pasos: usuario → "Siguiente" → contraseña → "Continuar".
 * Credenciales: env (E2E_COGNITO_USER/PASS) o `.cognito.json` gitignored (ver pkg/config.ts). NUNCA commitear.
 *
 * Botones AGNÓSTICOS AL IDIOMA: el pool de dev a veces renderiza el Managed Login en INGLÉS
 * ("Next"/"Sign in"), el client merchant en español ("Siguiente"/"Continuar"). Si no aparece el
 * form de usuario (sesión ya activa o sin redirect a Cognito), retorna sin hacer nada.
 *
 * `returnUrl`: patrón al que vuelve la app tras el callback (default el wizard local :5174).
 */
export async function cognitoLogin(
    page: Page,
    user = cognitoCreds.user,
    pass = cognitoCreds.pass,
    returnUrl: RegExp = /localhost:5174/,
): Promise<void> {
    if (!user || !pass) throw new Error('Faltan credenciales Cognito (env E2E_COGNITO_USER/PASS o .cognito.json)');
    const username = page.locator('input[name=username]');
    try {
        await expect(username).toBeVisible({ timeout: 15_000 });
    } catch {
        return; // no hubo redirect a Cognito (sesión ya activa) — nada que loguear
    }
    await robustFill(username, user); // asegura que el usuario quedó antes de avanzar
    await page.getByRole('button', { name: /siguiente|next/i }).click();
    const pwd = page.locator('input[name=password]');
    await expect(pwd).toBeVisible({ timeout: 20_000 });
    await robustFill(pwd, pass);
    await page.getByRole('button', { name: /continuar|continue|sign\s*in|iniciar/i }).click();
    // Vuelve a la app tras el callback de Cognito.
    await page.waitForURL(returnUrl, { timeout: 25_000 });
}

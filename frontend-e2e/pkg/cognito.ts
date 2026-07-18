import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { cognitoCreds } from './config';

/**
 * Cache de sesión Cognito para NO re-loguear por el Hosted UI en cada corrida.
 * `.auth/cognito-state.json` (gitignored) = storageState de Playwright (cookies + tokens en localStorage).
 * El wizard/app refresca solo el access token con el refresh token guardado → la sesión reusable dura
 * la ventana del refresh token (días), no la del access token (1h). Autocorrector: si la sesión murió,
 * el Hosted UI reaparece y `cognitoLogin` re-loguea + re-guarda.
 */
export const COGNITO_STATE_PATH = '.auth/cognito-state.json';

/** Devuelve la ruta del storageState cacheado si existe (para `test.use({ storageState })`), o undefined. */
export function cognitoStorageState(): string | undefined {
    return existsSync(COGNITO_STATE_PATH) ? COGNITO_STATE_PATH : undefined;
}

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
    savePath: string | null = COGNITO_STATE_PATH,
): Promise<void> {
    if (!user || !pass) throw new Error('Faltan credenciales Cognito (env E2E_COGNITO_USER/PASS o .cognito.json)');
    const username = page.locator('input[name=username]');
    try {
        await expect(username).toBeVisible({ timeout: 15_000 });
    } catch {
        return; // no hubo redirect a Cognito (sesión ya activa, típico si se inyectó el cache) — nada que loguear
    }
    await robustFill(username, user); // asegura que el usuario quedó antes de avanzar
    await page.getByRole('button', { name: /siguiente|next/i }).click();
    const pwd = page.locator('input[name=password]');
    await expect(pwd).toBeVisible({ timeout: 20_000 });
    await robustFill(pwd, pass);
    await page.getByRole('button', { name: /continuar|continue|sign\s*in|iniciar/i }).click();
    // Vuelve a la app tras el callback de Cognito.
    await page.waitForURL(returnUrl, { timeout: 25_000 });
    // SOLO tras un login REAL (llegamos acá = hubo form + callback OK) cacheamos la sesión para reusarla.
    // En el branch no-op de arriba NO guardamos (la página podría no estar autenticada → envenenaría el cache).
    if (savePath) {
        try { mkdirSync(dirname(savePath), { recursive: true }); await page.context().storageState({ path: savePath }); } catch { /* best-effort */ }
    }
}

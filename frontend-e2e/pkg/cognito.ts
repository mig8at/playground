import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { cognitoCreds, config } from './config.ts';
import { TARGET } from './env.ts';

/**
 * Cache de sesión Cognito para NO re-loguear por el Hosted UI en cada corrida.
 * `.auth/cognito-state.json` (gitignored) = storageState de Playwright (cookies + tokens en localStorage).
 * El wizard/app refresca solo el access token con el refresh token guardado → la sesión reusable dura
 * la ventana del refresh token (días), no la del access token (1h). Autocorrector: si la sesión murió,
 * el Hosted UI reaparece y `cognitoLogin` re-loguea + re-guarda.
 */
/**
 * POR TARGET: dev y staging son pools de Cognito DISTINTOS. Con un único archivo, la sesión de dev se
 * inyectaría en la corrida de staging (cookies + tokens del otro pool) y el front quedaría en un limbo
 * —autenticado para Cognito, desconocido para el backend— sin que aparezca el login que lo corregiría.
 */
export const COGNITO_STATE_PATH = `.auth/cognito-state.${TARGET}.json`;

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
 * `returnUrl`: patrón al que vuelve la app tras el callback. El default se DERIVA del host configurado
 * para el target (`config.feBaseUrl`), no de `localhost:5174` fijo: contra `staging` la app vuelve al
 * front desplegado y un patrón hardcodeado nunca matchearía — el login moriría en el waitForURL.
 */
/** Rutas de la app que sólo REDIRIGEN tras el callback de Cognito (no son destino final). Esperar a
 *  SALIR de ellas asegura que la cadena `callback → /merchant → /solicitar` terminó y la sesión de la
 *  app ya está asentada — antes de cachear el storageState o de que alguien navegue. Ver F-66. */
const AUTH_TRANSIT = /^\/(auth\/callback|merchant)\/?$/;

/** Host de la app para el target ("originaciones-stg.dev.creditop.com" · "localhost:5174"). */
function appHost(baseUrl: string): string {
    try { return new URL(baseUrl).host; } catch { return 'localhost:5174'; }
}

export async function cognitoLogin(
    page: Page,
    user = cognitoCreds.user,
    pass = cognitoCreds.pass,
    returnHost: string = appHost(config.feBaseUrl),
    savePath: string | null = COGNITO_STATE_PATH,
): Promise<void> {
    if (!user || !pass) throw new Error('Faltan credenciales Cognito (env E2E_COGNITO_USER/PASS o .cognito.json)');
    const username = page.locator('input[name=username]');
    try {
        await expect(username).toBeVisible({ timeout: 15_000 });
    } catch {
        // Sin campo de usuario. Lo normal es que la sesión ya esté activa (cache inyectado) y no haya
        // nada que loguear. Pero si la URL SÍ parece un login, el formulario existe y no lo encontramos:
        // ahí callarse convierte un problema de selector en un timeout mudo 90s después (fue exactamente
        // lo que pasó con el Hosted UI de staging). Avisamos, sin romper: el flujo decide.
        if (/login|authorize|client_id=/i.test(page.url())) {
            console.log(`    ⚠ cognito: la URL parece un login pero no apareció input[name=username] → ${page.url().slice(0, 120)}`);
        }
        return;
    }
    await robustFill(username, user); // asegura que el usuario quedó antes de avanzar
    await page.getByRole('button', { name: /siguiente|next/i }).click();
    const pwd = page.locator('input[name=password]');
    await expect(pwd).toBeVisible({ timeout: 20_000 });
    await robustFill(pwd, pass);
    await page.getByRole('button', { name: /continuar|continue|sign\s*in|iniciar/i }).click();
    // Vuelve a la app tras el callback de Cognito. DOS trampas ya mordieron acá, en orden:
    //
    //  1. Se comparaba el href contra un REGEX del host de la app… pero las URLs del Hosted UI llevan el
    //     host de la app ADENTRO del query (`redirect_uri=https%3A%2F%2Foriginaciones-stg…`), así que el
    //     "espera a volver a la app" se satisfacía EN LA PROPIA PÁGINA DEL PASSWORD, 0s después del click.
    //     Nadie esperaba el login real: el warm reportaba "colgado en /verifyPassword" (el auth seguía en
    //     vuelo), y el goto siguiente de una corrida lo INTERRUMPÍA — el loop de rebotes a Cognito y las
    //     cookies `oauth2:*` acumuladas eran la huella. Por eso se compara `url.host === returnHost`, no
    //     un substring del href. (De acá salió el falso "el Managed Login bloquea headless": F-66.)
    //  2. Tocar el host no alcanza: el aterrizaje es una ruta de TRÁNSITO (`/auth/callback`, `/merchant`)
    //     que redirige de nuevo, con el Set-Cookie de sesión en vuelo. Hay que DESCANSAR fuera de
    //     tránsito y con la red quieta antes de devolver el control (o de cachear la sesión).
    const onApp = (url: URL) => url.host === returnHost;
    await page.waitForURL(onApp, { timeout: 25_000 });
    await page
        .waitForURL((url) => onApp(url) && !AUTH_TRANSIT.test(url.pathname), { timeout: 15_000 })
        .catch(() => { /* best-effort: si no sale de tránsito, seguimos con lo que haya */ });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    // SOLO tras un login REAL (llegamos acá = hubo form + callback OK) cacheamos la sesión para reusarla.
    // En el branch no-op de arriba NO guardamos (la página podría no estar autenticada → envenenaría el cache).
    // Cachear DESPUÉS del settle es lo que hace que el cache incluya la cookie de sesión de la APP: antes se
    // fotografiaba en tránsito, sin ella, y el cache de staging nunca evitaba el login (círculo vicioso, F-66).
    await persistCognitoState(page, savePath);
}

/**
 * Persiste el storageState (cookies + localStorage) para reusar la sesión y NO re-loguear. Endurece dos
 * cosas sobre `storageState({path})` pelado, que dejaba el cache de staging inservible — el wizard re-logueaba
 * cada corrida y por eso el salto directo pasaba por `/solicitar` (F-66):
 *
 *  1. **Session-cookies → con expiry.** La cookie de sesión del wizard (`__session`, ver session.server.ts:
 *     host-only, sin `maxAge`) es una *session cookie*. Playwright la serializa con `expires:-1` y al
 *     restaurarla con `test.use({ storageState })` puede descartarla → el cache "existe" pero no autentica.
 *     Le damos un `expires` a +7 días para que sobreviva la restauración. Inocuo: el cache es local y gitignored.
 *  2. **Diagnóstico.** Loguea la URL y las cookies (cuántas, y si está `__session`) al momento de guardar. Si
 *     dice `__session: NO`, el cache seguirá sin evitar el login y hay que ver por qué (¿se guardó en tránsito,
 *     antes de que el callback la setee?). Es la señal que faltaba para cerrar el diagnóstico de F-66.
 *
 * Reutilizable: el guiado la vuelve a llamar YA en `/lenders` (una ruta autenticada), donde `__session`
 * existe con seguridad — más robusto que confiar solo en el instante del login.
 */
export async function persistCognitoState(page: Page, savePath: string | null = COGNITO_STATE_PATH): Promise<void> {
    if (!savePath) return;
    try {
        const state = await page.context().storageState();
        // Las cookies `oauth2:*` son el state CSRF EFÍMERO del handshake OAuth (remix-auth-oauth2, maxAge
        // 15min). Persistirlas hace que el cache las ACUMULE entre corridas y un login futuro arranque con
        // handshakes viejos colgando (se vieron 5 juntas). No son sesión → fuera del cache. F-66.
        state.cookies = (state.cookies ?? []).filter((c) => !/^oauth2:/.test(c.name));
        const cookies = state.cookies;
        const weekAhead = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
        for (const c of cookies) if (!c.expires || c.expires <= 0) c.expires = weekAhead; // session-cookie → persistible
        mkdirSync(dirname(savePath), { recursive: true });
        writeFileSync(savePath, JSON.stringify(state, null, 2));
        // El nombre de la cookie de sesión del wizard VARÍA por deploy: `__session` (build local, host-only)
        // vs `_session` (staging, @.creditop.com). No dependemos del nombre exacto para el diagnóstico.
        const sess = cookies.find((c) => /^_{1,2}session$/.test(c.name));
        console.log(`    ▸ cache Cognito: ${cookies.length} cookies · sesión: ${sess ? `sí ✅ (${sess.name})` : 'NO ⚠'} · en ${new URL(page.url()).pathname}`);
    } catch (e) {
        console.log(`    ⚠ no se pudo guardar el cache Cognito: ${e instanceof Error ? e.message : String(e)}`);
    }
}

import { test } from '@playwright/test';
import { config, cognitoCreds } from '../pkg/config';
import { cognitoLogin, persistCognitoState, cognitoStorageState, COGNITO_STATE_PATH } from '../pkg/cognito';
import { IPHONE_UA, openA } from '../pkg/windows';
import { TARGET } from '../pkg/env';

/**
 * warm-session — PRE-LOGIN dedicado. Loguea contra Cognito y deja el cache de sesión
 * (`.auth/cognito-state.<target>.json`) listo, SIN correr un flujo. Se corre UNA vez cuando el token
 * caducó (o no existe); a partir de ahí toda corrida arranca ya autenticada — sin login y, por lo tanto,
 * sin pasar por `/solicitar` (ese desvío solo aparece cuando hay que loguear; ver F-66).
 *
 * Lo dispara el panel (botón/dot de cada ambiente) en HEADLESS, con un loader "Autenticando…". Por eso
 * NO abre Inspector ni deja el browser abierto. Reusa el MISMO `cognitoLogin` + `persistCognitoState` del
 * flujo real, así el token es idéntico al que generaría una corrida normal.
 *
 * Carga el cache existente de entrada: si el refresh token de Cognito sigue vivo, el Hosted UI hace SSO
 * silencioso (no re-teclea user/pass) y esto es casi instantáneo; si murió, teclea las credenciales.
 *
 * OJO (local/dev): navega al FRONT del target (`config.feBaseUrl`); para `local`/`dev` ese front es el
 * `:5174`, que este spec NO levanta. Contra `staging` es el deploy (siempre disponible), que es el caso
 * de uso principal. Sin `:5174` arriba, el warm de local/dev falla con un mensaje claro.
 */
const HASH = process.env.E2E_ASESOR_HASH ?? config.partnerHash;

test.skip(
    !cognitoCreds.user || !cognitoCreds.pass,
    'warm-session: requiere credenciales Cognito (.cognito.json {user,pass} o E2E_COGNITO_USER/PASS)',
);

test('warm-session (pre-login)', async ({ browser }) => {
    test.setTimeout(120_000);
    // Reusa lo que haya en el cache: con el refresh token vivo, el login es SSO silencioso.
    // IPHONE_UA = el MISMO UA de las corridas, para que la sesión cacheada tenga el fingerprint de quien
    // la va a usar. OJO: se probó si el UA era la causa del cuelgue headless en staging y NO lo es — aun
    // con este UA, headless queda colgado en /verifyPassword (el Managed Login de `auth.merchant` corta la
    // automatización por fingerprint, no por UA). Por eso el panel corre el warm de staging HEADED. F-66.
    const { page } = await openA(browser, { baseURL: config.feBaseUrl, userAgent: IPHONE_UA, storageState: cognitoStorageState() });

    // Entrar a una ruta autenticada dispara el Hosted UI de Cognito (requireUser) si la sesión no vale.
    await page.goto(`/merchant/${HASH}/solicitar`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});

    // Login real (agnóstico al idioma) + settle del callback (deja la sesión asentada) + cacheo. Si NO hay
    // form (sesión ya válida por el cache) es no-op y NO guarda: por eso persistimos explícito abajo.
    await cognitoLogin(page);

    const url = page.url();
    const onCognito = /login\.creditop\.com|auth\.[\w.-]*creditop\.com|amazoncognito|[?&]client_id=/i.test(url);
    if (onCognito) {
        // Login no volvió al wizard: credenciales malas, o el pool metió MFA/captcha (que headless no resuelve).
        console.log(`WARM_FAIL ${TARGET} — seguimos en Cognito tras el login: ${url.slice(0, 120)}`);
        throw new Error('warm-session: el login no volvió al wizard (¿credenciales, o MFA/captcha en el pool?)');
    }

    // Garantiza el guardado incluso en el camino no-op de cognitoLogin (sesión ya viva): re-persiste desde
    // una página autenticada, donde `__session` existe con seguridad.
    await persistCognitoState(page);
    console.log(`WARM_OK ${TARGET} → cache en ${COGNITO_STATE_PATH} · aterrizó en ${new URL(url).pathname}`);
});

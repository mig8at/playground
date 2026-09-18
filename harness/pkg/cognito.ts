import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Cache POR POOL de Cognito, no ciegamente por target: `local` y `dev` comparten el pool
 * (login.creditop.com) Y el host del front (localhost:5174), así que comparten la sesión → `local` REUSA
 * el cache de `dev` (logueás una vez y sirve para los dos). `staging` es un pool DISTINTO
 * (auth.merchant.creditop.com) → cache propio; mezclarlo metería cookies/tokens del otro pool y el front
 * quedaría en un limbo (autenticado para Cognito, desconocido para el backend) sin que aparezca el login.
 */
/**
 * El POOL lo decide el FRONT, no el target. El wizard local (:5174) trae SU propia config de Cognito en
 * el `.env` del monorepo (`login.creditop.com`, su client_id), y `bin/asesor` solo le pisa las URLs de
 * API — así que una corrida con front local se autentica contra el pool de **dev** aunque el backend sea
 * el de staging. Por eso la clave sale del front: con `staging + front local` (el switch `CFE_FRONT`)
 * cachear como 'staging' hacía replayar cookies de otro origen y re-loguear con la cuenta del pool
 * equivocado — se veía como un login que se queda dando vueltas en `verifyPassword`.
 * Los tres casos previos no cambian: local y dev ya tenían front :5174 → 'dev'; staging con su front
 * desplegado → 'staging'.
 */
const FRONT_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(config.feBaseUrl);
const SESSION_KEY = FRONT_LOCAL ? 'dev' : TARGET;
export const COGNITO_STATE_PATH = `.auth/cognito-state.${SESSION_KEY}.json`;

/**
 * Cookies que NO son sesión y por lo tanto NO se cachean entre corridas.
 *
 * `oauth2:*` es el state CSRF efímero del handshake (ver `persistCognitoState`).
 *
 * ⚠ Y `merchant_context` es LA CAUSA DE «cambié de comercio y se quedó pegado el anterior». La escribe
 * el layout del wizard con `{merchant_id, merchant_slug, merchant_name, allied_branch_hash}` y vive
 * **24 h**; al quedar dentro del storageState, CADA corrida arrancaba restaurando el comercio de la
 * corrida anterior, así que reintentar no servía —el cache se volvía a poner solo—. Medido el
 * 2026-09-09: `.auth/cognito-state.qa.json` traía clavado
 * `{"merchant_id":337,"merchant_slug":"comercio-pruebas-bcp",...}` con 23,7 h por delante, y el de dev
 * traía Alta Fleet. No se pierde nada al sacarla: el layout la vuelve a escribir en la primera
 * navegación autenticada, y sin ella el contexto lo decide la URL y la sucursal del asesor, que es lo
 * correcto.
 */
const NO_CACHEABLES = /^(oauth2:|merchant_context$)/;

/**
 * Devuelve la ruta del storageState cacheado si existe (para `test.use({ storageState })`), o undefined.
 *
 * De paso lo SANEA: los archivos guardados antes de que existiera el filtro siguen trayendo cookies que
 * no son sesión, y un cache envenenado no se cura solo — se restaura igual en cada corrida. Sanear al
 * leer es lo que hace que el arreglo valga también para el cache que ya tenés en disco.
 */
export function cognitoStorageState(): string | undefined {
    if (!existsSync(COGNITO_STATE_PATH)) return undefined;
    try {
        const state = JSON.parse(readFileSync(COGNITO_STATE_PATH, 'utf8'));
        const antes = state.cookies?.length ?? 0;
        state.cookies = (state.cookies ?? []).filter((c: { name: string }) => !NO_CACHEABLES.test(c.name));
        if (state.cookies.length !== antes) {
            writeFileSync(COGNITO_STATE_PATH, JSON.stringify(state, null, 2));
            console.log(`    ▸ cache Cognito saneado: se sacaron ${antes - state.cookies.length} cookie(s) que no son sesión`);
        }
    } catch { /* best-effort: si el archivo está raro, que lo maneje Playwright como antes */ }
    return COGNITO_STATE_PATH;
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
        // Fuera del cache todo lo que NO es sesión (ver `NO_CACHEABLES`): el state CSRF del handshake
        // OAuth —que se acumulaba entre corridas, F-66— y el `merchant_context`, que hacía que cada
        // corrida arrancara con el comercio de la anterior.
        state.cookies = (state.cookies ?? []).filter((c) => !NO_CACHEABLES.test(c.name));
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

/**
 * ¿LA SESIÓN CACHEADA SIRVE, sin salir a preguntarle a nadie?
 *
 * POR QUÉ EXISTE. `cognitoStorageState()` sólo dice si el ARCHIVO está, no si la sesión vive. El
 * 2026-09-17 el canal de asesor arrancó con un archivo de hacía dos horas, cargó las cookies, pidió la
 * primera pantalla y **recién ahí** —40 s y 54 s después, un caso por vez— descubrió que el front lo
 * mandaba al login. La respuesta estaba en el archivo todo el tiempo: la cookie `_at` había vencido
 * hacía 170 minutos. Leerla cuesta 0 ms y no toca la red.
 *
 * ⚠ Mira el VENCIMIENTO, no la antigüedad del archivo. Un `mtime` reciente no dice nada —el saneo de
 * `cognitoStorageState` reescribe el archivo sin renovar nada— y uno viejo tampoco: `_rt` dura ~30 días.
 *
 * Lo que NO hace: renovar. El refresh lo hace la app con su propio handshake, y fingirlo desde acá sería
 * inventar un camino que ningún cliente recorre. Lo que sí hace es DECIRLO, para que el mensaje mande a
 * `dev/warm-session.spec.ts` sabiendo que hace falta.
 */
export interface SaludDeLaSesion {
    hay: boolean;
    ruta: string;
    /** `true` si las cookies que llevan la sesión siguen vivas. */
    sirve: boolean;
    /** Minutos que le quedan a la que vence primero, o `null` si no se pudo saber. */
    minutos: number | null;
    /**
     * `true` si la cookie del refresh token NO venció.
     *
     * ⚠ NO PROMETE QUE SE PUEDA RENOVAR, y la diferencia costó una hipótesis. La fecha de la cookie y
     * la validez del token son cosas distintas: el proveedor puede haberlo revocado o rotado y la
     * cookie sigue diciendo 30 días. Medido el 2026-09-17 contra qa — con `_rt` «vivo» por un mes, el
     * wizard intentó renovar, falló, y contestó `Set-Cookie: _at=; _rt=; Max-Age=0`, o sea borrando
     * la sesión. Esto dice «todavía hay de dónde intentarlo», no «va a funcionar».
     */
    renovable: boolean;
    /** Listo para imprimir. */
    motivo: string;
}

/**
 * Las cookies que LLEVAN la sesión, por nombre.
 *
 * `_at` es el token de acceso del wizard y `cognito` el del proveedor: si cualquiera de las dos venció,
 * la corrida termina en `/login` por más que el archivo esté. Las demás del archivo son idioma, CSRF,
 * analítica y el `post-auth` efímero del handshake — ninguna decide si hay sesión.
 */
const COOKIES_DE_SESION = new Set(['_at', 'cognito']);
/** El refresh token: no autentica por sí solo, pero dice si se puede recuperar sin clave. */
const COOKIE_DE_REFRESCO = '_rt';

export function saludDeLaSesion(): SaludDeLaSesion {
    const base = { ruta: COGNITO_STATE_PATH, minutos: null as number | null, renovable: false };
    if (!existsSync(COGNITO_STATE_PATH)) {
        return { ...base, hay: false, sirve: false, motivo: `no hay sesión cacheada en ${COGNITO_STATE_PATH}` };
    }

    let cookies: Array<{ name: string; expires?: number }> = [];
    try {
        cookies = JSON.parse(readFileSync(COGNITO_STATE_PATH, 'utf8')).cookies ?? [];
    } catch (e) {
        return { ...base, hay: true, sirve: false, motivo: `no pude leer ${COGNITO_STATE_PATH}: ${(e as Error).message}` };
    }

    return { ...saludDeCookies(cookies, COGNITO_STATE_PATH), ruta: COGNITO_STATE_PATH };
}

/**
 * La decisión, separada del archivo: se fija con pruebas sin tocar `.auth/` ni depender del target.
 * `ahoraSeg` existe para poder pararse en un instante y no depender del reloj de quien corre.
 */
export function saludDeCookies(
    cookies: Array<{ name: string; expires?: number }>,
    ruta = COGNITO_STATE_PATH,
    ahoraSeg = Date.now() / 1000,
): SaludDeLaSesion {
    const base = { hay: true, ruta, minutos: null as number | null };
    // Una cookie sin `expires` (o con -1) es «de sesión»: muere al cerrar el navegador, y en un
    // storageState replayado eso equivale a que no caduca. No se cuenta como vencida.
    const restan = (c: { expires?: number }) => (!c.expires || c.expires < 0 ? Infinity : (c.expires - ahoraSeg) / 60);
    const redondo = (m: number) => (Number.isFinite(m) ? Math.round(m) : null);

    const deSesion = cookies.filter((c) => COOKIES_DE_SESION.has(c.name));
    const refresco = cookies.find((c) => c.name === COOKIE_DE_REFRESCO);
    const renovable = !!refresco && restan(refresco) > 0;

    if (!deSesion.length) {
        return { ...base, sirve: false, renovable,
            motivo: `${ruta} no trae ninguna cookie de sesión (${[...COOKIES_DE_SESION].join(', ')}) — está incompleto` };
    }

    const vencidas = deSesion.filter((c) => restan(c) <= 0);
    const minutos = Math.min(...deSesion.map(restan));

    if (vencidas.length) {
        const cuanto = Math.round(-Math.min(...vencidas.map(restan)));
        return { ...base, sirve: false, minutos: redondo(minutos), renovable,
            motivo: `la sesión de ${ruta} venció hace ${cuanto} min (${vencidas.map((c) => c.name).join(', ')})`
                + (renovable
                    ? ' — la cookie del refresh no venció, pero eso NO garantiza que sirva: hay que volver a entrar igual'
                    : '') };
    }

    return { ...base, sirve: true, renovable, minutos: redondo(minutos),
        motivo: Number.isFinite(minutos) ? `sesión válida por ${Math.round(minutos)} min más` : 'sesión válida' };
}

/** El mensaje que un runner imprime cuando la sesión no sirve: el motivo, y qué hacer. */
export function comoRenovarLaSesion(s: SaludDeLaSesion): string {
    return `${s.motivo}\n     renovala con:  E2E_TARGET=${TARGET} npx playwright test dev/warm-session.spec.ts --headed --project=chromium`
        + `\n     (va HEADED a propósito contra qa/staging: el Managed Login corta la automatización por fingerprint — F-66)`;
}

/**
 * Renueva la sesión corriendo el pre-login, sin que nadie tenga que acordarse.
 *
 * ⚠ VA HEADED, y no es una preferencia: el Managed Login de `auth.merchant` corta la automatización
 * por fingerprint y en headless queda colgado en `/verifyPassword` (**F-66**). Así que esto ABRE UNA
 * VENTANA en la máquina de quien corre. Se avisa antes, porque una ventana que aparece sola sin
 * explicación se lee como que algo se rompió.
 *
 * ⚠ Y LA VENTANA ES CHICA AL LADO DEL OTRO PROBLEMA: el token de acceso vive ~4 minutos, así que
 * entre renovar y arrancar no puede haber nada. Por eso esto se llama desde el runner y no se le pide
 * a una persona que corra un comando y después otro — medido el 2026-09-17: la sesión recién acuñada
 * reportó «válida por 5 min».
 *
 * No renueva en `local` ni contra un front local: ahí el pre-login navega al `:5174`, que este
 * proceso no levanta, y el fallo sería más confuso que el problema.
 */
export async function renovarSesion(): Promise<{ ok: boolean; motivo: string }> {
    if (!cognitoCreds.user || !cognitoCreds.pass) {
        return { ok: false, motivo: 'no hay credenciales Cognito configuradas (.cognito.json o E2E_COGNITO_USER/PASS)' };
    }
    if (FRONT_LOCAL) {
        return { ok: false, motivo: 'el pre-login navega al front local (:5174), que esta corrida no levanta' };
    }

    const { spawn } = await import('node:child_process');
    const raiz = new URL('..', import.meta.url).pathname;

    const salio = await new Promise<number>((resolve) => {
        const p = spawn(
            'npx',
            ['playwright', 'test', 'dev/warm-session.spec.ts', '--headed', '--project=chromium'],
            { cwd: raiz, env: { ...process.env, E2E_TARGET: TARGET }, stdio: 'ignore' },
        );
        p.on('close', (code) => resolve(code ?? 1));
        p.on('error', () => resolve(1));
    });

    if (salio !== 0) return { ok: false, motivo: `el pre-login salió con código ${salio}` };

    const despues = saludDeLaSesion();
    return despues.sirve
        ? { ok: true, motivo: despues.motivo }
        : { ok: false, motivo: `el pre-login corrió pero la sesión sigue sin servir: ${despues.motivo}` };
}

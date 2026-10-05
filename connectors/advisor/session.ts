import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsFor } from '../auth/env.ts';
import { launchChrome, type Page } from '../auth/browser.ts';
import { advisorTarget, sessionPath, readSession, writeSession, cookieHeaderFor, probeSession, isLoginRedirect, MissingCredentials, type StoredCookie, type StoredSession, type SignInOptions } from '../auth/sessions.ts';
import { loginOnPage } from './login.ts';
import { cookiesHealth, type SessionHealth } from './health.ts';
export { cookiesHealth, type SessionHealth } from './health.ts';
export const NO_CACHEABLES = /^(oauth2:|merchant_context$)/;

/** Una instancia por ambiente de autenticación y origen del front, independiente del backend de la corrida. */
export function advisorSession(target: string, origin: string) {
    const config = { feBaseUrl: new URL(origin).origin };
    const authTarget = advisorTarget(target, config.feBaseUrl);
    const COGNITO_STATE_PATH = sessionPath('advisor', authTarget, config.feBaseUrl);
    const read = () => readSession('advisor', authTarget, config.feBaseUrl);
    function storageState(): string | undefined {
        const s = read();
        if (!s) return undefined;
        const cookies = s.cookies.filter(c => !NO_CACHEABLES.test(c.name));
        if (cookies.length !== s.cookies.length) writeSession({ ...s, cookies });
        return COGNITO_STATE_PATH;
    }
    function sessionHealth(): SessionHealth {
        const s = read();
        if (!s) return { hay: false, ruta: COGNITO_STATE_PATH, sirve: false, minutos: null, renovable: false, motivo: 'no hay sesión de asesor para este origen y cuenta; entra con bin/pg advisor login' };
        return cookiesHealth(s.cookies, COGNITO_STATE_PATH);
    }
    async function persist(page: Page, savePath: string | null = COGNITO_STATE_PATH, user?: string): Promise<void> {
        if (!savePath) return;
        if (new URL(page.url()).origin !== config.feBaseUrl) throw new Error('no se guarda una sesión fuera del front esperado');
        const previous = read();
        const identity = user || previous?.user;
        // Sólo una entrada real o una sesión ya atribuida permiten persistir.
        if (!identity) throw new Error('no se guarda una sesión sin saber qué cuenta entró');
        const state = await page.context().storageState();
        const s: StoredSession = { version: 1, kind: 'advisor', target: authTarget, origin: config.feBaseUrl,
            user: identity, who: previous?.user === identity ? previous.who : null,
            createdAt: previous?.user === identity ? previous.createdAt : new Date().toISOString(),
            cookies: state.cookies.filter(c => !NO_CACHEABLES.test(c.name)), origins: state.origins };
        if (savePath === COGNITO_STATE_PATH) writeSession(s);
        else { // compatibilidad con una captura explícita; nunca se descubre ni reusa como sesión compartida
            mkdirSync(dirname(savePath), { recursive: true, mode: 0o700 });
            writeFileSync(savePath, JSON.stringify(s, null, 2), { mode: 0o600 }); chmodSync(savePath, 0o600);
        }
    }
    async function login(page: Page, user?: string, pass?: string, returnHost = new URL(config.feBaseUrl).host, savePath: string | null = COGNITO_STATE_PATH): Promise<void> {
        const creds = credentialsFor('advisor', authTarget);
        const account = user ?? creds?.user;
        const loggedIn = await loginOnPage(page, account ?? '', pass ?? creds?.pass ?? '', returnHost);
        if (loggedIn) await persist(page, savePath, account);
    }
    async function signIn(opts: SignInOptions = {}) {
        const creds = credentialsFor('advisor', authTarget);
        if (!creds) throw new MissingCredentials(`faltan ADVISOR_USER y ADVISOR_PASS en connectors/.env.${authTarget}`);
        const browser = await launchChrome((opts.headless ?? false) && authTarget !== 'qa' && authTarget !== 'staging');
        try {
            const context = await browser.newContext({ baseURL: config.feBaseUrl });
            const page = await context.newPage();
            await page.goto('/merchant', { waitUntil: 'domcontentloaded', timeout: 60_000 });
            if (!await loginOnPage(page, creds.user, creds.pass, new URL(config.feBaseUrl).host)) throw new Error('no hubo login; no se puede atribuir esta sesión');
            const state = await context.storageState();
            const session: StoredSession = { version: 1, kind: 'advisor', target: authTarget, user: creds.user, who: null,
                origin: config.feBaseUrl, createdAt: new Date().toISOString(),
                cookies: state.cookies.filter(c => !NO_CACHEABLES.test(c.name)), origins: state.origins };
            const probe = await probeSession(session);
            if (probe.valid !== true) throw new Error(`no se confirmó la sesión: ${probe.motivo}`);
            session.who = probe.who;
            return { session, path: writeSession(session), who: session.who };
        } finally { await browser.close(); }
    }
async function refreshSession(opts: { repin?: boolean } = {}): Promise<{ ok: boolean; motivo: string; sucursal: string | null }> {
    const fail = (motivo: string) => ({ ok: false, motivo, sucursal: null as string | null });
    if (!read()) return fail(`no hay sesión cacheada en ${COGNITO_STATE_PATH}`);

    let state: StoredSession;
    let host: string;
    try {
        state = read()!;
        host = new URL(config.feBaseUrl).hostname;
    } catch (e) {
        return fail(`no pude leer la sesión: ${(e as Error).message}`);
    }
    // `repin`: la SUCURSAL del asesor viaja fijada en `_session` y sólo se vuelve a leer cuando el handshake
    // acuña un `_at` nuevo (medido en local el 2026-09-29: con el `_at` vigente, cambiar la asignación en la
    // base no movía la sesión —seguía redirigiendo a la sucursal anterior—; sin el `_at`, la app lo renovó
    // con el `_rt` y ya redirigió a la nueva). O sea que reasignar al asesor NO obliga a volver a entrar: se
    // le quita el `_at` a la copia con la que se pregunta. Si el front rebota al login, no se toca el archivo.
    const original = JSON.stringify(state);
    const cookies = (state.cookies ?? []).filter((c) => !(opts.repin && c.name === '_at'));
    const header = cookieHeaderFor(cookies, `${config.feBaseUrl}/merchant`);
    if (!header) return fail('el cache no tiene cookies para el front de este target');

    let r: Response;
    try {
        r = await fetch(`${config.feBaseUrl.replace(/\/$/, '')}/merchant`, {
            headers: { cookie: header, 'user-agent': 'harness-refresh', accept: 'text/html' },
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
    } catch (e) {
        return fail(`el front no respondió: ${(e as Error).message}`);
    }

    const loc = r.headers.get('location') || '';
    if (isLoginRedirect(loc)) {
        // Medido el 2026-09-29: en qa la renovación sin clave sólo alcanza mientras vive la cookie `cognito`
        // (la sesión del login alojado, ~1 h desde que se entró): con `_rt` vigente por 30 días y esa cookie
        // vencida, el front igual rebota al login. En dev/local sí alcanza con `_rt`.
        const hosted = cookies.find((c) => c.name === 'cognito');
        const hostedExpired = !!hosted && typeof hosted.expires === 'number' && hosted.expires > 0 && hosted.expires < Date.now() / 1000;
        return fail('el front rebota al login: la sesión no se puede renovar sin clave, hay que entrar de nuevo'
            + (hostedExpired ? ' (la cookie `cognito` del login alojado ya venció: en este ambiente la renovación sin clave dura ~1 h desde el último login)' : ''));
    }
    if (r.status < 200 || r.status >= 400) return fail(`el front contestó HTTP ${r.status}`);

    // Set-Cookie → cookies de Playwright. Se saltan las que BORRAN (valor vacío, Max-Age<=0, Expires pasado).
    const now = Date.now() / 1000;
    let merged = 0;
    for (const raw of r.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = raw.split(';').map((x) => x.trim());
        const eq = pair.indexOf('=');
        if (eq < 1) continue;
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const a: Record<string, string> = {};
        for (const at of attrs) { const i = at.indexOf('='); a[(i < 0 ? at : at.slice(0, i)).toLowerCase()] = i < 0 ? '' : at.slice(i + 1); }
        let expires = -1;
        if (a['max-age'] !== undefined) expires = now + Number(a['max-age']);
        else if (a['expires']) { const t = Date.parse(a['expires']); if (!Number.isNaN(t)) expires = t / 1000; }
        if (!value || (expires !== -1 && expires <= now)) continue;
        if (NO_CACHEABLES.test(name)) continue;

        const domain = a['domain'] ? (a['domain'].startsWith('.') ? a['domain'] : '.' + a['domain']) : host;
        const path = a['path'] || '/';
        const same = (c: StoredCookie) => c.name === name && String(c.domain).replace(/^\./, '') === domain.replace(/^\./, '') && (c.path || '/') === path;
        const next: StoredCookie = {
            name, value, domain, path, expires,
            httpOnly: 'httponly' in a, secure: 'secure' in a,
            sameSite: /^strict$/i.test(a['samesite'] ?? '') ? 'Strict' : /^none$/i.test(a['samesite'] ?? '') ? 'None' : 'Lax',
        };
        const at = cookies.findIndex(same);
        if (at >= 0) cookies[at] = { ...cookies[at], ...next }; else cookies.push(next);
        merged += 1;
    }
    if (merged === 0) {
        // El front dejó pasar y no hubo nada que renovar: si la sesión que ya estaba sirve, eso ES un éxito.
        const health = sessionHealth();
        return { ok: health.sirve, motivo: health.sirve ? `ya estaba fresca · ${health.motivo}` : 'el front dejó pasar pero no renovó ninguna cookie y la sesión sigue sin servir (¿el handshake cambió?)', sucursal: /\/merchant\/([0-9a-f]{8})/.exec(loc)?.[1] ?? null };
    }

    const current = read();
    if (!current || JSON.stringify(current) !== original) return fail('la sesión cambió o se cerró durante la renovación; no se sobrescribe');
    state.cookies = cookies;
    if (opts.repin && !cookies.some(c => c.name === '_at')) {
        const previous = read()?.cookies.find(c => c.name === '_at');
        if (previous) state.cookies.push(previous);
    }
    writeSession(state);
    const after = sessionHealth();
    return {
        ok: after.sirve,
        motivo: after.sirve ? `renovada sin clave (${merged} cookie(s)) · ${after.motivo}` : `renové ${merged} cookie(s) pero la sesión sigue sin servir: ${after.motivo}`,
        sucursal: /\/merchant\/([0-9a-f]{8})/.exec(loc)?.[1] ?? null,
    };
}


    async function renewSession(): Promise<{ ok: boolean; motivo: string }> {
        try { await signIn(); const after = sessionHealth(); return { ok: after.sirve, motivo: after.motivo }; }
        catch (e) { return { ok: false, motivo: (e as Error).message }; }
    }
    return { path: COGNITO_STATE_PATH, storageState, persist, login, sessionHealth, refreshSession, renewSession, signIn };
}

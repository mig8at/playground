import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialKeys, credentialsFor, type CredentialKind } from './connector-env.ts';

/**
 * Las SESIONES de login del ASESOR del wizard (Cognito), y el formato en disco que comparten con el conector del admin.
 *
 * POR QUÉ EXISTE. El login estaba desperdigado: `.admin.json`, `.cognito.json`, variables `E2E_*`, un perfil de navegador por
 * ambiente y un cache de Cognito aparte. Cada herramienta lo resolvía a su manera, y el 2026-10-02 eso costó que la sesión «de
 * dev» fuera la de otra persona sin que nadie lo viera. Acá hay UNA forma: las credenciales salen de `connectors/`
 * (`pkg/connector-env.ts`), el login lo hace Chrome por debajo, y lo que queda guardado dice QUIÉN es.
 *
 * EL ADMIN YA NO ES DE ESTE MÓDULO: lo maneja el conector `admin` (`bin/pg admin …`, en Go, por HTTP y sin navegador). Acá sólo se
 * LEE su archivo de sesión (`readSession('admin', …)`, que usa `dev/open-admin.ts` para abrir una ventana ya logueada): el formato
 * en disco es el mismo para los dos lados.
 *
 * LAS FRONTERAS:
 *  · Entrar con usuario y contraseña lo corre una persona (`make harness-signin`). Lo guardado después lo usan las herramientas
 *    —y quien las maneja— sin volver a pedir nada.
 *  · Ningún valor de sesión se imprime: `status` muestra quién, de cuándo y si sirve, nunca la cookie.
 *  · Producción no se toca.
 *
 * Se guarda en `.auth/sessions/` (fuera de git, permisos 600): `<tipo>-<ambiente>.json`; para el asesor lleva además el
 * host del wizard, porque el wizard local y el desplegado de un mismo ambiente no comparten cookies.
 */

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SESSIONS_DIR = join(HARNESS, '.auth', 'sessions');

export type SessionKind = CredentialKind;

export interface StoredCookie {
    name: string; value: string; domain: string; path: string;
    expires: number; httpOnly: boolean; secure: boolean; sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface StoredSession {
    version: 1;
    kind: SessionKind;
    target: string;
    /** Con qué cuenta se entró (el correo). */
    user: string;
    /** El nombre que mostró la app al entrar (por ejemplo «MIGUEL OCHOA»), si se pudo leer. */
    who: string | null;
    /** El host al que pertenecen las cookies. */
    origin: string;
    createdAt: string;
    cookies: StoredCookie[];
}

/** Los admin de cada ambiente: sólo para ubicar el archivo de sesión que guarda el conector (que es quien los maneja). */
const ADMIN_ORIGINS: Record<string, string> = {
    local: 'http://admin.localhost:8000', dev: 'https://admin.dev.creditop.com', staging: 'https://admin.staging.creditop.com',
};

/** Dónde vive el wizard (o el admin) de cada ambiente: el origen al que pertenece la sesión. */
export function defaultOrigin(kind: SessionKind, target: string): string {
    if (kind === 'admin') {
        const base = ADMIN_ORIGINS[target];
        if (!base) throw new Error(adminTargetError(target));
        return base;
    }
    const fronts: Record<string, string> = {
        local: 'http://localhost:5174', dev: 'http://localhost:5174',
        qa: 'https://originaciones-qa.dev.creditop.com', staging: 'https://originaciones-stg.dev.creditop.com',
    };
    const front = fronts[target];
    if (!front) throw new Error(`no conozco el wizard de «${target}». Los que hay: ${Object.keys(fronts).join(', ')}`);
    return front;
}

function adminTargetError(target: string): string {
    if (/^prod/.test(target)) return 'producción es sólo lectura: no se guardan sesiones de ahí';
    if (target === 'qa') return 'qa no tiene admin propio: comparte la base con dev (usa dev)';
    return `no conozco el admin de «${target}». Los que hay: ${Object.keys(ADMIN_ORIGINS).join(', ')}`;
}

/** El nombre del archivo. Pura. El asesor lleva el host: localhost y el desplegado de dev no comparten cookies. */
export function sessionFile(kind: SessionKind, target: string, origin: string): string {
    if (kind === 'admin') return `${kind}-${target}.json`;
    const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, '_');
    return `${kind}-${target}-${host}.json`;
}

export const sessionPath = (kind: SessionKind, target: string, origin = defaultOrigin(kind, target)) =>
    join(SESSIONS_DIR, sessionFile(kind, target, origin));

export function readSession(kind: SessionKind, target: string, origin = defaultOrigin(kind, target)): StoredSession | null {
    const path = sessionPath(kind, target, origin);
    if (!existsSync(path)) return null;
    try {
        const s = JSON.parse(readFileSync(path, 'utf8')) as StoredSession;
        return s.version === 1 && Array.isArray(s.cookies) ? s : null;
    } catch {
        return null;
    }
}

export function writeSession(s: StoredSession): string {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    try { chmodSync(SESSIONS_DIR, 0o700); } catch { /* best-effort */ }
    const path = sessionPath(s.kind, s.target, s.origin);
    writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best-effort */ }
    return path;
}

export function removeSession(kind: SessionKind, target: string, origin = defaultOrigin(kind, target)): boolean {
    const path = sessionPath(kind, target, origin);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
}

/** Todas las sesiones guardadas, sin probarlas. */
export function listSessions(): StoredSession[] {
    if (!existsSync(SESSIONS_DIR)) return [];
    const out: StoredSession[] = [];
    for (const f of readdirSync(SESSIONS_DIR).filter((n) => n.endsWith('.json')).sort()) {
        try {
            const s = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf8')) as StoredSession;
            if (s.version === 1) out.push(s);
        } catch { /* archivo roto: se ignora */ }
    }
    return out;
}

/** El header `Cookie` para pedirle algo a `url`, con las cookies de la sesión que le aplican. Pura. */
export function cookieHeaderFor(cookies: StoredCookie[], url: string, nowSec = Date.now() / 1000): string {
    const u = new URL(url);
    return cookies
        .filter((c) => {
            const d = c.domain.replace(/^\./, '');
            if (!(u.hostname === d || u.hostname.endsWith(`.${d}`))) return false;
            if (c.secure && u.protocol !== 'https:' && u.hostname !== 'localhost' && !u.hostname.endsWith('.localhost')) return false;
            if (!u.pathname.startsWith(c.path || '/')) return false;
            return !(c.expires > 0 && c.expires < nowSec);
        })
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
}

// ── ¿la sesión sirve? ───────────────────────────────────────────────────────────────────────────────

export interface SessionStatus {
    kind: SessionKind; target: string; origin: string;
    exists: boolean;
    user: string | null; who: string | null; createdAt: string | null;
    /** `true` sirve · `false` no sirve · `null` no se pudo saber (el servidor no contestó). */
    valid: boolean | null;
    motivo: string;
}

/** Le pregunta al servidor si la sesión del ASESOR sigue viva: una petición a una ruta protegida, sin seguir redirecciones. */
export async function probeSession(s: StoredSession): Promise<{ valid: boolean | null; who: string | null; motivo: string }> {
    const url = `${s.origin}/merchant`;
    let res: Response;
    try {
        res = await fetch(url, {
            redirect: 'manual', signal: AbortSignal.timeout(20_000),
            headers: { cookie: cookieHeaderFor(s.cookies, url), accept: 'text/html', 'user-agent': 'harness-sessions' },
        });
    } catch (e) {
        return { valid: null, who: null, motivo: `${s.origin} no contestó: ${(e as Error).message.split('\n')[0].slice(0, 80)}` };
    }
    const loc = res.headers.get('location') ?? '';
    if (res.status >= 300 && res.status < 400 && /\/login|amazoncognito|auth\.merchant|[?&]client_id=/i.test(loc)) {
        return { valid: false, who: null, motivo: 'el servidor manda al login: la sesión venció' };
    }
    if (res.status >= 400) return { valid: false, who: null, motivo: `el servidor contestó HTTP ${res.status}` };
    return { valid: true, who: null, motivo: 'sirve' };
}

export async function sessionStatus(kind: SessionKind, target: string, origin?: string): Promise<SessionStatus> {
    let org: string;
    try { org = origin ?? defaultOrigin(kind, target); } catch (e) {
        return { kind, target, origin: '—', exists: false, user: null, who: null, createdAt: null, valid: null, motivo: (e as Error).message };
    }
    const s = readSession(kind, target, org);
    if (!s) return { kind, target, origin: org, exists: false, user: null, who: null, createdAt: null, valid: null, motivo: 'no hay sesión guardada' };
    const p = await probeSession(s);
    return { kind, target, origin: org, exists: true, user: s.user, who: p.who ?? s.who, createdAt: s.createdAt, valid: p.valid, motivo: p.motivo };
}

// ── entrar ──────────────────────────────────────────────────────────────────────────────────────────

/** Abre Chrome de verdad si está instalado (el Managed Login desconfía de un Chromium pelado); si no, el de Playwright. */
async function launchChrome(headless: boolean) {
    const { chromium } = await import('@playwright/test');
    try {
        return await chromium.launch({ channel: 'chrome', headless });
    } catch {
        return chromium.launch({ headless });
    }
}

function toStored(c: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: string }): StoredCookie {
    return { name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite as StoredCookie['sameSite'] };
}

export interface SignInOptions {
    /** Sin ventana. El Managed Login de qa y staging la exige (F-66): ahí se ignora. */
    headless?: boolean;
    /** El wizard al que pertenece la sesión del asesor (por defecto, el del ambiente). */
    origin?: string;
}

export class MissingCredentials extends Error {}

/** Entra al wizard como asesor (Cognito). Reusa el mismo paso de login que la sonda: clásico o de dos pasos. */
async function signInAdvisor(target: string, opts: SignInOptions): Promise<StoredSession> {
    const origin = opts.origin ?? defaultOrigin('advisor', target);
    const creds = credentialsFor('advisor', target);
    if (!creds) {
        const k = credentialKeys('advisor');
        throw new MissingCredentials(`faltan las credenciales del asesor de ${target}: pon ${k.user} y ${k.pass} en connectors/.env.${target}`);
    }
    // El Managed Login de qa y staging corta la automatización sin ventana (F-66).
    const mustShowWindow = target === 'qa' || target === 'staging';
    const browser = await launchChrome((opts.headless ?? true) && !mustShowWindow);
    try {
        const context = await browser.newContext({ baseURL: origin });
        const page = await context.newPage();
        await page.goto('/merchant', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => { /* lo decide la URL */ });
        const { loginOnPage } = await import('./login-probe.ts');
        await loginOnPage(page, creds.user, creds.pass, new URL(origin).host);
        const host = new URL(origin).hostname;
        const cookies = (await context.cookies()).filter((c) => host === c.domain.replace(/^\./, '') || host.endsWith(`.${c.domain.replace(/^\./, '')}`)).map(toStored);
        if (!cookies.length) throw new Error('el login terminó pero no quedaron cookies de la app');
        return { version: 1, kind: 'advisor', target, user: creds.user, who: null, origin, createdAt: new Date().toISOString(), cookies };
    } finally {
        await browser.close().catch(() => { /* ya cerrado */ });
    }
}

/**
 * Entra y GUARDA la sesión. Devuelve lo guardado (sin imprimir nada secreto). Comprueba que sirva antes de dar por buena la entrada.
 */
export async function signIn(kind: SessionKind, target: string, opts: SignInOptions = {}): Promise<{ session: StoredSession; path: string; who: string | null }> {
    if (/^prod/.test(target)) throw new Error('producción es sólo lectura: no se guardan sesiones de ahí');
    if (kind === 'admin') throw new Error('el admin lo maneja el conector: bin/pg admin login --target ' + target);
    const session = await signInAdvisor(target, opts);
    const probe = await probeSession(session);
    if (probe.valid === false) throw new Error(`entré pero la sesión no sirve: ${probe.motivo}`);
    session.who = probe.who;
    return { session, path: writeSession(session), who: probe.who };
}

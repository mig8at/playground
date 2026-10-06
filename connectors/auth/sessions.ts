import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialsFor, type CredentialKind } from './env.ts';
import { createHash, randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';

/** Único almacenamiento de sesiones de admin y asesor. Compatible con storageState de Playwright. */
export const SESSIONS_DIR = fileURLToPath(new URL('../.auth/sessions/', import.meta.url));

/** El front local conocido usa el pool dev; un pool local distinto se declara explícitamente. */
export function advisorTarget(target: string, origin: string): string {
    defaultOrigin('advisor', target); // rechaza producción y ambientes desconocidos
    const url = new URL(origin);
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === '5174') {
        const authTarget = process.env.ADVISOR_AUTH_TARGET || 'dev';
        defaultOrigin('advisor', authTarget);
        return authTarget;
    }
    return target === 'local' ? 'dev' : target;
}

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
    /** Estado del navegador; admin puede omitirlo. */
    origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
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

/** Separa esquema, host y puerto: dos fronts en localhost no pueden compartir estado accidentalmente.
 *  Con `account` (el asesor de prueba de un comercio, `c<hash>-fake@…`) la sesión es de ESA cuenta: cada
 *  comercio tiene la suya y entrar con uno no pisa la del otro. Sin `account`, la de la persona de siempre. */
export function sessionFile(kind: SessionKind, target: string, origin: string, account?: string): string {
    if (kind === 'admin') { defaultOrigin(kind, target); return `admin-${target}.json`; }
    const org = new URL(origin).origin;
    const t = advisorTarget(target, org);
    const host = new URL(org).host.replace(/[^a-z0-9.-]/gi, '_');
    const hash = createHash('sha256').update(org).digest('hex').slice(0, 12);
    const who = account ? '-' + createHash('sha256').update(account.toLowerCase()).digest('hex').slice(0, 10) : '';
    return `advisor-${t}-${host}-${hash}${who}.json`;
}

export const sessionPath = (kind: SessionKind, target: string, origin = defaultOrigin(kind, target), account?: string) =>
    join(SESSIONS_DIR, sessionFile(kind, target, origin, account));

export function matchesSession(s: StoredSession, kind: SessionKind, target: string, origin: string, account?: string): boolean {
    const t = kind === 'advisor' ? advisorTarget(target, origin) : target;
    const user = account ?? credentialsFor(kind, t)?.user;
    return s?.version === 1 && s.kind === kind && s.target === t && s.origin === new URL(origin).origin
        && typeof s.user === 'string' && !!s.user && Array.isArray(s.cookies)
        && (!user || kind === 'admin' && target === 'local' || s.user.toLowerCase() === user.toLowerCase());
}

export function readSession(kind: SessionKind, target: string, origin = defaultOrigin(kind, target), account?: string): StoredSession | null {
    const path = sessionPath(kind, target, origin, account);
    if (!existsSync(path)) return null;
    try {
        const s = JSON.parse(readFileSync(path, 'utf8')) as StoredSession;
        return matchesSession(s, kind, target, origin, account) ? s : null;
    } catch { return null; }
}

/** Reemplazo atómico: permisos privados incluso si ya existía el archivo. */
export function writeSession(s: StoredSession, account?: string): string {
    if (s.kind === 'admin') throw new Error('admin lo guarda bin/pg admin login');
    const path = sessionPath(s.kind, s.target, s.origin, account);
    if (!matchesSession(s, s.kind, s.target, s.origin, account)) throw new Error('la sesión no coincide con ambiente, origen o cuenta configurada');
    mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    chmodSync(SESSIONS_DIR, 0o700);
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
        writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
        renameSync(tmp, path);
    } finally { rmSync(tmp, { force: true }); }
    return path;
}

export function removeSession(kind: SessionKind, target: string, origin = defaultOrigin(kind, target), account?: string): boolean {
    if (kind === 'admin') throw new Error('admin se cierra con bin/pg admin logout');
    const path = sessionPath(kind, target, origin, account);
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
            const p = c.path || '/';
            if (!(u.pathname === p || u.pathname.startsWith(p.endsWith('/') ? p : p + '/'))) return false;
            return !(c.expires > 0 && c.expires <= nowSec);
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
    if (s.kind === 'admin') return { valid: null, who: null, motivo: 'usa bin/pg admin status' };
    const url = `${s.origin}/merchant`;
    let res: Response;
    try {
        res = await fetch(url, {
            redirect: 'manual', signal: AbortSignal.timeout(15_000),
            headers: { cookie: cookieHeaderFor(s.cookies, url), accept: 'text/html', 'user-agent': 'harness-sessions' },
        });
    } catch (e) {
        return { valid: null, who: null, motivo: `${s.origin} no contestó: ${(e as Error).message.split('\n')[0].slice(0, 80)}` };
    }
    const loc = res.headers.get('location') ?? '';
    if (res.status >= 300 && res.status < 400 && isLoginRedirect(loc)) {
        return { valid: false, who: null, motivo: 'el servidor manda al login: la sesión venció' };
    }
    if (res.status >= 400) return { valid: res.status === 401 || res.status === 403 ? false : null, who: null, motivo: `el servidor contestó HTTP ${res.status}` };
    return { valid: true, who: null, motivo: 'sirve' };
}

export async function sessionStatus(kind: SessionKind, target: string, origin?: string, account?: string): Promise<SessionStatus> {
    let org: string;
    try { org = origin ?? defaultOrigin(kind, target); } catch (e) {
        return { kind, target, origin: '—', exists: false, user: null, who: null, createdAt: null, valid: null, motivo: (e as Error).message };
    }
    const s = readSession(kind, target, org, account);
    if (!s) return { kind, target, origin: org, exists: false, user: null, who: null, createdAt: null, valid: null, motivo: 'no hay sesión guardada' };
    const p = await probeSession(s);
    return { kind, target, origin: org, exists: true, user: s.user, who: p.who ?? s.who, createdAt: s.createdAt, valid: p.valid, motivo: p.motivo };
}


export function isLoginRedirect(location: string): boolean {
    return /login\.creditop\.com|auth\.[\w.-]*creditop\.com|amazoncognito|\/login(?:[/?#]|$)|[?&]client_id=/i.test(location);
}
export class MissingCredentials extends Error {}
export interface SignInOptions { headless?: boolean; origin?: string }
export async function signIn(kind: SessionKind, target: string, opts: SignInOptions = {}) {
    if (kind === 'admin') throw new Error(`el admin lo maneja bin/pg admin login --target ${target}`);
    const { advisorSession } = await import('../advisor/session.ts');
    return advisorSession(target, opts.origin ?? defaultOrigin(kind, target)).signIn(opts);
}

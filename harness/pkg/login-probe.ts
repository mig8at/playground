import type { Browser, Page } from '@playwright/test';
import { cookiesHealth } from './cognito.ts';
import { config } from './config.ts';
import { query } from './db.ts';
import { TARGET } from './env.ts';
import { IPHONE_UA, openA } from './windows.ts';

/**
 * ¿El asesor de prueba de un comercio ENTRA al wizard en este ambiente?
 *
 * POR QUÉ EXISTE. Al crear un comercio desde el admin se crean una sucursal y un asesor de prueba
 * (`c{hash}-fake@…`) con su cuenta en el pool de Cognito. Que la fila exista y que `cognito_id` esté lleno
 * no prueba que esa persona pueda ENTRAR: el wizard de cada ambiente se autentica contra un pool y un
 * cliente propios, y la cuenta puede estar en otro. Esta sonda responde con una entrada real.
 *
 * Todo en `pkg/cognito.ts` se resuelve UNA vez al importar, según `E2E_TARGET`. Por eso esta sonda sirve
 * para el ambiente del proceso, y para recorrer varios hay que lanzar un proceso por ambiente
 * (`dev/login-check.ts`), como hace el runner.
 *
 * ⚠ NO TOCA LA SESIÓN CACHEADA. El cache `connectors/.auth/sessions/` es de la cuenta de trabajo del
 * harness; entrar con un asesor de prueba y guardarlo ahí dejaría a las corridas siguientes operando como
 * otra persona, en otra sucursal. Se entra con un contexto limpio y no se guarda nada.
 */

/** Cómo se reconoce al asesor de prueba: el mismo patrón con que lo crea el admin de legacy-application. */
export const TEST_ADVISOR_EMAIL = /^c[0-9a-f]+-fake@/i;

/** A dónde mandó el front al pedir una ruta protegida sin sesión: el login alojado de Cognito. */
export interface HostedUi {
    /** Host del login (`login.creditop.com`, `auth.merchant.creditop.com`…). */
    host: string;
    /** El `client_id` del front: identifica la APLICACIÓN dentro del pool. No es un secreto. */
    clientId: string;
    /** Host al que vuelve tras el callback. */
    redirectHost: string;
}

/** Saca el login alojado de la URL de autorización. `null` si la URL no es de un login de Cognito. */
export function parseHostedUi(location: string): HostedUi | null {
    let url: URL;
    try { url = new URL(location); } catch { return null; }
    const clientId = url.searchParams.get('client_id');
    if (!clientId) return null;
    let redirectHost = '';
    try { redirectHost = new URL(url.searchParams.get('redirect_uri') ?? '').host; } catch { /* sin redirect_uri */ }
    return { host: url.host, clientId, redirectHost };
}

/**
 * ¿A qué login manda este front? Sin clave y sin navegador: pide una ruta protegida y sigue los redirects
 * a mano hasta que uno salga a un host con `client_id`. Es la pregunta que más cambia el diagnóstico —un
 * asesor puede existir en un pool y el wizard del ambiente autenticar contra otro— y no cuesta un login.
 */
export async function discoverHostedUi(frontUrl: string, maxHops = 5): Promise<{ hosted: HostedUi | null; motivo: string }> {
    let url = `${frontUrl.replace(/\/$/, '')}/merchant`;
    for (let hop = 0; hop < maxHops; hop += 1) {
        let r: Response;
        try {
            r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'harness-login-probe', accept: 'text/html' }, signal: AbortSignal.timeout(15_000) });
        } catch (e) {
            return { hosted: null, motivo: `el front no respondió (${url}): ${(e as Error).message}` };
        }
        const loc = r.headers.get('location');
        if (!loc) return { hosted: null, motivo: `el front contestó HTTP ${r.status} sin redirigir al login` };
        const next = new URL(loc, url).toString();
        const hosted = parseHostedUi(next);
        if (hosted) return { hosted, motivo: 'ok' };
        url = next;
    }
    return { hosted: null, motivo: `no llegó a un login de Cognito en ${maxHops} redirecciones` };
}

export interface TestAdvisor {
    id: number;
    email: string;
    alliedId: number;
    branchId: number | null;
    /** Hash de la sucursal, que es el que aparece en la URL del wizard (`/merchant/<hash>`). */
    branchHash: string | null;
    /** ¿la fila tiene `cognito_id`? Sin él el backend no reconoce a quien entre. */
    hasSub: boolean;
}

/** El asesor de prueba de un comercio, leído de la base del ambiente. `null` si no tiene. */
export async function findTestAdvisor(alliedId: number): Promise<TestAdvisor | null> {
    const rows = await query<{ id: number; email: string; allied_id: number; allied_branch_id: number | null; branch_hash: string | null; sub: number }>(
        `SELECT u.id, u.email, u.allied_id, u.allied_branch_id, b.hash AS branch_hash, (u.cognito_id IS NOT NULL) AS sub
           FROM users u LEFT JOIN allied_branches b ON b.id = u.allied_branch_id
          WHERE u.allied_id = ? AND u.email LIKE 'c%-fake@%'
          ORDER BY u.id DESC`,
        [alliedId],
    );
    const row = rows.find((r) => TEST_ADVISOR_EMAIL.test(r.email));
    return row
        ? { id: row.id, email: row.email, alliedId: row.allied_id, branchId: row.allied_branch_id, branchHash: row.branch_hash, hasSub: !!row.sub }
        : null;
}

/**
 * El asesor de prueba MÁS RECIENTE del ambiente: para probar «el comercio que acabo de crear» sin buscar su id.
 * Se ordena por la fila del usuario (el id crece con cada alta), no por la fecha del comercio.
 */
export async function latestTestAdvisor(): Promise<TestAdvisor | null> {
    const rows = await query<{ allied_id: number | null }>(
        `SELECT u.allied_id FROM users u
          WHERE u.email LIKE 'c%-fake@%' AND u.allied_id IS NOT NULL
          ORDER BY u.id DESC LIMIT 20`,
    );
    for (const r of rows) {
        if (r.allied_id === null) continue;
        const found = await findTestAdvisor(r.allied_id);
        if (found) return found;
    }
    return null;
}

/** Dónde se quedó una entrada que no terminó. Lo deduce de la URL: el Managed Login no avisa de otra forma. */
export type LoginStage = 'usuario' | 'clave' | 'callback' | 'app';

export function stageOfUrl(url: string, returnHost: string): LoginStage {
    let u: URL;
    try { u = new URL(url); } catch { return 'usuario'; }
    if (u.host === returnHost) return /^\/auth\/callback\/?$/.test(u.pathname) ? 'callback' : 'app';
    return /verifyPassword|password/i.test(u.pathname) ? 'clave' : 'usuario';
}

export interface LoginResult {
    target: string;
    front: string;
    user: string;
    /** `entró` · `no entró` · `sin clave` (sólo se descubrió el login) · `no se pudo probar`. */
    veredicto: 'entró' | 'no entró' | 'sin clave' | 'no se pudo probar';
    /** Una línea que dice por qué, en cristiano. */
    detalle: string;
    hosted: HostedUi | null;
    advisor: Pick<TestAdvisor, 'alliedId' | 'branchHash' | 'hasSub'> | null;
    /** Ruta en la que aterrizó, si entró. */
    landing: string | null;
    /** Sucursal a la que lo mandó el front, si entró (los 8 primeros del hash). */
    landingBranch: string | null;
    /** ¿es la sucursal que le corresponde al asesor? `null` si no se pudo saber. */
    branchMatches: boolean | null;
    sessionMinutes: number | null;
    ms: number;
}

/**
 * La sesión que dejó un login, juzgada por sus cookies (la misma regla que `sessionHealth`, sobre el
 * contexto vivo y no sobre un archivo).
 */
async function sessionOf(page: Page): Promise<{ sirve: boolean; minutos: number | null }> {
    const cookies = await page.context().cookies();
    const health = cookiesHealth(cookies.map((c) => ({ name: c.name, expires: c.expires })), '(contexto)');
    return { sirve: health.sirve, minutos: health.minutos };
}

/** Texto de error visible en el login alojado, si lo hay (credenciales malas, usuario inexistente…). */
async function visibleError(page: Page): Promise<string> {
    const texts = await page
        .locator('[role=alert]:visible, [class*=error]:visible, [class*=Error]:visible, [id*=ErrorMessage]:visible, [data-testid*=error]:visible')
        .allInnerTexts()
        .catch(() => [] as string[]);
    return texts.map((t) => t.trim()).filter(Boolean).join(' · ').slice(0, 160);
}

// El conector adapta login clásico o de dos pasos; la sonda nunca guarda su sesión.
export { loginOnPage } from '../../connectors/advisor/login.ts';
import { loginOnPage } from '../../connectors/advisor/login.ts';

export interface ProbeOptions {
    user: string;
    pass: string;
    /** Hash de la sucursal que se espera que el front le asigne (el del asesor). */
    expectedBranch?: string | null;
    hosted?: HostedUi | null;
    advisor?: TestAdvisor | null;
}

/**
 * Entra con esa cuenta, en un contexto limpio, y dice qué pasó. No lanza por un login fallido: eso ES el
 * resultado. La clave nunca se imprime ni se guarda.
 */
export async function probeLogin(browser: Browser, opts: ProbeOptions): Promise<LoginResult> {
    const started = Date.now();
    const front = config.feBaseUrl;
    const returnHost = new URL(front).host;
    const base: LoginResult = {
        target: TARGET, front, user: opts.user, veredicto: 'no se pudo probar', detalle: '',
        hosted: opts.hosted ?? null,
        advisor: opts.advisor ? { alliedId: opts.advisor.alliedId, branchHash: opts.advisor.branchHash, hasSub: opts.advisor.hasSub } : null,
        landing: null, landingBranch: null, branchMatches: null, sessionMinutes: null, ms: 0,
    };
    const done = (patch: Partial<LoginResult>): LoginResult => ({ ...base, ...patch, ms: Date.now() - started });

    // La misma ventana que usa el resto del harness (acomodada en su columna, UA de celular), para que se
    // vea igual que el camino visual. Sin `storageState`: el contexto nace limpio.
    const { context, page } = await openA(browser, { baseURL: front, userAgent: IPHONE_UA });
    try {
        await page.goto('/merchant', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => { /* lo decide la URL */ });
        await loginOnPage(page, opts.user, opts.pass, returnHost);
        // Si hubo formulario y volvió a la app, `cognitoLogin` ya esperó el callback. Si no hubo
        // formulario, o seguimos en Cognito, no entramos.
        const url = page.url();
        if (new URL(url).host !== returnHost) {
            const stage = stageOfUrl(url, returnHost);
            const err = await visibleError(page);
            return done({ veredicto: 'no entró', detalle: `se quedó en el paso «${stage}» del login${err ? `: ${err}` : ''}` });
        }
        const path = new URL(url).pathname;
        const landingBranch = /\/merchant\/([0-9a-f]{8})/.exec(path)?.[1] ?? null;
        const expected = opts.expectedBranch ? opts.expectedBranch.slice(0, 8) : null;
        const session = await sessionOf(page);
        if (!session.sirve) {
            return done({ veredicto: 'no entró', detalle: 'volvió a la app pero sin cookies de sesión vivas', landing: path, landingBranch, sessionMinutes: session.minutos });
        }
        const branchMatches = expected && landingBranch ? expected === landingBranch : null;
        return done({
            veredicto: 'entró',
            detalle: branchMatches === false
                ? `entró, pero a otra sucursal (${landingBranch}, esperaba ${expected})`
                : `entró · sesión de ${session.minutos ?? '?'} min`
                    + (branchMatches ? ` · sucursal ${landingBranch} ✔` : '')
                    + (expected && !landingBranch ? ` · sucursal sin confirmar (aterrizó en ${path})` : ''),
            landing: path, landingBranch, branchMatches, sessionMinutes: session.minutos,
        });
    } catch (e) {
        const stage = stageOfUrl(page.url(), returnHost);
        const err = await visibleError(page);
        const msg = (e as Error).message.split('\n')[0].slice(0, 140);
        return done({ veredicto: 'no entró', detalle: `se quedó en el paso «${stage}»${err ? `: ${err}` : ` (${msg})`}` });
    } finally {
        await context.close().catch(() => { /* ya cerrado */ });
    }
}

/** Resultado de un ambiente donde no se pudo ni empezar (front caído, sin asesor, sin clave…). */
export function notProbed(partial: Pick<LoginResult, 'veredicto' | 'detalle'> & Partial<LoginResult>): LoginResult {
    return {
        target: TARGET, front: config.feBaseUrl, user: '', hosted: null, advisor: null,
        landing: null, landingBranch: null, branchMatches: null, sessionMinutes: null, ms: 0,
        ...partial,
    };
}

/** La tabla que imprime el recorrido de ambientes. Pura: se fija con pruebas. */
export function renderLoginTable(results: LoginResult[]): string {
    const mark = (v: LoginResult['veredicto']) => (v === 'entró' ? '✅' : v === 'no entró' ? '✖ ' : v === 'sin clave' ? '◌ ' : '⚠ ');
    const hosted = (r: LoginResult) => (r.hosted ? `${r.hosted.host} · ${r.hosted.clientId.slice(0, 8)}…` : '—');
    const rows = results.map((r) => ({
        a: r.target, b: `${mark(r.veredicto)}${r.veredicto}`, c: hosted(r), d: r.detalle,
    }));
    const w = (k: 'a' | 'b' | 'c') => Math.max(...rows.map((x) => x[k].length), { a: 8, b: 9, c: 5 }[k]);
    const line = (a: string, b: string, c: string, d: string) => `  ${a.padEnd(w('a'))}  ${b.padEnd(w('b'))}  ${c.padEnd(w('c'))}  ${d}`;
    return [line('ambiente', 'resultado', 'login', 'detalle'), ...rows.map((x) => line(x.a, x.b, x.c, x.d))].join('\n');
}

/** Exit code del recorrido: `0` todos entraron · `1` alguno no entró · `2` alguno no se pudo probar. */
export function exitCodeOf(results: LoginResult[]): 0 | 1 | 2 {
    if (results.some((r) => r.veredicto === 'no entró')) return 1;
    if (results.some((r) => r.veredicto === 'no se pudo probar' || r.veredicto === 'sin clave')) return 2;
    return 0;
}

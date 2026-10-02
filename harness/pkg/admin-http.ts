import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Hablarle al ADMIN de `legacy-application` por HTTP, como lo haría un navegador: sesión, token CSRF y las
 * páginas de Inertia, sin abrir ninguna ventana.
 *
 * POR QUÉ EXISTE. Crear un comercio en el admin es lo que dispara todo lo de esta tarea (la sucursal y el
 * asesor de prueba, su cuenta de Cognito), y hacerlo a mano cuesta un par de minutos cada vez que se quiere
 * repetir la prueba en otro ambiente. Esto lo vuelve un paso de un comando, por el MISMO camino real: nada de
 * insertar filas directo.
 *
 * LA SESIÓN SE PIDE, NO SE INVENTA, y es la misma decisión que ya tomó `dev/open-admin.ts`:
 *   · local → `bin/admin-session` emite una sesión con el guard real de Laravel (sólo corre con `APP_ENV=local`);
 *   · dev y staging → el PERFIL PERSISTENTE de navegador `.auth/admin-<target>`: te logueás una vez con
 *     `node dev/open-admin.ts /aliados dev` y de ahí se leen las cookies. **Ninguna contraseña de admin pasa
 *     por este código.**
 *   · producción y qa no están: producción es sólo lectura, y qa no tiene admin propio (comparte la base con dev,
 *     así que el comercio se crea en el de dev).
 */

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Dónde vive el admin de cada ambiente. Espejo de `ADMINS` en `dev/open-admin.ts` (que es un script y no se importa). */
export const ADMIN_URLS: Readonly<Record<string, string>> = {
    local: 'http://admin.localhost:8000',
    dev: 'https://admin.dev.creditop.com',
    staging: 'https://admin.staging.creditop.com',
};

export function adminBaseFor(target: string): string {
    const t = target.trim().toLowerCase();
    if (t === 'prod' || t === 'production') throw new Error('producción es sólo lectura: la herramienta no crea nada ahí');
    if (t === 'qa') throw new Error('qa no tiene admin propio: comparte la base con dev, así que el comercio se crea con --target dev');
    const base = ADMIN_URLS[t];
    if (!base) throw new Error(`no conozco el admin de «${target}». Los que hay: ${Object.keys(ADMIN_URLS).join(', ')}`);
    return base;
}

/** No hay sesión de admin utilizable: el mensaje dice cómo conseguirla. */
export class NoAdminSession extends Error {}

// ── piezas puras (con prueba) ────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { '&quot;': '"', '&#039;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/** Deshace el escapado HTML del atributo `data-page` (el `&amp;` va al final para no escapar dos veces). */
export function unescapeHtml(s: string): string {
    return s.replace(/&quot;|&#0?39;|&lt;|&gt;|&amp;/g, (m) => ENTITIES[m] ?? m);
}

export interface InertiaPage {
    component: string;
    props: Record<string, any>;
    url: string;
    version: string | null;
}

/**
 * La página de Inertia que viaja en el HTML. Hay DOS formas y este admin usa la segunda:
 *   · `<div id="app" data-page="{…}">` (el atributo escapado, lo estándar);
 *   · `<script inertia> window.inertiaPage = {…}; </script>` (lo que sirve `legacy-application`).
 * `null` si no hay ninguna.
 */
export function parseDataPage(html: string): InertiaPage | null {
    const attr = /\sdata-page="([^"]*)"/.exec(html);
    const script = /window\.inertiaPage\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(html);
    const json = attr ? unescapeHtml(attr[1]) : script ? script[1] : null;
    if (!json) return null;
    try {
        const raw = JSON.parse(json);
        return { component: raw.component ?? '', props: raw.props ?? {}, url: raw.url ?? '', version: raw.version ?? null };
    } catch {
        return null;
    }
}

/** Las cookies de una conversación: las que manda el servidor se aplican, las que borra se quitan. */
export class CookieJar {
    private readonly cookies = new Map<string, string>();

    set(name: string, value: string): void { this.cookies.set(name, value); }
    get(name: string): string | undefined { return this.cookies.get(name); }
    names(): string[] { return [...this.cookies.keys()]; }

    /** Aplica los `Set-Cookie` de una respuesta. Un valor vacío o vencido borra la cookie. */
    apply(setCookies: string[]): void {
        const now = Date.now();
        for (const raw of setCookies) {
            const [pair, ...attrs] = raw.split(';').map((x) => x.trim());
            const eq = pair.indexOf('=');
            if (eq < 1) continue;
            const name = pair.slice(0, eq);
            const value = pair.slice(eq + 1);
            let expired = false;
            for (const a of attrs) {
                const [k, v = ''] = a.split('=');
                if (/^max-age$/i.test(k) && Number(v) <= 0) expired = true;
                if (/^expires$/i.test(k) && Date.parse(v) < now) expired = true;
            }
            if (!value || expired) this.cookies.delete(name); else this.cookies.set(name, value);
        }
    }

    header(): string {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    /** El token CSRF de Laravel: viaja en la cookie `XSRF-TOKEN` (codificada) y se devuelve en `X-XSRF-TOKEN`. */
    xsrf(): string | undefined {
        const v = this.cookies.get('XSRF-TOKEN');
        return v === undefined ? undefined : decodeURIComponent(v);
    }
}

/** El id del comercio al que redirige el alta: `…/aliados?allied=349` o `…/aliados/349/…`. */
export function alliedIdFromLocation(location: string): number | null {
    try {
        const u = new URL(location, 'http://x');
        const q = u.searchParams.get('allied');
        if (q && /^\d+$/.test(q)) return Number(q);
        const m = /\/aliados\/(\d+)(?:\/|$)/.exec(u.pathname);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

// ── el cliente ───────────────────────────────────────────────────────────────────────────────────────

export interface AdminReply {
    status: number;
    /** `Location` si el servidor redirigió. */
    location: string | null;
    html: string;
    page: InertiaPage | null;
}

export class AdminClient {
    // Campos explícitos y no «constructor(readonly …)»: Node corre este TypeScript quitando tipos y no admite propiedades de parámetro.
    readonly base: string;
    readonly jar: CookieJar;

    constructor(base: string, jar: CookieJar) {
        this.base = base;
        this.jar = jar;
    }

    private async send(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<AdminReply> {
        const url = path.startsWith('http') ? path : `${this.base}${path}`;
        const res = await fetch(url, {
            ...init,
            redirect: 'manual',
            signal: AbortSignal.timeout(60_000),
            headers: { 'user-agent': 'harness-admin', cookie: this.jar.header(), ...init.headers },
        });
        this.jar.apply(res.headers.getSetCookie?.() ?? []);
        const html = res.status >= 300 && res.status < 400 ? '' : await res.text();
        return { status: res.status, location: res.headers.get('location'), html, page: parseDataPage(html) };
    }

    /** GET de una página. Si el admin manda al login, no hay sesión. */
    async get(path: string): Promise<AdminReply> {
        const r = await this.send(path, { method: 'GET', headers: { accept: 'text/html' } });
        if (r.location && /\/login(\?|$|\/)/.test(r.location)) throw new NoAdminSession('el admin mandó al login: la sesión no sirve');
        return r;
    }

    /** POST de un formulario (multipart). Lleva el token CSRF y el origen, como el navegador. */
    async postForm(path: string, form: FormData, referer: string): Promise<AdminReply> {
        const token = this.jar.xsrf();
        return this.send(path, {
            method: 'POST',
            body: form,
            headers: {
                accept: 'text/html',
                origin: this.base,
                referer: `${this.base}${referer}`,
                ...(token ? { 'x-xsrf-token': token } : {}),
            },
        });
    }

    /** Sigue una redirección que dejó el servidor (ruta absoluta o relativa). */
    follow(location: string): Promise<AdminReply> {
        return this.get(new URL(location, this.base).toString());
    }
}

/** Cookies de un perfil persistente de navegador: lo que dejó `dev/open-admin.ts` al loguearse a mano. */
async function cookiesFromProfile(target: string, host: string): Promise<Array<{ name: string; value: string }>> {
    const profile = join(HARNESS, '.auth', `admin-${target}`);
    if (!existsSync(profile)) {
        throw new NoAdminSession(`no hay sesión de admin para ${target}. Entra una vez a mano (queda en el perfil):\n     node dev/open-admin.ts /aliados ${target}`);
    }
    const { chromium } = await import('@playwright/test');
    let ctx;
    try {
        ctx = await chromium.launchPersistentContext(profile, { headless: true });
    } catch (e) {
        throw new NoAdminSession(`no pude abrir el perfil de ${target} (¿la ventana de open-admin sigue abierta? ciérrala): ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
    }
    try {
        const cookies = await ctx.cookies();
        return cookies.filter((c) => host === c.domain.replace(/^\./, '') || host.endsWith(`.${c.domain.replace(/^\./, '')}`));
    } finally {
        await ctx.close().catch(() => { /* ya cerrado */ });
    }
}

/** Abre una conversación autenticada con el admin de `target`, o falla diciendo cómo conseguir la sesión. */
export async function openAdminClient(target: string): Promise<AdminClient> {
    const t = target.trim().toLowerCase();
    const base = adminBaseFor(t);
    const jar = new CookieJar();

    if (t === 'local') {
        try {
            const s = JSON.parse(execFileSync(join(HARNESS, 'bin/admin-session'), { encoding: 'utf8' }).trim());
            jar.set(s.cookie, s.value);
        } catch (e) {
            throw new NoAdminSession(`no pude emitir la sesión local (¿el admin local está arriba y APP_ENV=local?): ${String((e as Error).message).split('\n')[0].slice(0, 140)}`);
        }
    } else {
        const cookies = await cookiesFromProfile(t, new URL(base).hostname);
        if (!cookies.length) throw new NoAdminSession(`el perfil de ${t} no trae cookies del admin: entra una vez a mano con  node dev/open-admin.ts /aliados ${t}`);
        for (const c of cookies) jar.set(c.name, c.value);
    }

    const client = new AdminClient(base, jar);
    // Comprobar que la sesión SIRVE antes de usarla: si no, el primer POST fallaría con un 419 que no explica nada.
    const probe = await client.get('/aliados');
    if (probe.status >= 400) throw new NoAdminSession(`el admin contestó HTTP ${probe.status} al pedir /aliados`);
    return client;
}

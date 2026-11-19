// La API del backoffice nuevo, con la SESIÓN de la persona, desde una pestaña del backoffice en su Chrome.
//
// El backoffice (`apps/backoffice` de frontend-monorepo) no deja pegarle a los servicios desde afuera: su servidor
// (el BFF) adjunta el token de STAFF de la sesión y reenvía `/api/backoffice/*` a legacy-backend y
// `/backoffice/merchant-api-service/*` a merchant-api (knowledge: backoffice-merchants). Por eso las recetas abren
// una pestaña del backoffice y hacen cada pedido desde adentro de la página (`fetch` con la cookie), como la
// pantalla. No hay llave ni token que guardar.
//
// Módulo de apoyo: no es una receta.
import { openChrome } from '../recorder.ts';

export const BACKOFFICE = { dev: 'https://backoffice.dev.creditop.com' } as const;
export type Env = keyof typeof BACKOFFICE;

export interface Reply<T = any> { status: number; ok: boolean; body: T | null; text: string }

export async function openBackoffice(env: Env = 'dev') {
    const origin = BACKOFFICE[env];
    if (!origin) throw new Error(`ambiente sin backoffice conocido: ${env} (hay: ${Object.keys(BACKOFFICE).join(', ')})`);
    const { page, close } = await openChrome();
    // Sólo para tener la sesión y el origen: no se toca nada en pantalla.
    await page.goto(`${origin}/merchants`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (new URL(page.url()).pathname.startsWith('/login')) {
        await close();
        throw new Error(`no hay sesión en ${origin}: entrá una vez en tu Chrome y volvé a correr`);
    }
    const call = async <T = any>(method: string, path: string, body?: unknown): Promise<Reply<T>> =>
        page.evaluate(async ({ method, path, body }: any) => {
            const res = await fetch(path, {
                method, credentials: 'include',
                headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch { /* no es JSON */ }
            return { status: res.status, ok: res.ok, body: parsed, text: text.slice(0, 2000) };
        }, { method, path, body });
    return { page, close, call, origin };
}

/** `data` de un sobre `{success, data}` de legacy-backend, o el cuerpo tal cual (merchant-api no usa sobre). */
export const dataOf = (r: Reply) => (r.body && typeof r.body === 'object' && 'data' in (r.body as any) ? (r.body as any).data : r.body);

/** El mensaje de error que devolvió el servidor, en una línea. */
export const errorOf = (r: Reply) => String((r.body as any)?.message ?? (r.body as any)?.error ?? r.text).replace(/\s+/g, ' ').slice(0, 400);

/**
 * Encuentra un comercio por id, hash de sucursal o nombre. El listado busca por texto (`q`); un id numérico va
 * directo a la ficha.
 */
export async function findMerchant(call: (m: string, p: string) => Promise<Reply>, ref: string): Promise<any> {
    if (/^\d+$/.test(ref)) {
        const r = await call('GET', `/api/backoffice/merchants/${ref}`);
        if (!r.ok) throw new Error(`comercio ${ref}: ${r.status} ${errorOf(r)}`);
        return dataOf(r).merchant;
    }
    const q = new URLSearchParams({ q: ref, perPage: '10', page: '1' });
    const r = await call('GET', `/api/backoffice/merchants?${q}`);
    if (!r.ok) throw new Error(`buscar «${ref}»: ${r.status} ${errorOf(r)}`);
    const list: any[] = dataOf(r)?.merchants ?? [];
    const exact = list.find((m) => m.name === ref || m.slug === ref || m.hash === ref) ?? (list.length === 1 ? list[0] : null);
    if (!exact) throw new Error(`«${ref}» no es un comercio único (${list.length} resultados: ${list.slice(0, 5).map((m) => `${m.id} ${m.name}`).join(' · ')})`);
    return (await findMerchant(call, String(exact.id)));
}

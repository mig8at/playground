// El cliente de la Admin API de Shopify para las recetas de Jarvis: la tienda de pruebas `creditop-dev-store`.
//
// Entra con la app «Jarvis · Admin API (pruebas)» del Dev Dashboard (organización CREDITOP, creada el 2026-11-07 e
// instalada sólo en creditop-dev-store), por el «client credentials grant»: con su Client ID y su secreto se pide un
// token que dura 24 h (`POST https://<tienda>/admin/oauth/access_token`, documentado en shopify.dev). Las credenciales
// viven en `connectors/.env` (SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET) y no se imprimen. El token se
// pide una vez por corrida.
// Los permisos de la app: productos, pedidos, borradores, descuentos, inventario y publicaciones (lectura y escritura) y
// sucursales (lectura). Uno nuevo pide una versión nueva de la app y que la tienda lo apruebe.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { credential } = await import(path.join(ROOT, 'harness/pkg/env.ts'));

export const store = (credential('SHOPIFY_STORE') as string) || 'creditop-dev-store.myshopify.com';
// ⚠ Nunca la de producción: `tienda-creditop` es «Transferencia a clientes». La app tampoco está instalada ahí.
if (/tienda-creditop/.test(store)) throw new Error('SHOPIFY_STORE apunta a la tienda de PRODUCCIÓN: las recetas son sólo para creditop-dev-store');
export const API_VERSION = '2026-10';
export const admin = `https://admin.shopify.com/store/${store.replace(/\.myshopify\.com$/, '')}`;

let token = '';
async function accessToken(): Promise<string> {
    if (token) return token;
    const id = credential('SHOPIFY_CLIENT_ID') as string;
    const secret = credential('SHOPIFY_CLIENT_SECRET') as string;
    if (!id || !secret) throw new Error('faltan SHOPIFY_CLIENT_ID o SHOPIFY_CLIENT_SECRET en connectors/.env (el secreto está en el Dev Dashboard → la app → Configuración)');
    const r = await fetch(`https://${store}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) throw new Error(`Shopify no dio un token (${r.status}): ${JSON.stringify(body).slice(0, 200)}`);
    token = body.access_token;
    return token;
}

/** Una consulta o mutación de la Admin GraphQL API. Tira con los `errors` de GraphQL (Shopify suele contestar 200 con
 *  el error adentro); los `userErrors` de una mutación los mira quien llama. */
export async function graphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
        body: JSON.stringify({ query, variables }),
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok || body.errors) throw new Error(`Admin API (${r.status}): ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    return body.data as T;
}

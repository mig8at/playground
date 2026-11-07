// El cliente de la API de VTEX para las recetas de Jarvis. Las credenciales son las de la cuenta de pruebas `creditop`
// (`harness/.env.vtex`: VTEX_ACCOUNT, VTEX_APP_KEY, VTEX_APP_TOKEN), leídas con el mismo lector del harness: no se
// copian a ningún otro lado ni se imprimen.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { envFrom } = await import(path.join(ROOT, 'harness/pkg/env.ts'));

export const account = envFrom('vtex', 'VTEX_ACCOUNT') as string;
const key = envFrom('vtex', 'VTEX_APP_KEY') as string;
const token = envFrom('vtex', 'VTEX_APP_TOKEN') as string;
if (!account || !key || !token) throw new Error('faltan VTEX_ACCOUNT, VTEX_APP_KEY o VTEX_APP_TOKEN en harness/.env.vtex');

export const hosts = {
    catalog: `https://${account}.vtexcommercestable.com.br`,
    pricing: `https://api.vtex.com/${account}`,
    store: `https://${account}.myvtex.com`,
    admin: `https://${account}.myvtex.com/admin`,
};

export type Reply<T = any> = { status: number; data: T; text: string };

/** Una llamada a la API. No tira por un 4xx/5xx: devuelve el status para que la receta diga qué falló y dónde. */
export async function call<T = any>(method: string, url: string, body?: unknown): Promise<Reply<T>> {
    const res = await fetch(url, {
        method,
        headers: { 'X-VTEX-API-AppKey': key, 'X-VTEX-API-AppToken': token, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* texto plano */ }
    return { status: res.status, data, text };
}

/** Como `call`, pero un status fuera de 2xx es un error con el paso que falló. */
export async function must<T = any>(step: string, method: string, url: string, body?: unknown): Promise<T> {
    const r = await call<T>(method, url, body);
    if (r.status < 200 || r.status >= 300) throw new Error(`${step}: ${method} ${url.replace(/^https:\/\/[^/]+/, '')} → ${r.status} ${r.text.slice(0, 240)}`);
    return r.data;
}

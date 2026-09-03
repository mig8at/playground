// front.ts — el WIZARD por HTTP: el mismo protocolo que usa el navegador, sin navegador.
//
// El wizard es React Router 7 con render en servidor y «single fetch»: cada pantalla tiene un endpoint
// propio, `<ruta>.data`, que devuelve lo que el `loader` calculó (GET) o ejecuta el `action` (POST)
// y contesta en turbo-stream (`text/x-script`). Es exactamente lo que el navegador pide por debajo
// —se ve en cualquier corrida del panel: `GET …/lenders.data?amount=…` y `POST …/solicitar.data`—,
// así que hablarlo directo corre TODO el lado servidor del front: loaders, actions, el middleware de
// Cognito, las validaciones zod y —lo que importa— los fallbacks que deciden a qué pantalla mandar al
// cliente. Lo que NO corre es el JavaScript del cliente (hidratación, estado de React, validaciones
// del componente): para eso está el panel y el caminador con navegador.
//
// TRES COSAS DEL PROTOCOLO que no están documentadas en ningún lado y acá se dedujeron del código de
// react-router 7.12 (dist/development/index.js y chunk-2BEI23B2.js), verificadas contra qa y local:
//
//   1. UN REDIRECT NO ES UN 302. Para que el `fetch` del navegador no lo siga solo, el servidor
//      contesta **202** con el destino ADENTRO del cuerpo: en un GET, `{ [Symbol(SingleFetchRedirect)]:
//      {redirect, status, revalidate, reload, replace} }` (el plugin lo serializa como
//      `["SingleFetchRedirect", …]`); en un POST, ese objeto pelado como raíz. Seguirlo es mirar el
//      cuerpo, no el header `Location`, que no viene.
//   2. EL CUERPO ES UN GRAFO APLANADO (turbo-stream v3, que react-router VENDOREA —no está en npm—).
//      Una línea JSON con un array de valores; los objetos son `{"_k": v}` donde `k` y `v` son
//      ÍNDICES en ese array (la clave es `values[k]`); los arrays son listas de índices; los negativos
//      son constantes (-5 null, -7 undefined, -1 hueco…); los arrays con primer elemento string son
//      tipos: `["D", ms]` fecha, `["P", id]` PROMESA, `["SingleFetchRedirect", i]` plugin. Las
//      promesas del loader llegan en LÍNEAS POSTERIORES del mismo cuerpo: `P<id>:<json>` la resuelve,
//      `E<id>:<json>` la rechaza. El listado de entidades viaja así (`loanOptionsPromise`), o sea
//      que sin leer esas líneas el listado «no viene».
//   3. EL ACTION VA COMO FORMULARIO. `POST <ruta>.data` con `application/x-www-form-urlencoded` y los
//      campos que el `action` lee con `formData.get(...)`. Sin header `Origin` (la guarda CSRF sólo
//      compara si viene) y sin `_routes`. El resultado no-redirect es `{ data: … }` o `{ error: … }`.
//
// ⚠ LA REGLA QUE HACE SEGURO A ESTE CLIENTE: acá hay loaders que ESCRIBEN. `request-canceled` cancela
// el crédito con sólo cargarse (F-50), y es el destino de todos los fallbacks del wizard. Un cliente que
// adivine URLs no rompe una prueba: cancela solicitudes. Por eso `cargar()` se niega a pedir las rutas
// de `PROHIBIDAS` y quien camina sigue ÚNICAMENTE las redirecciones que la app emite.
import { config } from './config.ts';

/** Rutas cuyo loader tiene efectos que no se quieren disparar «para ver». Pedirlas es un error, no un dato. */
export const PROHIBIDAS: RegExp[] = [
    /\/request-canceled(\.data)?(\?|$)/,   // cancela la solicitud en el loader (F-50)
    /\/logout(\.data)?(\?|$)/,
    /\/dev-actions(\.data)?(\?|$)/,
];

export type Redireccion = { redirect: string; status: number; revalidate?: boolean; reload?: boolean; replace?: boolean };

export type Respuesta = {
    status: number;
    /** Destino si el servidor redirigió (202 + cuerpo, o 3xx clásico). Ruta ABSOLUTA con query. */
    redirect: string | null;
    /** Raíz decodificada. GET: `{ [routeId]: {data}|{error} }`. POST: `{data}` | `{error}`. */
    cuerpo: any;
    /** Datos de la ruta HOJA en un GET (la que no es `root` ni layout). `null` si no aplica. */
    datos: any;
    /** Ids de ruta que trajeron datos, en orden. Para depurar qué contestó. */
    rutas: string[];
    ms: number;
    /** Texto crudo cuando no se pudo decodificar (un 404 en HTML, por ejemplo). */
    crudo?: string;
};

export type Llamada = { t: number; metodo: 'GET' | 'POST'; ruta: string; status: number; ms: number; redirect?: string | null; error?: string };

// ─── turbo-stream v3 (subconjunto suficiente para lo que emite el wizard) ─────────────────────────

const HOLE = -1, NAN = -2, NEGATIVE_INFINITY = -3, NEGATIVE_ZERO = -4, NULL = -5, POSITIVE_INFINITY = -6, UNDEFINED = -7;

/** Marca de promesa aún no resuelta dentro del grafo. Se sustituye al final, cuando llegaron las líneas `P`. */
class Pendiente { id: number; constructor(id: number) { this.id = id; } }

class Decodificador {
    values: any[] = [];
    hydrated: any[] = [];
    resueltas = new Map<number, any>();
    rechazadas = new Map<number, any>();

    unflatten(parsed: any): any {
        if (typeof parsed === 'number') return this.hydrate(parsed);
        if (!Array.isArray(parsed) || !parsed.length) throw new SyntaxError('turbo-stream: línea vacía');
        const start = this.values.length;
        for (const v of parsed) this.values.push(v);
        this.hydrated.length = this.values.length;
        return this.hydrate(start);
    }

    hydrate(index: number): any {
        switch (index) {
            case UNDEFINED: return undefined;
            case NULL: return null;
            case NAN: return NaN;
            case POSITIVE_INFINITY: return Infinity;
            case NEGATIVE_INFINITY: return -Infinity;
            case NEGATIVE_ZERO: return -0;
        }
        if (this.hydrated[index] !== undefined) return this.hydrated[index];
        const value = this.values[index];
        if (!value || typeof value !== 'object') { this.hydrated[index] = value; return value; }

        if (Array.isArray(value)) {
            if (typeof value[0] === 'string') {
                const [type, b, c] = value;
                switch (type) {
                    case 'D': return (this.hydrated[index] = new Date(b));
                    case 'U': return (this.hydrated[index] = new URL(b));
                    case 'B': return (this.hydrated[index] = BigInt(b));
                    case 'R': return (this.hydrated[index] = new RegExp(b, c));
                    case 'Y': return (this.hydrated[index] = Symbol.for(b));
                    case 'S': { const s = new Set(); this.hydrated[index] = s; for (let i = 1; i < value.length; i++) s.add(this.hydrate(value[i])); return s; }
                    case 'M': { const m = new Map(); this.hydrated[index] = m; for (let i = 1; i < value.length; i += 2) m.set(this.hydrate(value[i]), this.hydrate(value[i + 1])); return m; }
                    case 'N': { const o: any = Object.create(null); this.hydrated[index] = o; for (const k of Object.keys(b)) o[this.hydrate(Number(k.slice(1)))] = this.hydrate(b[k]); return o; }
                    case 'P': return (this.hydrated[index] = this.resueltas.has(b) ? this.resueltas.get(b) : new Pendiente(b));
                    case 'E': { const e: any = new Error(b); e.tipo = c; this.hydrated[index] = e; return e; }
                    case 'Z': return (this.hydrated[index] = this.hydrated[b]);
                    // plugins de react-router (encodeViaTurboStream)
                    case 'SingleFetchRedirect': return (this.hydrated[index] = { __redirect: this.hydrate(b) });
                    case 'SanitizedError': { const e: any = new Error(this.hydrate(c)); e.name = this.hydrate(b); this.hydrated[index] = e; return e; }
                    case 'ErrorResponse': return (this.hydrated[index] = { __errorResponse: { data: this.hydrate(b), status: this.hydrate(c), statusText: this.hydrate(value[3]) } });
                    case 'SingleFetchClassInstance': return (this.hydrated[index] = this.hydrate(b));
                    default: throw new SyntaxError(`turbo-stream: tipo desconocido «${type}»`);
                }
            }
            const arr: any[] = []; this.hydrated[index] = arr;
            for (let i = 0; i < value.length; i++) if (value[i] !== HOLE) arr[i] = this.hydrate(value[i]);
            return arr;
        }
        const obj: any = {}; this.hydrated[index] = obj;
        for (const k of Object.keys(value)) obj[this.hydrate(Number(k.slice(1)))] = this.hydrate(value[k]);
        return obj;
    }

    /** Sustituye las `Pendiente` por lo que llegó en las líneas `P`/`E`. Recursivo, con visitados. */
    completar(v: any, vistos = new Set<any>()): any {
        if (v instanceof Pendiente) {
            if (this.resueltas.has(v.id)) return this.completar(this.resueltas.get(v.id), vistos);
            if (this.rechazadas.has(v.id)) return { __rechazada: this.rechazadas.get(v.id) };
            return { __pendiente: v.id };
        }
        if (!v || typeof v !== 'object' || vistos.has(v)) return v;
        vistos.add(v);
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = this.completar(v[i], vistos); return v; }
        if (v instanceof Date || v instanceof Error || v instanceof Map || v instanceof Set) return v;
        for (const k of Object.keys(v)) v[k] = this.completar(v[k], vistos);
        return v;
    }
}

/** Decodifica un cuerpo `text/x-script` entero (todas sus líneas). */
export function decodificar(texto: string): any {
    const lineas = texto.split('\n').filter((l) => l.length > 0);
    if (!lineas.length) return undefined;
    const d = new Decodificador();
    const raiz = d.unflatten(JSON.parse(lineas[0]));
    for (const linea of lineas.slice(1)) {
        const dosPuntos = linea.indexOf(':');
        const id = Number(linea.slice(1, dosPuntos));
        const valor = d.unflatten(JSON.parse(linea.slice(dosPuntos + 1)));
        if (linea[0] === 'P') d.resueltas.set(id, valor);
        else if (linea[0] === 'E') d.rechazadas.set(id, valor);
    }
    return d.completar(raiz);
}

// ─── la sesión: un frasco de cookies + el protocolo ─────────────────────────────────────────────

const UA_MOVIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

export class SesionFront {
    private cookies = new Map<string, string>();
    readonly bitacora: Llamada[] = [];
    private t0 = Date.now();

    readonly base: string;
    private timeoutGetMs: number;
    private timeoutPostMs: number;

    // Sin «parameter properties»: Node corre estos .ts en modo strip-only y no las soporta.
    // Dos esperas, como en caso.ts: el POST de la firma (`otp-validation` → authorize) tarda más que
    // cualquier loader, y en local con tres casos a la vez pasó de 120 s (2026-09-02). Un timeout NO es
    // una caída —PHP sigue y termina—, así que quien llama debe volver a mirar la BD antes de concluir.
    constructor(base: string = config.feBaseUrl, timeoutGetMs = 120_000, timeoutPostMs = 240_000) {
        this.base = base; this.timeoutGetMs = timeoutGetMs; this.timeoutPostMs = timeoutPostMs;
    }

    /** Carga las cookies de un storageState de Playwright (la sesión Cognito cacheada del asesor). */
    conCookiesDe(storageState: { cookies?: { name: string; value: string }[] } | null | undefined): this {
        for (const c of storageState?.cookies ?? []) this.cookies.set(c.name, c.value);
        return this;
    }

    private guardarCookies(res: Response): void {
        const setCookies: string[] = typeof (res.headers as any).getSetCookie === 'function'
            ? (res.headers as any).getSetCookie() : [];
        for (const sc of setCookies) {
            const [par] = sc.split(';');
            const eq = par.indexOf('=');
            if (eq > 0) this.cookies.set(par.slice(0, eq).trim(), par.slice(eq + 1).trim());
        }
    }

    private cookieHeader(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }

    /** `/self-service/x/y/lenders?amount=1` → `/self-service/x/y/lenders.data?amount=1` */
    static aData(ruta: string): string {
        const u = new URL(ruta, 'http://x');
        u.pathname = u.pathname === '/' ? '/_root.data' : (u.pathname.endsWith('/') ? `${u.pathname}_.data` : `${u.pathname}.data`);
        return `${u.pathname}${u.search}`;
    }

    static esProhibida(ruta: string): boolean { return PROHIBIDAS.some((re) => re.test(ruta)); }

    private async llamar(metodo: 'GET' | 'POST', ruta: string, form?: Record<string, string | number | null | undefined>): Promise<Respuesta> {
        if (SesionFront.esProhibida(ruta)) {
            throw new Error(`ruta PROHIBIDA para este cliente: ${ruta} — su loader tiene efectos (ver PROHIBIDAS en pkg/front.ts)`);
        }
        const url = `${this.base}${SesionFront.aData(ruta)}`;
        const headers: Record<string, string> = { accept: 'text/x-script', 'user-agent': UA_MOVIL };
        const cookie = this.cookieHeader();
        if (cookie) headers.cookie = cookie;
        let body: string | undefined;
        if (metodo === 'POST') {
            headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(form ?? {})) if (v !== undefined) p.set(k, v === null ? '' : String(v));
            body = p.toString();
        }
        const t0 = Date.now();
        let res: Response;
        try {
            res = await fetch(url, { method: metodo, headers, body, redirect: 'manual', signal: AbortSignal.timeout(metodo === 'POST' ? this.timeoutPostMs : this.timeoutGetMs) });
        } catch (e) {
            const ms = Date.now() - t0;
            const expiro = /timeout|abort/i.test(String(e));
            this.bitacora.push({ t: Date.now() - this.t0, metodo, ruta, status: 0, ms, error: expiro ? `se pasó de ${Math.round(ms / 1000)} s (no falló: tardó)` : String((e as Error).message).slice(0, 160) });
            return { status: 0, redirect: null, cuerpo: null, datos: null, rutas: [], ms, crudo: String(e) };
        }
        this.guardarCookies(res);
        const ms = Date.now() - t0;
        const texto = await res.text();

        // 3xx clásico (redirectDocument o un proxy): el destino viene en Location.
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location') ?? '';
            const destino = loc ? new URL(loc, this.base).pathname + new URL(loc, this.base).search : null;
            this.bitacora.push({ t: Date.now() - this.t0, metodo, ruta, status: res.status, ms, redirect: destino });
            return { status: res.status, redirect: destino, cuerpo: null, datos: null, rutas: [], ms };
        }

        const esScript = /x-script/.test(res.headers.get('content-type') ?? '') || res.headers.get('x-remix-response') === 'yes';
        if (!esScript) {
            this.bitacora.push({ t: Date.now() - this.t0, metodo, ruta, status: res.status, ms, error: `sin turbo-stream (${res.headers.get('content-type')})` });
            return { status: res.status, redirect: null, cuerpo: null, datos: null, rutas: [], ms, crudo: texto.slice(0, 600) };
        }

        let cuerpo: any;
        try { cuerpo = decodificar(texto); }
        catch (e) {
            this.bitacora.push({ t: Date.now() - this.t0, metodo, ruta, status: res.status, ms, error: `no decodifica: ${(e as Error).message}` });
            return { status: res.status, redirect: null, cuerpo: null, datos: null, rutas: [], ms, crudo: texto.slice(0, 600) };
        }

        // El redirect de single fetch: 202 + destino en el cuerpo (GET envuelto por el plugin, POST pelado).
        let redirect: string | null = null;
        if (res.status === 202) {
            const r: Redireccion | undefined = cuerpo?.__redirect ?? (cuerpo && typeof cuerpo.redirect === 'string' ? cuerpo : undefined);
            if (r?.redirect) redirect = r.redirect.startsWith('http') ? new URL(r.redirect).pathname + new URL(r.redirect).search : r.redirect;
        }

        let datos: any = null;
        const rutas: string[] = [];
        if (metodo === 'GET' && cuerpo && typeof cuerpo === 'object' && !redirect) {
            for (const [id, v] of Object.entries<any>(cuerpo)) {
                if (id === '__redirect') continue;
                rutas.push(id);
                if (id !== 'root' && !id.startsWith('layouts/')) datos = v?.data ?? v?.error ?? v;
            }
        }
        this.bitacora.push({ t: Date.now() - this.t0, metodo, ruta, status: res.status, ms, redirect });
        return { status: res.status, redirect, cuerpo, datos, rutas, ms };
    }

    /** El `loader` de una pantalla: lo que el navegador pide al llegar. */
    cargar(ruta: string): Promise<Respuesta> { return this.llamar('GET', ruta); }
    /** El `action` de una pantalla: el formulario que el navegador manda al apretar el botón. */
    enviar(ruta: string, form: Record<string, string | number | null | undefined> = {}): Promise<Respuesta> { return this.llamar('POST', ruta, form); }
}

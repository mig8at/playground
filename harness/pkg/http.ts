// pkg/http.ts — el cliente HTTP de los runners: uno solo, con bitácora y que sabe distinguir «tardó»
// de «se cayó».
//
// POR QUÉ EXISTE. Había CINCO copias del mismo `http()` —`ecommerce`, `kyc-apellido`, `listado`,
// `qr-corbeta`, `sweep`— idénticas salvo en detalles que nadie eligió: el timeout (60 s o 90 s) y
// cuántos caracteres recortaban del cuerpo (120, 140, 160 o 200). Copiar y pegar no las hizo iguales,
// las hizo parecidas.
//
// Y las cinco arrastraban DOS bugs que `caso.ts` ya había pagado y arreglado sólo para sí mismo:
//
// 1 · **Un timeout no es una caída, y `HTTP 0` los confunde.** Medido el 2026-08-23: con nueve casos en
//     paralelo, la generación de documentos tardó **90.002 ms** —clavó el límite— y el runner reportó
//     «devolvió HTTP 0», que se lee como que el backend se murió. No se murió: tardó, por la misma razón
//     de F-166 (llamadas remotas dentro de una transacción abierta, que bajo concurrencia se serializan).
//     Cuál de las dos cosas fue cambia DÓNDE se busca la causa.
// 2 · **Ninguna dejaba rastro.** `caso.ts` aprendió que la llamada que uno más quiere ver al fallar es
//     justo la que no quedaba anotada. Acá la bitácora es parte del cliente, así que no se puede olvidar
//     — la misma razón por la que la guarda de escrituras vive dentro de `exec` y no a criterio de quien
//     escribe.
//
// El cuerpo entero se guarda SÓLO cuando la llamada falló: es cuando hace falta, y evita volcar datos
// personales de las respuestas buenas.

/** Una llamada, como queda anotada. `t` es el offset desde que se creó el cliente. */
export interface Llamada {
    t: number;
    metodo: string;
    ruta: string;
    status: number;
    ms: number;
    cuerpo?: string;
}

/**
 * Lo que devuelve una llamada. La forma es la MISMA salga como salga, y eso es a propósito: las cinco
 * copias devolvían cosas distintas en el camino de error y cada consumidor aprendió una.
 *
 * - bien y con JSON → `{ status, json }`
 * - bien y sin JSON → `{ status, json: { raw }, error }`
 * - no hubo respuesta → `{ status: 0, json: { message }, error, expiro }`
 *
 * `error` aparece **sólo** cuando algo salió mal, para que un `if (r.error)` signifique eso.
 */
export interface Respuesta<T = any> {
    status: number;
    json: T;
    error?: string;
    /** `true` si se acabó la espera. ⚠ No es lo mismo que caerse — ver el encabezado. */
    expiro?: boolean;
}

export interface OpcionesCliente {
    /** A dónde cuelgan las rutas (sin barra final). */
    base: string;
    /** Cabeceras de todas las llamadas. Cada una puede agregar las suyas. */
    headers?: Record<string, string>;
    /** Espera por defecto. Los POST suelen necesitar más que los GET, así que se puede dar por verbo. */
    timeoutMs?: number | { get: number; post: number };
    /** Cuántos caracteres del cuerpo se guardan al fallar. */
    recorte?: number;
}

export interface Cliente {
    llamar<T = any>(metodo: string, ruta: string, cuerpo?: unknown, extra?: Record<string, string>, timeoutMs?: number): Promise<Respuesta<T>>;
    get<T = any>(ruta: string, extra?: Record<string, string>): Promise<Respuesta<T>>;
    post<T = any>(ruta: string, cuerpo?: unknown, extra?: Record<string, string>): Promise<Respuesta<T>>;
    /** Lo que se pidió en esta corrida, en orden. */
    bitacora(): Llamada[];
    /** La bitácora lista para imprimir, una línea por llamada. */
    lineas(sangria?: string): string[];
}

export function crearCliente(opts: OpcionesCliente): Cliente {
    const base = opts.base.replace(/\/+$/, '');
    const H = { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}) };
    const recorte = opts.recorte ?? 200;
    const esperaDe = (metodo: string): number => {
        const t = opts.timeoutMs ?? 90_000;
        if (typeof t === 'number') return t;
        return metodo.toUpperCase() === 'POST' ? t.post : t.get;
    };

    const anotadas: Llamada[] = [];
    const t0 = Date.now();
    const anotar = (metodo: string, ruta: string, status: number, ms: number, cuerpo?: string) => {
        anotadas.push({
            t: Date.now() - t0, metodo, ruta, status, ms,
            ...(status >= 200 && status < 300 ? {} : { cuerpo: (cuerpo ?? '').slice(0, 600) }),
        });
    };

    const llamar = async <T = any>(metodo: string, ruta: string, cuerpo?: unknown,
                                   extra: Record<string, string> = {}, timeoutMs?: number): Promise<Respuesta<T>> => {
        const inicio = Date.now();
        const espera = timeoutMs ?? esperaDe(metodo);
        const r = await fetch(`${base}${ruta}`, {
            method: metodo,
            headers: { ...H, ...extra },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(espera),
        }).catch((e) => e as Error);

        if (r instanceof Error) {
            const ms = Date.now() - inicio;
            // ⚠ La distinción que costó un diagnóstico entero: decir «no falló, tardó» manda a mirar la
            // concurrencia; decir «HTTP 0» manda a mirar si el backend está vivo, que no era el problema.
            const expiro = /timeout|abort/i.test(String(r));
            const motivo = expiro
                ? `se pasó de los ${Math.round(ms / 1000)} s de espera (no falló: tardó)`
                : String(r.message).slice(0, recorte);
            anotar(metodo, ruta, 0, ms, String(r).slice(0, 200));
            return { status: 0, json: { message: motivo } as T, error: motivo, expiro };
        }

        const texto = await r.text();
        anotar(metodo, ruta, r.status, Date.now() - inicio, texto);
        try {
            return { status: r.status, json: JSON.parse(texto) as T };
        } catch {
            // Un cuerpo que no es JSON se devuelve en las DOS formas que los runners ya leían: `json.raw`
            // y `error`. Unificar sin romper a nadie valía más que elegir una.
            const crudo = texto.slice(0, recorte);
            return { status: r.status, json: { raw: crudo } as T, error: crudo };
        }
    };

    return {
        llamar,
        get: (ruta, extra = {}) => llamar('GET', ruta, undefined, extra),
        post: (ruta, cuerpo, extra = {}) => llamar('POST', ruta, cuerpo, extra),
        bitacora: () => anotadas.slice(),
        lineas: (sangria = '  ') => anotadas.map((l) => {
            const seg = (l.t / 1000).toFixed(1).padStart(6);
            const est = l.status === 0 ? ' — ' : String(l.status);
            const cuerpo = l.cuerpo ? `  ${l.cuerpo.replace(/\s+/g, ' ').slice(0, 140)}` : '';
            return `${sangria}${seg}s  ${l.metodo.padEnd(4)} ${est}  ${String(l.ms).padStart(6)}ms  ${l.ruta}${cuerpo}`;
        }),
    };
}

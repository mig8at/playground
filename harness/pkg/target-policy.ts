// target-policy.ts — qué puede hacer el harness en cada ambiente, en UN lugar.
//
// POR QUÉ EXISTE. Hasta el 2026-11-02 producción era de sólo lectura por AUSENCIA, no por regla:
// `harness/.env.prod` declaraba `E2E_TARGET_READONLY` y nadie lo leía, y `make harness-case TARGET=prod`
// corría igual. Como ese archivo no trae `E2E_API_BASE_URL`, la API caía en `http://localhost`: la
// corrida le pegaba al backend LOCAL y lo reportaba como prod. No escribía en prod sólo porque faltaba una
// variable; el día que alguien la agregara, `harness-case` crearía solicitudes reales.
//
// La regla se aplica donde no se puede olvidar: en el `fetch` del proceso (lo instala `env.ts`, que importa
// casi todo el harness) y en la guarda de escrituras de la base (`db.ts`). Un runner nuevo queda cubierto
// sin hacer nada.
//
//   · un ambiente de SÓLO LECTURA (prod, o cualquiera con `E2E_TARGET_READONLY=1`) no manda nada que no
//     sea GET, HEAD u OPTIONS, ni escribe en la base, con o sin `I_KNOW_THIS_TOUCHES_SHARED_DEV`;
//   · un ambiente que no es `local` no le habla al backend local (`http://localhost/api`) ni abre la base
//     sin `E2E_DB_HOST` (el driver caería en 127.0.0.1): las dos son una variable que falta, y el resultado
//     sería de otro ambiente.
//
// Lo que NO cubre: el tráfico del navegador de Playwright (el wizard llama desde Chromium, no desde este
// proceso) y lo que corre en otro lenguaje (`bin/pg`, en Go, que ya es de sólo lectura en prod). El flujo
// público de `dev/prod-run.ts` no importa `env.ts` a propósito: es la única excepción de prod y la corre
// una persona.

export type Policy = {
    /** POST/PUT/PATCH/DELETE por HTTP. */
    apiWrites: boolean;
    /** Escrituras en la base. `guarded` = las decide `assertWriteAllowed` (permisos angostos o el flag). */
    dbWrites: true | 'guarded' | false;
};

export function policyFor(target: string, readOnlyFlag = ''): Policy {
    if (target === 'prod' || readOnlyFlag === '1') return { apiWrites: false, dbWrites: false };
    if (target === 'local') return { apiWrites: true, dbWrites: true };
    return { apiWrites: true, dbWrites: 'guarded' };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isLocalBackend = (u: URL) =>
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    && (u.port === '' || u.port === '80') && u.pathname.startsWith('/api');

/** Por qué NO se puede hacer esta llamada en este ambiente, o `null` si se puede. */
export function requestBlockReason(target: string, readOnlyFlag: string, method: string, url: string): string | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    const m = method.toUpperCase();
    if (!policyFor(target, readOnlyFlag).apiWrites && !READ_METHODS.has(m)) {
        return `${target} es de SÓLO LECTURA para el harness: ${m} ${u.origin}${u.pathname} no sale`
            + (target === 'prod' ? ' (el único camino que crea algo en prod es dev/prod-run.ts, y lo corre una persona)' : ' (E2E_TARGET_READONLY=1)');
    }
    if (target !== 'local' && isLocalBackend(u)) {
        return `el target es ${target} pero la llamada va al backend LOCAL (${u.origin}${u.pathname}): `
            + `falta E2E_API_BASE_URL (o E2E_MOCK_URL) en harness/.env.${target}, y el resultado sería de local`;
    }
    return null;
}

/** Por qué NO se puede escribir en la base de este ambiente, o `null` si lo decide la guarda de siempre. */
export function dbWriteBlockReason(target: string, readOnlyFlag = ''): string | null {
    return policyFor(target, readOnlyFlag).dbWrites === false
        ? `escritura a la base de ${target} bloqueada: es de SÓLO LECTURA, también con I_KNOW_THIS_TOUCHES_SHARED_DEV`
        : null;
}

/** Por qué NO se puede abrir la base de este ambiente, o `null`. Sin `E2E_DB_HOST` el driver cae en
 *  127.0.0.1: un target remoto leería y escribiría la base LOCAL diciendo que es otro ambiente. */
export function dbHostBlockReason(target: string, host: string): string | null {
    if (target === 'local' || host) return null;
    return target === 'prod'
        ? 'el harness no tiene base de prod (y no la va a tener): para leer prod, bin/pg sql --target prod'
        : `falta E2E_DB_HOST en harness/.env.${target}: sin ella el harness abriría la base LOCAL diciendo que es ${target}`;
}

const INSTALLED = Symbol.for('harness.target-policy.fetch');

/** Envuelve el `fetch` global del proceso con la regla. Idempotente. El rechazo es un error común: quien
 *  ya tenía su `.catch` lo trata como una llamada que no salió, y eso es lo que pasó. */
export function installFetchGuard(target: string, readOnlyFlag = ''): void {
    const g = globalThis as any;
    if (g[INSTALLED]) return;
    const original: typeof fetch = g.fetch;
    if (typeof original !== 'function') return;
    g.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
        const reason = url ? requestBlockReason(target, readOnlyFlag, method ?? 'GET', String(url)) : null;
        if (reason) return Promise.reject(new Error(`target-policy: ${reason}`));
        return original(input, init);
    };
    g[INSTALLED] = true;
}

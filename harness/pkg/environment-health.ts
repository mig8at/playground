// Sondas de lectura, separadas de la configuración y del veredicto del crédito.
// Un puerto abierto no demuestra que el proveedor funcione; un HTTP 200 tampoco identifica la API.
import { connect } from 'node:net';
import mysql, { type ConnectionOptions } from 'mysql2/promise';
import { MOCKS } from './mock-registry.ts';

export type HealthState = 'ok' | 'http-error' | 'wrong-service' | 'unreachable' | 'timeout' | 'invalid-config';
export interface HealthCheck {
    id: string;
    endpoint: string;
    required: boolean;
    state: HealthState;
    detail: string;
    fix: string;
    ms: number;
}
export interface HealthOptions {
    target: string;
    backend: string;
    wizard: string;
    database: ConnectionOptions;
    requiredMocks?: string[];
    timeoutMs?: number;
}

export function isLoopback(host: string): boolean {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}

/** No imprime credenciales, parámetros de consulta ni cuerpos de respuesta. */
function displayUrl(url: URL): string {
    return `${url.protocol}//${url.host}${url.pathname}`;
}

function networkState(error: unknown): { state: HealthState; detail: string } {
    const e = error as Error & { code?: string; cause?: { code?: string } };
    const code = e.cause?.code ?? e.code ?? '';
    if (e.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(code)) {
        return { state: 'timeout', detail: 'se agotó la espera; no demuestra que el servicio esté caído' };
    }
    return { state: 'unreachable', detail: `no se pudo conectar${/^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ''}` };
}

export async function probeHttp(opts: {
    id: string; url: string; target: string; fix: string; timeoutMs: number; expectPing?: boolean; errorFix?: string;
}): Promise<HealthCheck> {
    const started = Date.now();
    const check: HealthCheck = { id: opts.id, endpoint: '(URL inválida)', required: true,
        state: 'invalid-config', detail: 'se necesita una URL HTTP o HTTPS', fix: opts.fix, ms: 0 };
    let url: URL;
    try {
        url = new URL(opts.url);
        if (!['http:', 'https:'].includes(url.protocol)) return check;
    } catch { return check; }
    check.endpoint = displayUrl(url);
    if (opts.target === 'local' && !isLoopback(url.hostname)) {
        return { ...check, detail: 'target local apunta a un host remoto; no se consultó' };
    }
    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs) });
        if (!response.ok && !(opts.id === 'wizard' && [301, 302, 303, 307, 308].includes(response.status))) {
            check.state = 'http-error';
            check.detail = `respondió HTTP ${response.status}`;
            check.fix = opts.errorFix ?? opts.fix;
            await response.body?.cancel();
        } else if (opts.expectPing) {
            // El mismo timeout cubre también el cuerpo: recibir cabeceras no termina la sonda.
            const body = await response.json().catch((e) => {
                if (e.name === 'TimeoutError' || e.name === 'AbortError') throw e;
                return null;
            });
            check.state = body?.ping === 'Pong!' ? 'ok' : 'wrong-service';
            check.detail = check.state === 'ok' ? 'API identificada: ping=Pong!' : 'contestó, pero no tiene el ping del backend';
        } else {
            await response.body?.cancel();
            check.state = 'ok';
            check.detail = `HTTP ${response.status}; no comprueba rutas, login ni configuración del wizard`;
        }
    } catch (error) {
        const cause = networkState(error);
        // Undici usa AbortError si el timeout vence mientras se lee el cuerpo.
        check.state = (error as Error).name === 'AbortError' ? 'timeout' : cause.state;
        check.detail = check.state === 'timeout' ? 'se agotó la espera; no demuestra que el servicio esté caído' : cause.detail;
    }
    return { ...check, ms: Date.now() - started };
}

export async function probeDatabase(options: ConnectionOptions, target: string, timeoutMs: number): Promise<HealthCheck> {
    const host = options.host ?? 'localhost';
    const check: HealthCheck = { id: 'database', endpoint: `${host}:${options.port ?? 3306}/${options.database ?? ''}`,
        required: true, state: 'invalid-config', detail: 'falta E2E_DB_NAME', ms: 0,
        fix: target === 'local' ? 'make -C ../github/legacy-backend up; revisar harness/.env.local (E2E_DB_*)'
            : `revisar VPN y harness/.env.${target} (E2E_DB_*)` };
    if (!options.database) return check;
    if (target === 'local' && !isLoopback(host)) return { ...check, detail: 'target local apunta a una base remota; no se consultó' };
    const started = Date.now();
    let connection: Awaited<ReturnType<typeof mysql.createConnection>> | undefined;
    try {
        connection = await mysql.createConnection({ ...options, connectTimeout: timeoutMs });
        const remainingMs = timeoutMs - (Date.now() - started);
        if (remainingMs <= 0) throw new DOMException('espera agotada', 'TimeoutError');
        await connection.query({ sql: 'SELECT 1 AS harness_health', timeout: remainingMs });
        check.state = 'ok';
        check.detail = 'conexión, autenticación y SELECT 1 correctos; no comprueba el esquema';
    } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        const cause = networkState(error);
        check.state = cause.state;
        check.detail = cause.state !== 'timeout' && /^(ER_|PROTOCOL_)/.test(code) ? `MySQL rechazó la sonda (${code})` : cause.detail;
    } finally {
        // destroy no espera una respuesta QUIT de un servidor que puede haber dejado de responder.
        connection?.destroy();
    }
    return { ...check, ms: Date.now() - started };
}

async function probePort(port: number, timeoutMs: number): Promise<{ state: HealthState; detail: string }> {
    return new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port });
        const finish = (value: { state: HealthState; detail: string }) => { socket.destroy(); resolve(value); };
        socket.setTimeout(timeoutMs, () => finish({ state: 'timeout', detail: 'el puerto no contestó a tiempo' }));
        socket.once('connect', () => finish({ state: 'ok', detail: 'puerto accesible; no valida la respuesta del mock' }));
        socket.once('error', (error) => finish(networkState(error)));
    });
}

/** Rechaza typos ANTES de consultar nada: un mock desconocido nunca equivale a uno opcional. */
export function validateRequiredMocks(target: string, ids: string[]): void {
    if (ids.length && target !== 'local') throw new Error('los mocks sólo se consultan con TARGET=local');
    for (const id of ids) if (!MOCKS.some((mock) => mock.id === id)) throw new Error(`mock desconocido: ${id}`);
}

export async function environmentHealth(opts: HealthOptions): Promise<{ ok: boolean; checks: HealthCheck[] }> {
    if (!['local', 'dev', 'qa', 'staging'].includes(opts.target)) throw new Error('target no admitido para sondas: local, dev, qa o staging');
    const required = new Set(opts.requiredMocks ?? []);
    validateRequiredMocks(opts.target, [...required]);
    const timeoutMs = opts.timeoutMs ?? 5000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeoutMs debe estar entre 1 y 60000');
    const backendFix = opts.target === 'local' ? 'make -C ../github/legacy-backend up'
        : `revisar VPN y harness/.env.${opts.target} (E2E_API_BASE_URL/E2E_MOCK_URL)`;
    const checks = await Promise.all([
        probeHttp({ id: 'backend', url: `${opts.backend.replace(/\/+$/, '')}/api/`, target: opts.target,
            fix: backendFix, timeoutMs, expectPing: true,
            errorFix: opts.target === 'local' ? 'make -C ../github/legacy-backend logs; revisar harness/.env.local (API)' : backendFix }),
        probeHttp({ id: 'wizard', url: opts.wizard, target: opts.target,
            fix: ['local', 'dev'].includes(opts.target) ? `make harness-wizard TARGET=${opts.target}`
                : `revisar el despliegue del wizard y harness/.env.${opts.target} (E2E_BASE_URL)`, timeoutMs }),
        probeDatabase(opts.database, opts.target, timeoutMs),
        ...(opts.target === 'local' ? MOCKS.map(async (mock): Promise<HealthCheck> => {
            const start = Date.now();
            return { id: `mock-${mock.id}`, endpoint: `127.0.0.1:${mock.port}`, required: required.has(mock.id),
                ...await probePort(mock.port, timeoutMs), ms: Date.now() - start, fix: `harness/bin/mock-${mock.id} start` };
        }) : []),
    ]);
    return { ok: checks.every((c) => !c.required || c.state === 'ok'), checks };
}

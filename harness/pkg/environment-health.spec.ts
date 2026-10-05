// Lo peligroso es un diagnóstico tranquilizador equivocado: HTTP 500, una página HTML,
// una redirección a otro host y un timeout no pueden significar «API lista».
import { test, expect } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { probeHttp, probeDatabase, validateRequiredMocks, environmentHealth } from './environment-health.ts';

const servers: Server[] = [];
test.afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    })));
});

async function server(handler: (response: ServerResponse, method: string, path: string) => void): Promise<string> {
    const service = createServer((req, res) => handler(res, req.method ?? '', req.url ?? ''));
    servers.push(service);
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(service.address() as { port: number }).port}`;
}

const backend = (url: string, timeoutMs = 1000) => probeHttp({
    id: 'backend', url, target: 'local', fix: 'make up', timeoutMs, expectPing: true,
});

test('identifica el backend con GET y el ping del contrato real', async () => {
    const calls: string[] = [];
    const base = await server((res, method, path) => {
        calls.push(`${method} ${path}`);
        res.end(JSON.stringify({ ping: 'Pong!' }));
    });
    expect((await backend(`${base}/api/`)).state).toBe('ok');
    expect(calls).toEqual(['GET /api/']);
});

for (const status of [401, 404, 500, 503]) {
    test(`HTTP ${status} no es un backend sano aunque el cuerpo diga Pong`, async () => {
        const base = await server((res) => { res.writeHead(status); res.end('{"ping":"Pong!"}'); });
        const result = await backend(base);
        expect(result.state).toBe('http-error');
        expect(result.detail).toContain(String(status));
    });
}

for (const body of ['<html>Login</html>', '{}', '{"ping":"otra API"}']) {
    test(`200 con ${body} no identifica al backend`, async () => {
        const base = await server((res) => res.end(body));
        expect((await backend(base)).state).toBe('wrong-service');
    });
}

test('no sigue la redirección del backend ni consulta el host de destino', async () => {
    let reached = false;
    const destination = await server((res) => { reached = true; res.end('{"ping":"Pong!"}'); });
    const base = await server((res) => { res.writeHead(302, { location: destination }); res.end(); });
    expect((await backend(base)).state).toBe('http-error');
    expect(reached).toBe(false);
});

test('el wizard admite una redirección sin seguir el login', async () => {
    const base = await server((res) => { res.writeHead(302, { location: 'https://example.invalid/login' }); res.end(); });
    const result = await probeHttp({ id: 'wizard', url: base, target: 'local', fix: 'make wizard', timeoutMs: 1000 });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('no comprueba');
});

test('esperar demasiado no equivale a una conexión rechazada', async () => {
    const base = await server(() => {});
    expect((await backend(base, 100)).state).toBe('timeout');
    const service = servers.pop()!;
    service.closeAllConnections();
    await new Promise<void>((resolve) => service.close(() => resolve()));
    expect((await backend(base)).state).toBe('unreachable');
});

test('el timeout sigue activo cuando llegaron cabeceras pero falta el cuerpo', async () => {
    const base = await server((res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); });
    expect((await backend(base, 100)).state).toBe('timeout');
});

test('local rechaza un backend remoto antes de consultarlo', async () => {
    const result = await backend('https://example.invalid/api/');
    expect(result.state).toBe('invalid-config');
    expect(result.detail).toContain('no se consultó');
});

for (const url of ['esto-no-es-url', 'file:///etc/passwd']) {
    test(`rechaza URL inválida o protocolo ajeno: ${url}`, async () => {
        expect((await backend(url)).state).toBe('invalid-config');
    });
}

test('el diagnóstico no expone credenciales ni parámetros de la URL', async () => {
    const result = await backend('http://private-user:private-pass@127.0.0.1:1/api/?token=private-token');
    expect(result.endpoint).toBe('http://127.0.0.1:1/api/');
    expect(JSON.stringify(result)).not.toMatch(/private-/);
});

test('local rechaza una base remota y una configuración sin schema', async () => {
    expect((await probeDatabase({ host: 'example.invalid', database: 'creditop' }, 'local', 100)).detail).toContain('no se consultó');
    expect((await probeDatabase({ host: '127.0.0.1' }, 'local', 100)).state).toBe('invalid-config');
});

test('un puerto MySQL abierto sin handshake no puede quedar en verde ni colgar la sonda', async () => {
    const connections = new Set<import('node:net').Socket>();
    const service = createTcpServer((socket) => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    try {
        const result = await probeDatabase({ host: '127.0.0.1', database: 'test', port: (service.address() as { port: number }).port }, 'local', 100);
        expect(result.state).toBe('timeout');
    } finally {
        for (const socket of connections) socket.destroy();
        await new Promise<void>((resolve) => service.close(() => resolve()));
    }
});

test('un typo de mock o exigir mocks remotos falla antes de consultar', async () => {
    expect(() => validateRequiredMocks('local', ['burreau'])).toThrow('mock desconocido');
    expect(() => validateRequiredMocks('dev', ['bureaus'])).toThrow('sólo se consultan');
    await expect(environmentHealth({ target: 'local', backend: '', wizard: '', database: {}, requiredMocks: ['burreau'] })).rejects.toThrow('mock desconocido');
    expect(() => validateRequiredMocks('local', ['bureaus', 'pdf-mapper'])).not.toThrow();
});

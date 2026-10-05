import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../../../harness/', import.meta.url));
const reserved = createTcpServer();
await new Promise((resolve) => reserved.listen(0, '127.0.0.1', resolve));
const absentPort = reserved.address().port;
await new Promise((resolve) => reserved.close(resolve));
let status = 200;
let ping = 'Pong!';
const fixture = createServer((req, res) => {
    if (req.url === '/api/') {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ping }));
    } else {
        res.writeHead(302, { location: '/login' });
        res.end();
    }
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fixture.address().port}`;
const results = [];
async function run(name, extra, expectedExit, expectedState) {
    const child = spawn(process.execPath, ['bin/preflight.ts', 'local', '--live', '--json', ...extra], {
        cwd, env: { ...process.env, E2E_API_BASE_URL: base, E2E_MOCK_URL: base, E2E_BASE_URL: base,
            MOCK_FINHEALTH_PORT: String(absentPort) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (buffer) => out += buffer);
    child.stderr.on('data', (buffer) => err += buffer);
    const code = await new Promise((resolve) => child.once('close', resolve));
    const data = JSON.parse(out);
    const backend = data.health?.checks.find((c) => c.id === 'backend');
    const absent = data.health?.checks.find((c) => c.id === 'mock-financial-health');
    if (code !== expectedExit || (expectedState && backend?.state !== expectedState)) {
        throw new Error(`${name}: code ${code}, backend ${backend?.state}, stderr ${err}`);
    }
    results.push({ name, expectedExit, observedExit: code, ok: data.ok,
        ...(backend ? { backendState: backend.state } : {}),
        ...(absent ? { absentMock: { required: absent.required, state: absent.state } } : {}),
        ...(data.error ? { error: data.error } : {}) });
}
try {
    await run('mock opcional caído permite continuar', [], 0, 'ok');
    await run('mock requerido caído impide continuar', ['--mocks', 'financial-health'], 1, 'ok');
    status = 500;
    await run('HTTP 500 impide continuar', [], 1, 'http-error');
    status = 200; ping = 'otra API';
    await run('HTTP 200 de otra API impide continuar', [], 1, 'wrong-service');
    await run('typo de mock produce JSON y código 2', ['--mocks', 'unknown-mock'], 2);
    await run('tiempo inválido produce JSON y código 2', ['--timeout-ms', '0'], 2);
    const report = { observedAt: new Date().toISOString(),
        scope: 'API y wizard efímeros; MySQL local real con SELECT 1; sin mutaciones', results };
    if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
}

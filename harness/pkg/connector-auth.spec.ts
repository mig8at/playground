import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { advisorSession } from '../../connectors/advisor/session.ts';
import { advisorTarget, sessionFile, readSession, writeSession, removeSession, cookieHeaderFor, probeSession, type StoredSession } from '../../connectors/auth/sessions.ts';
import { loginOnPage } from '../../connectors/advisor/login.ts';

// Sólo servidores efímeros locales y una identidad de fixture; ningún ambiente real ni credencial antigua.
test.describe.configure({ mode: 'serial' });
let server: Server, origin: string;
let response = { status: 302, location: '/merchant/abcdef12', cookies: [] as string[], requestedCookie: '' };
let previousUser: string | undefined, previousPass: string | undefined;
let onRequest: (() => void) | undefined;
function session(): StoredSession {
    return { version: 1, kind: 'advisor', target: 'qa', origin, user: 'fixture@example.test', who: null,
        createdAt: '2026-10-05T00:00:00.000Z',
        cookies: [{ name: '_at', value: 'old', domain: '127.0.0.1', path: '/', expires: Date.now()/1000+300, httpOnly: true, secure: false, sameSite: 'Lax' }],
        origins: [{ origin, localStorage: [{ name: 'fixture-state', value: 'preserved' }] }] };
}

test.beforeAll(async () => {
    server = createServer((req, res) => {
        response.requestedCookie = req.headers.cookie ?? '';
        if (onRequest) { const action = onRequest; onRequest = undefined; action(); }
        res.setHeader('content-type', 'text/html');
        if (req.url?.startsWith('/login')) {
            if (req.method === 'POST') {
                res.writeHead(302, { location: '/merchant/abcdef12', 'set-cookie': ['_at=browser; Max-Age=300; Path=/; HttpOnly; SameSite=Lax', '_session=fixture; Path=/; HttpOnly; SameSite=Lax'] }); res.end(); return;
            }
            const two = req.url.startsWith('/login-two');
            res.end(`<form method="post"><input name="username"><input name="password" type="password" ${two ? 'hidden' : ''}>
                ${two ? '<button type="button" onclick="document.querySelector(\'input[name=password]\').hidden=false;this.hidden=true;document.querySelector(\'button[type=submit]\').hidden=false">Next</button>' : ''}
                <button type="submit" ${two ? 'hidden' : ''}>${two ? 'Continue' : 'Sign in'}</button></form>`); return;
        }
        if (req.url === '/merchant/abcdef12') {
            res.end('<html><script>localStorage.setItem("fixture-state","browser")</script>Autenticado</html>'); return;
        }
        res.writeHead(response.status, { ...(response.location ? { location: response.location } : {}), ...(response.cookies.length ? { 'set-cookie': response.cookies } : {}) }); res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    expect(existsSync(advisorSession('qa', origin).path)).toBe(false);
});
test.beforeEach(() => {
    onRequest = undefined;
    previousUser = process.env.ADVISOR_USER; previousPass = process.env.ADVISOR_PASS;
    process.env.ADVISOR_USER = 'fixture@example.test'; process.env.ADVISOR_PASS = 'fixture-only';
    response = { status: 302, location: '/merchant/abcdef12', cookies: [], requestedCookie: '' };
});
test.afterEach(() => {
    removeSession('advisor', 'qa', origin);
    if (previousUser === undefined) delete process.env.ADVISOR_USER; else process.env.ADVISOR_USER = previousUser;
    if (previousPass === undefined) delete process.env.ADVISOR_PASS; else process.env.ADVISOR_PASS = previousPass;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

test('el origen completo aísla puerto, protocolo y ambiente; local/dev comparten el front conocido', () => {
    expect(sessionFile('advisor', 'local', 'http://localhost:5174')).toBe(sessionFile('advisor', 'dev', 'http://localhost:5174'));
    expect(sessionFile('advisor', 'dev', 'http://localhost:5174')).not.toBe(sessionFile('advisor', 'dev', 'http://localhost:5175'));
    expect(sessionFile('advisor', 'dev', origin)).not.toBe(sessionFile('advisor', 'qa', origin));
    expect(sessionFile('advisor', 'qa', origin)).not.toBe(sessionFile('advisor', 'qa', origin.replace('http:', 'https:')));
    expect(() => advisorTarget('prod', origin)).toThrow();
    expect(() => sessionFile('admin', '../../outside', origin)).toThrow();
});

test('el mismo archivo contiene identidad, cookies y localStorage y se guarda privado', () => {
    const s = session(); const path = writeSession(s);
    expect(path).toContain('/connectors/.auth/sessions/');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSession('advisor', 'qa', origin)).toEqual(s);
    expect(readSession('advisor', 'qa', origin)?.origins).toEqual(session().origins);
});

test('cambiar de cuenta no reusa la anterior ni la atribuye al nuevo usuario', () => {
    const path = writeSession(session()); const before = readFileSync(path, 'utf8');
    process.env.ADVISOR_USER = 'another@example.test';
    expect(advisorSession('qa', origin).storageState()).toBeUndefined();
    expect(readFileSync(path, 'utf8')).toBe(before);
});

test('un archivo sin identidad o con origen cambiado no es una sesión reutilizable', () => {
    const path = writeSession(session());
    writeFileSync(path, JSON.stringify({ cookies: session().cookies, origins: [] }));
    expect(advisorSession('qa', origin).storageState()).toBeUndefined();
    writeFileSync(path, JSON.stringify({ ...session(), origin: 'https://other.test' }));
    expect(readSession('advisor', 'qa', origin)).toBeNull();
});

test('las cookies vencidas, secure y las rutas parciales no viajan en la renovación', () => {
    const cookies = session().cookies;
    cookies.push({ ...cookies[0], name: 'expired', expires: 100 }, { ...cookies[0], name: 'scope', path: '/merch' }, { ...cookies[0], name: 'tls', secure: true });
    expect(cookieHeaderFor(cookies, origin + '/merchant', 100)).toBe('_at=old');
});

test('cerrar sesión invalida estado y salud de todos los adaptadores', () => {
    const a = advisorSession('qa', origin), b = advisorSession('qa', origin);
    writeSession(session()); expect(a.storageState()).toBe(b.path);
    expect(removeSession('advisor', 'qa', origin)).toBe(true);
    expect(a.storageState()).toBeUndefined(); expect(b.sessionHealth().hay).toBe(false);
});

test('HTTP 500 indica servidor no verificable, no sesión vencida', async () => {
    response.status = 500; response.location = '';
    expect((await probeSession(session())).valid).toBeNull();
});

test('la renovación mantiene identidad y localStorage y filtra contexto efímero', async () => {
    const path = writeSession(session());
    response.cookies = ['_at=new; Max-Age=300; Path=/; HttpOnly; SameSite=Lax', 'merchant_context=other; Max-Age=86400; Path=/'];
    const result = await advisorSession('qa', origin).refreshSession();
    expect(result.ok).toBe(true); expect(result.sucursal).toBe('abcdef12');
    const after = readSession('advisor', 'qa', origin)!;
    expect(after.user).toBe('fixture@example.test'); expect(after.createdAt).toBe(session().createdAt);
    expect(after.cookies.map(c => c.value)).toEqual(['new']); expect(after.origins).toEqual(session().origins);
    expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('una respuesta que borra cookies y vuelve al login conserva el archivo', async () => {
    const path = writeSession(session()); const before = readFileSync(path, 'utf8');
    response.location = '/login?reason=expired'; response.cookies = ['_at=; Max-Age=0; Path=/'];
    expect((await advisorSession('qa', origin).refreshSession({ repin: true })).ok).toBe(false);
    expect(response.requestedCookie).not.toContain('_at=');
    expect(readFileSync(path, 'utf8')).toBe(before);
});

test('repin omite access sólo en la petición y conserva el token si no hay reemplazo', async () => {
    const s = session(); s.cookies.push({ ...s.cookies[0], name: '_rt', value: 'refresh' }); writeSession(s);
    response.cookies = ['other=fresh; Max-Age=100; Path=/'];
    expect((await advisorSession('qa', origin).refreshSession({ repin: true })).ok).toBe(true);
    expect(response.requestedCookie).toBe('_rt=refresh');
    expect(readSession('advisor', 'qa', origin)?.cookies.find(c => c.name === '_at')?.value).toBe('old');
});

for (const form of ['classic', 'two-step']) {
    test(`login ${form}: guarda sesión y Playwright restaura ese único archivo`, async ({ browser }) => {
        const context = await browser.newContext(); const page = await context.newPage();
        await page.goto(origin + (form === 'classic' ? '/login' : '/login-two'));
        const a = advisorSession('qa', origin);
        await a.login(page, 'fixture@example.test', 'fixture-only');
        const state = readSession('advisor', 'qa', origin)!;
        expect(state.user).toBe('fixture@example.test'); expect(state.origins?.[0].localStorage[0].value).toBe('browser');
        const restored = await browser.newContext({ storageState: a.storageState() });
        expect((await restored.cookies(origin)).some(c => c.name === '_at' && c.value === 'browser')).toBe(true);
        expect((await restored.cookies(origin)).find(c => c.name === '_session')?.expires).toBe(-1);
        const p = await restored.newPage(); await p.goto(origin + '/merchant/abcdef12');
        expect(await p.evaluate(() => localStorage.getItem('fixture-state'))).toBe('browser');
        await restored.close(); await context.close();
    });
}

test('la sonda de un asesor de prueba no toca la sesión compartida', async ({ browser }) => {
    const path = writeSession(session()); const before = readFileSync(path, 'utf8');
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(origin + '/login');
    await loginOnPage(page, 'test-advisor@example.test', 'fixture-only', new URL(origin).host);
    expect(readFileSync(path, 'utf8')).toBe(before); await context.close();
});

test('la consola distingue servidor caído y conserva el JSON sin secretos', async () => {
    response.status = 500; response.location = '';
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
        const p = spawn(process.execPath, ['../connectors/advisor/cli.ts', 'check', '--target', 'qa', '--origin', origin]);
        let stdout = '', stderr = ''; p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
        p.on('close', code => resolve({ code, stdout, stderr }));
    });
    expect(result.code).toBe(0); expect(JSON.parse(result.stdout).status).toBe('unreachable');
    expect(result.stdout + result.stderr).not.toContain('fixture-only');
});

test('config usa ADVISOR_USER y permite consultas de producción sin login', async () => {
    async function configuredUser(target: string): Promise<string> {
        return await new Promise<string>((resolve, reject) => {
            const p = spawn(process.execPath, ['--input-type=module', '-e', 'import { cognitoCreds } from "./pkg/config.ts"; console.log(JSON.stringify({ user: cognitoCreds.user ?? null }))'], {
                env: { ...process.env, E2E_TARGET: target, E2E_COGNITO_USER: 'legacy@example.test', E2E_COGNITO_PASS: 'legacy-ignored' }
            });
            let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
            p.on('close', code => code === 0 ? resolve(out) : reject(new Error(err)));
        });
    }
    expect(JSON.parse(await configuredUser('qa')).user).toBe('fixture@example.test');
    expect(JSON.parse(await configuredUser('prod')).user).toBeNull();
});

test('cerrar sesión mientras llega una renovación no resucita el archivo', async () => {
    const path = writeSession(session());
    response.cookies = ['_at=rotated; Max-Age=300; Path=/'];
    onRequest = () => { removeSession('advisor', 'qa', origin); };
    expect((await advisorSession('qa', origin).refreshSession()).ok).toBe(false);
    expect(existsSync(path)).toBe(false);
});

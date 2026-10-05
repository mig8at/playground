// open-admin.ts — abre el ADMIN de `legacy-application` en una ventana propia.
//
//   node dev/open-admin.ts [ruta] [target]      · ruta por defecto: /aliados · target: E2E_TARGET o local
//
// PARA QUÉ: ver con los ojos lo que un cambio hizo en el admin, sin levantar nada ni buscar la URL.
// El panel tiene un botón que llama a esto y le pasa el target que esté elegido.
//
// ── LOCAL ENTRA SIN CONTRASEÑA, LOS REMOTOS NO ─────────────────────────────────────────────────────
//
// En local `bin/admin-session` emite una sesión con el guard real de Laravel y acá se inyecta la cookie.
// Se puede porque hay `artisan` a mano; el PHP además aborta si `APP_ENV` no es `local`.
//
// Contra dev y staging **no hay shell** en los contenedores: la sesión sale de `make harness-signin KIND=admin
// TARGET=<t>` (la guarda `pkg/sessions.ts`, de UNA persona, con las credenciales de su `connectors/.env.<t>`) y esta
// ventana la usa. Sin sesión guardada no entra: dice cómo conseguirla. Nunca cae a la credencial de otra persona.
//
// ⚠ Producción NO está en la lista, y es a propósito. Esto es el panel con el que se corren flujos de
// prueba; un click al admin de producción al lado del botón de correr un caso es un accidente esperando.
// Si hace falta entrar a prod, se entra por el navegador de siempre.
//
// ⚠ La cookie de local va con `url`, NO con `domain`. Laravel la emite para `.localhost` y Chromium la
// DESCARTA: `.localhost` es sufijo público, así que un dominio con punto inicial no se le puede asignar a
// `admin.localhost`. Con `url` Playwright deriva host y path del origen real y sí la manda.
//
// ⚠ Y el admin local se sirve en `admin.localhost:8000`, no en `localhost:8000`: Laravel compara el
// dominio de la ruta con `getHost()`, que excluye el puerto, así que con `localhost` todo da 404.

import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
import { chromium } from '@playwright/test';

const ADMIN_APP = '/Users/miguelochoa/Desktop/CREDITOP/github/legacy-application';
const PORT = 8000;

/**
 * Dónde vive el admin de cada ambiente. Comprobado el 2026-08-26: los tres responden 200 y el HTML del
 * login de dev y el de staging DIFIEREN, así que no son un alias — son dos despliegues.
 *
 * Producción queda afuera a propósito (ver la cabecera).
 */
const ADMINS: Record<string, string> = {
    local: `http://admin.localhost:${PORT}`,
    dev: 'https://admin.dev.creditop.com',
    staging: 'https://admin.staging.creditop.com',
};

const PATH = process.argv[2] || '/aliados';
const TARGET = (process.argv[3] || process.env.E2E_TARGET || 'local').trim();
const BASE = ADMINS[TARGET];
const IS_LOCAL = TARGET === 'local';

const answers = async (): Promise<boolean> => {
    try {
        const r = await fetch(BASE, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
        return r.status > 0;
    } catch { return false; }
};

/**
 * Levanta el dev server de Vite del admin si no está.
 *
 * Sin esto el admin sirve el bundle COMPILADO, que puede tener meses: verías la pantalla vieja y
 * pensarías que tu cambio no funcionó. Con Vite corriendo, Laravel detecta el archivo `hot` y sirve los
 * assets al vuelo, así que lo que ves es tu working copy.
 *
 * No es bloqueante: si Vite no arranca, el admin igual abre —sólo que con el bundle viejo— y se avisa.
 */
async function startViteIfNeeded(): Promise<void> {
    const vitePort = 5173;
    const alive = async () => {
        try { await fetch(`http://localhost:${vitePort}`, { signal: AbortSignal.timeout(1500) }); return true; }
        catch { return false; }
    };

    if (await alive()) { console.log('  · vite del admin ya estaba arriba'); return; }

    console.log('  · levantando vite del admin (para ver el front sin compilar)…');
    const child = spawn('npm', ['run', 'dev'], { cwd: ADMIN_APP, detached: true, stdio: 'ignore' });
    child.unref();

    for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await alive()) { console.log('  · vite arriba'); return; }
    }
    console.warn('  ⚠ vite no arrancó: vas a ver el bundle COMPILADO, que puede no tener tus cambios');
}

async function startIfNeeded(): Promise<boolean> {
    if (await answers()) {
        console.log(`  · el admin ya estaba en :${PORT}`);
        return true;
    }

    console.log(`  · el admin no responde; levantándolo…`);
    // detached + unref: sobrevive a este proceso, así la ventana no se queda sin servidor al cerrarse.
    const child = spawn('php', ['artisan', 'serve', `--host=127.0.0.1`, `--port=${PORT}`], {
        cwd: ADMIN_APP, detached: true, stdio: 'ignore',
    });
    child.unref();

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await answers()) { console.log(`  · arriba en :${PORT}`); return true; }
    }
    return false;
}

(async () => {
    if (!BASE) {
        console.error(`  ✗ no sé dónde vive el admin de «${TARGET}». Los que conozco: ${Object.keys(ADMINS).join(', ')}.`);
        console.error(`    Producción no está a propósito: entrá por tu navegador de siempre.`);
        process.exit(1);
    }

    // ── Los remotos: se abre con la sesión GUARDADA ───────────────────────────────────────────────
    // Sin contraseña y sin perfil de navegador: la sesión sale de `make harness-signin KIND=admin TARGET=<t>` (la que
    // guarda `pkg/sessions.ts`, de UNA persona, con sus credenciales de `connectors/`). Esta ventana sólo la usa.
    if (!IS_LOCAL) {
        const { runPg } = await import('../pkg/pg.ts');
        runPg(['admin', 'status', '--target', TARGET, '--json']); // migra una sesión anterior con identidad conocida
        const { readSession } = await import('../pkg/sessions.ts');
        const stored = readSession('admin', TARGET);
        if (!stored) {
            console.error(`  ✖ no hay sesión de admin guardada para ${TARGET}. Entra con:\n      make harness-signin KIND=admin TARGET=${TARGET}`);
            process.exit(1);
        }
        console.log(`  · admin de ${TARGET}: ${BASE}`);
        console.log(`  · sesión guardada de ${stored.who ?? stored.user} (${stored.user})`);

        let browser;
        try { browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=0,0'] }); }
        catch { browser = await chromium.launch({ headless: false, args: ['--window-position=0,0'] }); }
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await ctx.addCookies(stored.cookies.map((c) => ({
            name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
            httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite ?? 'Lax',
        })));
        const pageObj = await ctx.newPage();
        await pageObj.goto(BASE + PATH, { waitUntil: 'domcontentloaded' });

        console.log(pageObj.url().includes('/login')
            ? `  ✖ el admin mandó al login: la sesión venció. Vuelve a entrar con  make harness-signin KIND=admin TARGET=${TARGET}`
            : `  ✓ abierto en ${pageObj.url()}`);

        await new Promise<void>((resolve) => {
            pageObj.on('close', () => resolve());
            browser.on('disconnected', () => resolve());
        });
        console.log('  · ventana cerrada');
        process.exit(0);
    }

    // ── Local: entra sin contraseña ───────────────────────────────────────────────────────────────
    if (!await startIfNeeded()) {
        console.error(`  ✗ no se pudo levantar el admin. Probá a mano:\n      cd ${ADMIN_APP} && php artisan serve --port=${PORT}`);
        process.exit(1);
    }

    await startViteIfNeeded();

    let session: { cookie: string; value: string; email: string; roles: string[] };
    try {
        session = JSON.parse(execFileSync(join(process.cwd(), 'bin/admin-session'), { encoding: 'utf8' }).trim());
    } catch (e) {
        console.error('  ✗ no se pudo emitir la sesión del admin:', String(e).slice(0, 200));
        process.exit(1);
    }
    console.log(`  · sesión de ${session.email} (${session.roles.join(', ')})`);

    const browser = await chromium.launch({ headless: false, args: ['--window-position=0,0'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{
        name: session.cookie, value: session.value, url: BASE,
        httpOnly: true, secure: false, sameSite: 'Lax',
    }]);

    const page = await context.newPage();
    await page.goto(BASE + PATH, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/login')) {
        console.error('  ✗ el admin mandó al login: la sesión no se aceptó (¿el dump local es de otro ambiente?)');
    } else {
        console.log(`  ✓ abierto en ${page.url()}`);
    }

    // La ventana se queda para vos: este proceso vive hasta que la cerrés.
    await new Promise<void>((resolve) => {
        page.on('close', () => resolve());
        browser.on('disconnected', () => resolve());
    });
    console.log('  · ventana cerrada');
    process.exit(0);
})();

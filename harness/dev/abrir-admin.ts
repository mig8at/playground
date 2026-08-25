// abrir-admin.ts — abre el ADMIN de `legacy-application` ya logueado, en una ventana propia.
//
//   node dev/abrir-admin.ts [ruta]        · ruta por defecto: /aliados
//
// PARA QUÉ: ver con los ojos lo que un cambio hizo en el admin, sin tipear una contraseña ni acordarse
// de levantar el servidor. El panel tiene un botón que llama a esto.
//
// CÓMO ENTRA SIN CONTRASEÑA: `bin/admin-sesion` emite una sesión con el guard real de Laravel y acá se
// inyecta la cookie en el contexto del navegador. Se hizo así porque la única credencial disponible es de
// staging y puede no corresponder al hash del dump local — y porque una contraseña no tiene por qué andar
// en un script.
//
// ⚠ La cookie va con `url`, NO con `domain`. Laravel la emite para `.localhost` y Chromium la DESCARTA:
// `.localhost` es sufijo público, así que un dominio con punto inicial no se le puede asignar a
// `admin.localhost`. Con `url` Playwright deriva host y path del origen real y sí la manda.
//
// ⚠ Y el admin se sirve en `admin.localhost:8000`, no en `localhost:8000`: Laravel compara el dominio de
// la ruta con `getHost()`, que excluye el puerto, así que con `localhost` todas las rutas dan 404.

import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ADMIN_APP = '/Users/miguelochoa/Desktop/CREDITOP/github/legacy-application';
const PUERTO = 8000;
const BASE = `http://admin.localhost:${PUERTO}`;
const RUTA = process.argv[2] || '/aliados';

const responde = async (): Promise<boolean> => {
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
async function levantarViteSiHaceFalta(): Promise<void> {
    const vitePuerto = 5173;
    const vivo = async () => {
        try { await fetch(`http://localhost:${vitePuerto}`, { signal: AbortSignal.timeout(1500) }); return true; }
        catch { return false; }
    };

    if (await vivo()) { console.log('  · vite del admin ya estaba arriba'); return; }

    console.log('  · levantando vite del admin (para ver el front sin compilar)…');
    const hijo = spawn('npm', ['run', 'dev'], { cwd: ADMIN_APP, detached: true, stdio: 'ignore' });
    hijo.unref();

    for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await vivo()) { console.log('  · vite arriba'); return; }
    }
    console.warn('  ⚠ vite no arrancó: vas a ver el bundle COMPILADO, que puede no tener tus cambios');
}

async function levantarSiHaceFalta(): Promise<boolean> {
    if (await responde()) {
        console.log(`  · el admin ya estaba en :${PUERTO}`);
        return true;
    }

    console.log(`  · el admin no responde; levantándolo…`);
    // detached + unref: sobrevive a este proceso, así la ventana no se queda sin servidor al cerrarse.
    const hijo = spawn('php', ['artisan', 'serve', `--host=127.0.0.1`, `--port=${PUERTO}`], {
        cwd: ADMIN_APP, detached: true, stdio: 'ignore',
    });
    hijo.unref();

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await responde()) { console.log(`  · arriba en :${PUERTO}`); return true; }
    }
    return false;
}

(async () => {
    if (!await levantarSiHaceFalta()) {
        console.error(`  ✗ no se pudo levantar el admin. Probá a mano:\n      cd ${ADMIN_APP} && php artisan serve --port=${PUERTO}`);
        process.exit(1);
    }

    await levantarViteSiHaceFalta();

    let sesion: { cookie: string; value: string; email: string; roles: string[] };
    try {
        sesion = JSON.parse(execFileSync(join(process.cwd(), 'bin/admin-sesion'), { encoding: 'utf8' }).trim());
    } catch (e) {
        console.error('  ✗ no se pudo emitir la sesión del admin:', String(e).slice(0, 200));
        process.exit(1);
    }
    console.log(`  · sesión de ${sesion.email} (${sesion.roles.join(', ')})`);

    const browser = await chromium.launch({ headless: false, args: ['--window-position=0,0'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{
        name: sesion.cookie, value: sesion.value, url: BASE,
        httpOnly: true, secure: false, sameSite: 'Lax',
    }]);

    const page = await context.newPage();
    await page.goto(BASE + RUTA, { waitUntil: 'domcontentloaded' });

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

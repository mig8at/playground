// open-admin.ts — abre el ADMIN de `legacy-application` en una ventana propia.
//
//   node dev/open-admin.ts [ruta] [target]      · ruta por defecto: /aliados · target: E2E_TARGET o local
//
// PARA QUÉ: ver con los ojos lo que un cambio hizo en el admin, sin levantar nada ni buscar la URL.
// El panel tiene un botón que llama a esto y le pasa el target que esté elegido. La vista «Admin» del panel muestra lo
// mismo dentro de una PC (`panel/devices.ts`); las dos entran por `pkg/admin-access.ts`: dónde vive el admin de cada
// ambiente, cómo se entra en local sin contraseña, de dónde sale la sesión de los remotos y por qué producción no está.
import { chromium } from '@playwright/test';
import { adminSession, ensureLocalAdmin, ADMIN_APP } from '../pkg/admin-access.ts';

const PATH = process.argv[2] || '/aliados';
const TARGET = (process.argv[3] || process.env.E2E_TARGET || 'local').trim();

(async () => {
    if (TARGET === 'local' && !await ensureLocalAdmin((l) => console.log('  · ' + l))) {
        console.error(`  ✗ no se pudo levantar el admin. Probá a mano:\n      cd ${ADMIN_APP} && php artisan serve --port=8000`);
        process.exit(1);
    }
    const s = await adminSession(TARGET);
    if (!s.ok) { console.error('  ✖ ' + s.error); process.exit(1); }
    console.log(`  · admin de ${s.target}: ${s.base}`);
    console.log(`  · sesión de ${s.who}`);

    let browser;
    try { browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=0,0'] }); }
    catch { browser = await chromium.launch({ headless: false, args: ['--window-position=0,0'] }); }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(s.cookies);
    const page = await context.newPage();
    await page.goto(s.base + PATH, { waitUntil: 'domcontentloaded' });

    console.log(page.url().includes('/login')
        ? (s.target === 'local'
            ? '  ✗ el admin mandó al login: la sesión no se aceptó (¿el dump local es de otro ambiente?)'
            : `  ✖ el admin mandó al login: la sesión venció. Volvé a entrar con  make harness-signin KIND=admin TARGET=${s.target}`)
        : `  ✓ abierto en ${page.url()}`);

    // La ventana se queda para vos: este proceso vive hasta que la cerrés.
    await new Promise<void>((resolve) => {
        page.on('close', () => resolve());
        browser.on('disconnected', () => resolve());
    });
    console.log('  · ventana cerrada');
    process.exit(0);
})();

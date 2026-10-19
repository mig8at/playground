// admin-access.ts — dónde vive el ADMIN de `legacy-application` en cada ambiente y con qué sesión se entra.
//
// Lo comparten la ventana suelta (`dev/open-admin.ts`, el botón «admin ↗») y la PC del panel (`panel/devices.ts`, la
// vista «Admin»): las dos tienen que entrar igual, o una aprende algo que la otra no.
//
// ── LOCAL ENTRA SIN CONTRASEÑA, LOS REMOTOS NO ─────────────────────────────────────────────────────
// En local `bin/admin-session` emite una sesión con el guard real de Laravel (hay `artisan` a mano; el PHP aborta si
// `APP_ENV` no es `local`). Contra dev y staging no hay shell en los contenedores: la sesión sale de
// `make harness-signin KIND=admin TARGET=<t>` (la guarda `connectors/`, de UNA persona) y acá sólo se usa. Sin sesión
// guardada no entra: dice cómo conseguirla. Nunca cae a la credencial de otra persona.
//
// ⚠ Producción NO está, a propósito: un admin de producción al lado del botón de correr un caso es un accidente esperando.
// ⚠ qa no tiene admin propio (`admin.qa.creditop.com` no resuelve): comparte la base con dev, así que va al de dev.
// ⚠ La cookie de local va con `url`, NO con `domain`: Laravel la emite para `.localhost` y Chromium la descarta
//   (`.localhost` es sufijo público). Con `url` Playwright deriva host y path del origen real.
// ⚠ Y el admin local se sirve en `admin.localhost:8000`, no en `localhost:8000`: Laravel compara el dominio de la ruta
//   con `getHost()`, que excluye el puerto, así que con `localhost` todo da 404.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_APP = '/Users/miguelochoa/Desktop/CREDITOP/github/legacy-application';
const PORT = 8000;

/** Comprobado el 2026-08-26: los tres responden y el login de dev y el de staging DIFIEREN (son dos despliegues). */
const ADMINS: Record<string, string> = {
    local: `http://admin.localhost:${PORT}`,
    dev: 'https://admin.dev.creditop.com',
    staging: 'https://admin.staging.creditop.com',
};

/** El ambiente cuyo admin se abre: qa usa el de dev (misma base). `null` si no hay admin para ese ambiente. */
export function adminTarget(target: string): string | null {
    const t = target === 'qa' ? 'dev' : target;
    return ADMINS[t] ? t : null;
}
export function adminBase(target: string): string | null {
    const t = adminTarget(target);
    return t ? ADMINS[t] : null;
}

/** Una cookie lista para `context.addCookies` de Playwright. */
export type AdminCookie = {
    name: string; value: string; url?: string; domain?: string; path?: string; expires?: number;
    httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None';
};

async function answers(url: string, ms = 2500): Promise<boolean> {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'manual' }); return r.status > 0; }
    catch { return false; }
}

/**
 * Levanta el dev server de Vite del admin si no está. Sin él el admin sirve el bundle COMPILADO, que puede tener meses:
 * verías la pantalla vieja y pensarías que tu cambio no funcionó. No es bloqueante: si no arranca, el admin igual abre.
 *
 * ⚠ SE PREGUNTA POR `public/hot`, NO POR EL PUERTO 5173. Laravel manda al navegador a buscar los assets a la URL que dice
 * ese archivo, y lo escribe el vite DEL ADMIN al arrancar (en el puerto que haya encontrado libre). Preguntar «¿responde
 * algo en :5173?» daba por arriba al wizard de otra sesión que ocupaba el puerto, con un `hot` viejo apuntando a un vite
 * muerto: el admin cargaba en BLANCO, con `ERR_CONNECTION_REFUSED` en la consola (2026-10-19).
 */
async function startViteIfNeeded(log: (line: string) => void): Promise<void> {
    const hotFile = join(ADMIN_APP, 'public', 'hot');
    const hotUrl = () => { try { return readFileSync(hotFile, 'utf8').trim(); } catch { return ''; } };
    const viteUp = async () => { const u = hotUrl(); return !!u && answers(`${u}/@vite/client`, 1500); };
    if (await viteUp()) { log(`vite del admin ya estaba arriba (${hotUrl()})`); return; }
    if (hotUrl()) log(`el vite del admin que dice public/hot (${hotUrl()}) no responde: lo levanto de nuevo`);
    else log('levantando vite del admin (para ver el front sin compilar)…');
    spawn('npm', ['run', 'dev'], { cwd: ADMIN_APP, detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await viteUp()) { log(`vite arriba (${hotUrl()})`); return; }
    }
    log('⚠ vite no arrancó: vas a ver el bundle COMPILADO, que puede no tener tus cambios');
    // Un `hot` que apunta a un vite muerto deja la página en blanco; sin él Laravel sirve el bundle compilado.
    try { if (hotUrl()) { unlinkSync(hotFile); log('borré el public/hot viejo: el admin usa el bundle compilado'); } } catch { }
}

/** El admin local arriba (`artisan serve` y vite). `detached` + `unref`: sobreviven a quien los lanzó. */
export async function ensureLocalAdmin(log: (line: string) => void = () => { }): Promise<boolean> {
    const base = ADMINS.local;
    if (await answers(base)) log(`el admin ya estaba en :${PORT}`);
    else {
        log('el admin no responde; levantándolo…');
        spawn('php', ['artisan', 'serve', '--host=127.0.0.1', `--port=${PORT}`], { cwd: ADMIN_APP, detached: true, stdio: 'ignore' }).unref();
        let up = false;
        for (let i = 0; i < 20 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await answers(base); }
        if (!up) return false;
        log(`arriba en :${PORT}`);
    }
    await startViteIfNeeded(log);
    return true;
}

/**
 * Las cookies con que se entra al admin de `target`, y quién es. En local se emite la sesión (el admin tiene que estar
 * arriba: `ensureLocalAdmin`); en los remotos se lee la guardada. Si no hay, `error` dice cómo conseguirla.
 */
export async function adminSession(target: string): Promise<{ ok: true; base: string; target: string; cookies: AdminCookie[]; who: string } | { ok: false; error: string }> {
    const t = adminTarget(target);
    if (!t) return { ok: false, error: `no hay admin para «${target}»: los que conozco son ${Object.keys(ADMINS).join(', ')} (qa usa el de dev). Producción no está, a propósito.` };
    const base = ADMINS[t];
    if (t === 'local') {
        try {
            const s = JSON.parse(execFileSync(join(process.cwd(), 'bin/admin-session'), { encoding: 'utf8' }).trim()) as { cookie: string; value: string; email: string; roles: string[] };
            return { ok: true, base, target: t, who: `${s.email} (${s.roles.join(', ')})`,
                cookies: [{ name: s.cookie, value: s.value, url: base, httpOnly: true, secure: false, sameSite: 'Lax' }] };
        } catch (e) {
            return { ok: false, error: 'no se pudo emitir la sesión del admin local: ' + String(e).split('\n')[0].slice(0, 200) };
        }
    }
    const { runPg } = await import('./pg.ts');
    runPg(['admin', 'status', '--target', t, '--json']);   // migra una sesión anterior con identidad conocida
    const { readSession } = await import('./sessions.ts');
    const stored = readSession('admin', t);
    if (!stored) return { ok: false, error: `no hay sesión de admin guardada para ${t}. Entrá con:  make harness-signin KIND=admin TARGET=${t}` };
    return { ok: true, base, target: t, who: `${stored.who ?? stored.user} (${stored.user})`,
        cookies: stored.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
            httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite ?? 'Lax' })) };
}

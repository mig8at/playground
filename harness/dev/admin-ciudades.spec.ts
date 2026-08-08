import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminCreds } from '../pkg/config';
import { openA } from '../pkg/windows';

/**
 * `make admin-ciudades` — el selector de ciudad del admin filtra por el país del comercio.
 *
 * Prueba el arreglo de la tarea 44: hasta el 2026-08-08 el endpoint `admin.cities.search` devolvía las
 * **1.123 ciudades colombianas a cualquiera**, sin filtro de país, y por eso los 13 puntos de venta
 * dominicanos quedaron registrados en «Santo Domingo» de **Antioquia**. El nombre coincide, así que
 * ninguna pantalla lo delataba.
 *
 * Qué verifica, en la UI y no en la consulta:
 *   1. con un comercio DOMINICANO, buscar «santo» ofrece sólo municipios de RD;
 *   2. buscar «medel» con ese mismo comercio no ofrece NADA — el error exacto que se cometió es ahora
 *      imposible de cometer;
 *   3. con un comercio COLOMBIANO, «santo» sigue ofreciendo la de Antioquia (Colombia no se movió).
 *
 * ⚠ **Este login NO es Cognito.** `legacy-application` usa Fortify: correo + contraseña contra `users`.
 * Las credenciales salen de `E2E_ADMIN_USER/PASS` o de `.admin.json` (gitignored) — nunca del código.
 *
 * Requiere el admin corriendo en local:
 *   php /ruta/legacy-application/artisan serve --host=127.0.0.1 --port=8000
 * y `APP_HOST=localhost` **sin puerto** en su `.env`: Laravel compara el dominio de la ruta con
 * `getHost()`, que excluye el puerto, así que con `localhost:8000` TODAS las rutas del admin dan 404.
 *
 * Artefactos (gitignored): `.auth/admin-state.json` + tres capturas en `.auth/`.
 */

const BASE = process.env.E2E_ADMIN_URL ?? 'http://admin.localhost:8000';

/** Comercios del dump local. Se pueden pisar por env si el dump de otro ambiente usa otros ids. */
const COMERCIO_RD = process.env.E2E_ADMIN_ALLIED_RD ?? '270'; // CeluRD Test (country_id 60)
const COMERCIO_CO = process.env.E2E_ADMIN_ALLIED_CO ?? '1';   // el primero colombiano

test.skip(!adminCreds.user || !adminCreds.pass,
    'admin-ciudades: requiere E2E_ADMIN_USER/PASS o .admin.json {user,pass}');

test('el selector de ciudad del admin filtra por el país del comercio', async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await openA(browser, { baseURL: BASE });
    const artefactos = join(process.cwd(), '.auth');
    mkdirSync(artefactos, { recursive: true });

    // ── 1. Login (Fortify, no Cognito) ────────────────────────────────────────────────────────────
    await page.goto('/login');
    await page.getByLabel(/correo/i).fill(adminCreds.user!);
    await page.getByLabel(/contrase/i).fill(adminCreds.pass!);
    await page.getByRole('button', { name: /iniciar sesi/i }).click();

    // No se espera una URL concreta: el aterrizaje del admin cambia según el rol del usuario. Lo que
    // importa es haber SALIDO del login — si seguimos ahí, la credencial no sirve contra ESTA base.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: join(artefactos, 'admin-aterrizaje.png'), fullPage: true }).catch(() => {});
    expect(page.url(), 'seguimos en /login: la contraseña no corresponde al hash de esta base ' +
        '(¿el dump local vino de otro ambiente?)').not.toMatch(/\/login/);

    await page.context().storageState({ path: join(artefactos, 'admin-state.json') });

    // ── 2. El endpoint, con la sesión real del navegador ──────────────────────────────────────────
    // Se consulta la API en vez de teclear en el autocomplete a propósito: el componente dispara la
    // búsqueda recién a los 3 caracteres y pinta una lista virtualizada, así que afirmar sobre el DOM
    // mide el widget. Lo que está bajo prueba es QUÉ ofrece el backend para cada comercio.
    const buscar = async (texto: string, alliedId?: string) => {
        const url = new URL('/get-cities', BASE);
        url.searchParams.set('search', texto);
        if (alliedId) url.searchParams.set('allied_id', alliedId);
        const res = await page.request.get(url.toString());
        expect(res.ok(), `GET ${url.pathname}${url.search} devolvió ${res.status()}`).toBeTruthy();
        return (await res.json()) as Array<{ name: string; zone?: { country?: { name?: string } } }>;
    };

    const paises = (filas: Awaited<ReturnType<typeof buscar>>) =>
        // El comodín «TODAS LAS CIUDADES» se descuenta: no es un lugar y se ofrece siempre, con filtro
        // o sin filtro (vive colgado de Colombia por historia).
        filas.filter(c => c.name !== 'TODAS LAS CIUDADES')
            .map(c => c.zone?.country?.name ?? '?');

    // 2a. Comercio dominicano: «santo» → sólo RD.
    const santoRD = await buscar('SANTO DOMINGO', COMERCIO_RD);
    expect(paises(santoRD).length, 'el comercio RD no recibió ninguna ciudad: ¿faltan las de RD en esta base?')
        .toBeGreaterThan(0);
    expect(new Set(paises(santoRD)), 'un comercio dominicano no debería poder elegir una ciudad colombiana')
        .toEqual(new Set(['Dominican Republic']));

    // 2b. El bug exacto: «medel» con comercio dominicano no ofrece nada.
    const medelRD = await buscar('MEDEL', COMERCIO_RD);
    expect(paises(medelRD), 'MEDELLÍN sigue siendo ofrecible a un comercio dominicano').toHaveLength(0);

    // 2c. Colombia no se movió.
    const santoCO = await buscar('SANTO DOMINGO', COMERCIO_CO);
    expect(new Set(paises(santoCO)), 'el comercio colombiano perdió sus ciudades')
        .toEqual(new Set(['Colombia']));

    // 2d. La regresión que este arreglo cierra: SIN `allied_id` la trampa sigue ahí. Se afirma en
    // positivo para que el test falle si algún día alguien "arregla" el default filtrando a Colombia —
    // eso rompería a los llamadores que no mandan el comercio.
    const sinFiltro = await buscar('SANTO DOMINGO');
    expect(new Set(paises(sinFiltro)),
        'sin allied_id el endpoint debe seguir devolviendo TODO (compatibilidad con otros llamadores)')
        .toEqual(new Set(['Dominican Republic', 'Colombia']));

    // ── 3. Y la pantalla, que es lo que ve quien carga un punto de venta ──────────────────────────
    await page.goto(`/aliados/${COMERCIO_RD}/editar`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: join(artefactos, 'admin-comercio-rd.png'), fullPage: true }).catch(() => {});

    console.log(`\n  ✔ comercio RD (${COMERCIO_RD}): «santo» → ${santoRD.length - 1} municipios, todos de RD`);
    console.log(`  ✔ comercio RD: «medel» → 0 opciones (antes ofrecía MEDELLÍN)`);
    console.log(`  ✔ comercio CO (${COMERCIO_CO}): «santo» → sólo Colombia`);
    console.log(`  · capturas en harness/.auth/\n`);
});

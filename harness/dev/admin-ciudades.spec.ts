import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminCreds } from '../pkg/config';
import { openA } from '../pkg/windows';
import { query, close } from '../pkg/db';

/**
 * `make harness-admin-ciudades` — el selector de ciudad del admin filtra por el país del comercio.
 *
 * Prueba el arreglo de la tarea 44. Hasta el 2026-08-08 el endpoint `admin.cities.search` devolvía las
 * **1.123 ciudades colombianas a cualquiera**, sin filtro de país: por eso los 13 puntos de venta
 * dominicanos quedaron registrados en «Santo Domingo» de **Antioquia**. El nombre coincide, así que
 * ninguna pantalla lo delataba.
 *
 * **Entra SIN contraseña.** `bin/admin-sesion` emite una sesión con el guard real de Laravel y este spec
 * inyecta la cookie. Se hizo así porque la única credencial disponible es de staging y puede no
 * corresponder al hash del dump local — y porque una contraseña no tiene por qué andar en un script.
 * Para ejercitar el login de Fortify de verdad, poné `E2E_ADMIN_LOGIN=1` y credenciales en `.admin.json`.
 *
 * Requiere el admin corriendo en local:
 *   php <legacy-application>/artisan serve --host=127.0.0.1 --port=8000
 * con `APP_HOST=localhost` **sin puerto** en su `.env`: Laravel compara el dominio de la ruta con
 * `getHost()`, que excluye el puerto, así que con `localhost:8000` todas las rutas del admin dan 404.
 *
 * Artefactos (gitignored): capturas en `harness/.auth/`.
 */

const BASE = process.env.E2E_ADMIN_URL ?? 'http://admin.localhost:8000';

/** Comercios del dump local. Pisables por env si otro dump usa otros ids. */
const COMERCIO_RD = process.env.E2E_ADMIN_ALLIED_RD ?? '270'; // CeluRD Test (country_id 60)
const COMERCIO_CO = process.env.E2E_ADMIN_ALLIED_CO ?? '14'; // godentist, tiene sucursal (la 14)

const POR_FORMULARIO = process.env.E2E_ADMIN_LOGIN === '1';

test('el selector de ciudad del admin filtra por el país del comercio', async ({ browser }) => {
    test.setTimeout(120_000);
    const artefactos = join(process.cwd(), '.auth');
    mkdirSync(artefactos, { recursive: true });

    const { context, page } = await openA(browser, { baseURL: BASE });

    // ── 1. Sesión ─────────────────────────────────────────────────────────────────────────────────
    if (POR_FORMULARIO) {
        expect(adminCreds.user && adminCreds.pass,
            'E2E_ADMIN_LOGIN=1 exige credenciales en .admin.json o E2E_ADMIN_USER/PASS').toBeTruthy();
        await page.goto('/login');
        await page.getByLabel(/correo/i).fill(adminCreds.user!);
        await page.getByLabel(/contrase/i).fill(adminCreds.pass!);
        await page.getByRole('button', { name: /iniciar sesi/i }).click();
        await page.waitForLoadState('networkidle').catch(() => {});
        expect(page.url(), 'seguimos en /login: la contraseña no corresponde al hash de ESTA base ' +
            '(¿el dump local vino de otro ambiente?)').not.toMatch(/\/login/);
    } else {
        const salida = execFileSync(join(process.cwd(), 'bin/admin-sesion'), { encoding: 'utf8' });
        const s = JSON.parse(salida.trim()) as {
            cookie: string; value: string; domain: string; email: string; roles: string[];
        };
        expect(s.roles, `el usuario ${s.email} no tiene rol Administrador`).toContain('Administrador');

        // ⚠ Se pasa `url` y NO `domain`. Laravel emite la cookie con dominio `.localhost` (así lo dice
        // `SESSION_DOMAIN`) y con eso curl entra sin problema, pero **Chromium la descarta**: `.localhost`
        // se trata como sufijo público, así que un dominio con punto inicial no se le puede asignar a
        // `admin.localhost`. Con `url` Playwright deriva host y path del origen real y sí la manda.
        // Costó una corrida: el endpoint respondía 200 con el HTML del landing —no un 401— porque el
        // middleware de auth redirige, y eso se lee como «el JSON está mal» y no como «no hay sesión».
        // El cookie es HttpOnly: no se puede poner desde la página, va por el contexto del navegador.
        await context.addCookies([{
            name: s.cookie, value: s.value, url: BASE,
            httpOnly: true, secure: false, sameSite: 'Lax',
        }]);
        console.log(`\n  · sesión emitida sin contraseña para ${s.email} (${s.roles.join(', ')})`);
    }

    // ── 2. El endpoint, con la sesión real del navegador ──────────────────────────────────────────
    // Se consulta la API además de mirar la pantalla: el autocomplete busca recién a los 3 caracteres y
    // pinta una lista virtualizada, así que afirmar SÓLO sobre el DOM mediría el widget. Acá se afirma
    // sobre lo que ofrece el backend; la pantalla se captura aparte, para el ojo.
    const buscar = async (texto: string, alliedId?: string) => {
        const url = new URL('/get-cities', BASE);
        url.searchParams.set('search', texto);
        if (alliedId) url.searchParams.set('allied_id', alliedId);
        const res = await page.request.get(url.toString());
        expect(res.ok(), `GET ${url.pathname}${url.search} devolvió ${res.status()}`).toBeTruthy();
        return (await res.json()) as Array<{ name: string; zone?: { country?: { name?: string } } }>;
    };

    // El comodín «TODAS LAS CIUDADES» se descuenta siempre: no es un lugar, se ofrece con filtro y sin
    // filtro, y vive colgado de Colombia por historia.
    const paises = (filas: Awaited<ReturnType<typeof buscar>>) =>
        filas.filter(c => c.name !== 'TODAS LAS CIUDADES')
            .map(c => c.zone?.country?.name ?? '?');

    const santoRD = await buscar('SANTO DOMINGO', COMERCIO_RD);
    expect(paises(santoRD).length,
        'el comercio RD no recibió ninguna ciudad: ¿faltan las de RD en esta base?').toBeGreaterThan(0);
    expect(new Set(paises(santoRD)),
        'un comercio dominicano no debería poder elegir una ciudad colombiana')
        .toEqual(new Set(['Dominican Republic']));

    // ⚠ El comodín TAMBIÉN tiene país, y hasta ahora se ignoraba. El controlador lo traía con un id
    // QUEMADO (1123, el de Colombia) y se lo anteponía a cualquiera, así que a un comercio dominicano
    // se le ofrecía la fila colombiana — el mismo error que este selector vino a hacer imposible.
    // Dejó de ser inocuo cuando RD y Perú tuvieron el suyo.
    const comodinRD = santoRD.find(c => c.name === 'TODAS LAS CIUDADES');
    expect(comodinRD?.zone?.country?.name,
        'a un comercio dominicano se le ofrece el comodín de OTRO país')
        .toBe('Dominican Republic');

    // El bug exacto que se cometió, ahora imposible de cometer.
    const medelRD = await buscar('MEDEL', COMERCIO_RD);
    expect(paises(medelRD), 'MEDELLÍN sigue siendo ofrecible a un comercio dominicano').toHaveLength(0);

    // Colombia no se movió.
    const santoCO = await buscar('SANTO DOMINGO', COMERCIO_CO);
    expect(new Set(paises(santoCO)), 'el comercio colombiano perdió sus ciudades')
        .toEqual(new Set(['Colombia']));

    // Se afirma en POSITIVO que sin `allied_id` sigue devolviendo todo: si alguien "mejora" el default
    // filtrando a Colombia, rompería a cualquier llamador que no manda el comercio, y este test lo ataja.
    // ⚠ La lista CRECE con cada país que se siembre: al cargar los 1.874 distritos peruanos apareció
    // «Peru», porque Perú también tiene un SANTO DOMINGO. Se afirma como superconjunto —que estén los
    // que sabemos que tienen ciudades— en vez de una igualdad, para que sembrar el próximo país no
    // rompa un test que no habla de eso. Lo que este bloque cuida es que NO se filtre, no cuántos hay.
    const sinFiltro = await buscar('SANTO DOMINGO');
    for (const pais of ['Dominican Republic', 'Colombia', 'Peru']) {
        expect(paises(sinFiltro),
            `sin allied_id el endpoint debe seguir devolviendo TODO (falta ${pais})`)
            .toContain(pais);
    }

    // ── 3. El OTRO selector: el del PUNTO DE VENTA, que es donde ocurrió el bug ───────────────────
    //
    // ⚠ Hay DOS selectores de ciudad en el admin y no comparten el backend:
    //   · el del modal de ENTIDADES pide `/get-cities` (el `CityController` de arriba);
    //   · el del PUNTO DE VENTA recibe la lista entera precargada como `$page.props.cities`, desde
    //     `AlliedAlliedBranchController`.
    // El segundo es el que causó los 13 casos, y se descubrió mirando la pantalla — ninguna verificación
    // del endpoint lo habría encontrado, porque ese formulario no llama al endpoint. Si mañana alguien
    // arregla uno solo de los dos, este bloque falla.
    // La lista viaja como prop de Inertia embebida en el HTML de la vista. Se extrae el array
    // `"cities":[…]` balanceando corchetes en vez de buscar `data-page`: esta app renderiza las props
    // inline (el `<body id="app">` no lleva el atributo), así que ese camino no existe acá.
    const ciudadesEnLaPagina = async (alliedId: string) => {
        const res = await page.request.get(
            `${BASE}/aliados/${alliedId}/puntosdeventa?allied_branch_id=0`);
        expect(res.ok(), `la vista de puntos de venta devolvió ${res.status()}`).toBeTruthy();
        const html = await res.text();

        const marca = html.indexOf('"cities":[');
        expect(marca, 'no se encontró la prop `cities` en la vista: ¿cambió el controlador?')
            .toBeGreaterThan(-1);
        let i = marca + '"cities":'.length, prof = 0, fin = i;
        for (; i < html.length; i++) {
            if (html[i] === '[') prof++;
            else if (html[i] === ']') { prof--; if (prof === 0) { fin = i + 1; break; } }
        }
        const cities = JSON.parse(html.slice(marca + '"cities":'.length, fin)) as Array<{ title: string }>;
        return cities.map(c => c.title);
    };

    /** Los títulos sin el comodín, que es lo que se compara contra el catálogo de un país. */
    const sinComodin = (titulos: string[]) => titulos.filter(t => !t.startsWith('TODAS LAS CIUDADES'));

    // ⚠ El comodín se pide con un OR por NOMBRE, así que trae el de TODOS los países. Mientras Colombia
    // fue la única que lo tenía se veía uno solo; al sembrar RD y Perú pasaron a aparecer TRES entradas
    // idénticas «TODAS LAS CIUDADES» en el mismo desplegable, indistinguibles entre sí.
    const todasRD = await ciudadesEnLaPagina(COMERCIO_RD);
    expect(todasRD.filter(t => t === 'TODAS LAS CIUDADES'),
        'el selector ofrece el comodín de varios países a la vez').toHaveLength(1);

    const ciudadesRD = sinComodin(await ciudadesEnLaPagina(COMERCIO_RD));
    expect(ciudadesRD.length, 'el selector del punto de venta no ofrece ninguna ciudad para el comercio RD')
        .toBeGreaterThan(0);
    expect(ciudadesRD, 'el selector del PUNTO DE VENTA sigue ofreciendo MEDELLÍN a un comercio dominicano ' +
        '— es el formulario donde de verdad ocurrió el bug de los 13 puntos de venta')
        .not.toContain('MEDELLÍN');
    // ⚠ Antes acá había una lista fija con los 8 municipios del área metropolitana, que era todo lo que
    // el catálogo tenía. Al sembrar los 158 el test se rompió por su propia expectativa, no por el
    // producto. Se pregunta a la BASE cuáles son las ciudades de RD: así la afirmación —«ninguna de las
    // que se ofrecen es de otro país»— sigue siendo cierta sin importar cuánto crezca el catálogo.
    const ciudadesDeRD = new Set((await query<{ name: string }>(
        `SELECT cc.name FROM country_cities cc
           JOIN country_zones cz ON cz.id = cc.country_zone_id
           JOIN countries c ON c.id = cz.country_id
          WHERE c.iso_code_2 = 'DOM'`,
    )).map(f => f.name));

    const intrusas = ciudadesRD.filter(c => !ciudadesDeRD.has(c));
    expect(intrusas, `el comercio RD recibió ciudades que no son dominicanas: ${intrusas.join(', ')}`)
        .toHaveLength(0);
    expect(ciudadesRD.length, 'el comercio RD sigue viendo sólo el área metropolitana: ' +
        '¿corrió la migración que siembra los 158 municipios?').toBeGreaterThan(100);
    console.log(`  ✔ punto de venta, comercio RD: ${ciudadesRD.length} ciudades, todas de RD`);

    await page.goto(`/aliados/${COMERCIO_RD}/editar`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: join(artefactos, 'admin-comercio-rd.png'), fullPage: true }).catch(() => {});

    const ciudadesCO = sinComodin(await ciudadesEnLaPagina(COMERCIO_CO));
    expect(ciudadesCO, 'el comercio colombiano perdió MEDELLÍN del selector de punto de venta')
        .toContain('MEDELLÍN');

    // Ningún título puede repetirse: si dos ciudades del país se llaman igual, el desplegable las
    // ordena juntas y quien carga el punto de venta elige a ciegas. Colombia tiene 4 VILLANUEVA y 4
    // LA UNIÓN en departamentos distintos, y Perú 8 SANTA ROSA; el controlador les agrega su
    // departamento y sólo a ellas.
    const repetidos = (titulos: string[]) => [...new Set(titulos.filter((t, i) => titulos.indexOf(t) !== i))];
    expect(repetidos(ciudadesCO), 'el selector colombiano muestra nombres repetidos e indistinguibles')
        .toEqual([]);
    expect(repetidos(ciudadesRD), 'el selector dominicano muestra nombres repetidos e indistinguibles')
        .toEqual([]);
    expect(ciudadesCO.filter(c => c.startsWith('VILLANUEVA')),
        'los homónimos colombianos deberían venir con su departamento').toHaveLength(4);
    console.log(`  ✔ punto de venta, comercio CO: ${ciudadesCO.length} ciudades (Colombia intacta)`);

    // El modal del selector cuelga de la pestaña de entidades. El nombre exacto de la pestaña y del
    // botón cambia con el diseño, así que la navegación es best-effort: si no se llega, quedan las
    // afirmaciones de arriba (que son las que prueban el arreglo) y la captura de la página.
    const pestaña = page.getByRole('tab', { name: /entidad|lender/i })
        .or(page.getByText(/^entidades$/i)).first();
    if (await pestaña.isVisible().catch(() => false)) {
        await pestaña.click().catch(() => {});
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(artefactos, 'admin-pestana-entidades.png'), fullPage: true })
            .catch(() => {});

        const ciudad = page.getByPlaceholder(/ciudad/i).or(page.getByLabel(/ciudad/i)).first();
        if (await ciudad.isVisible().catch(() => false)) {
            await ciudad.fill('santo');                 // el componente busca a los 3 caracteres
            await page.waitForTimeout(1200);            // deja llegar el XHR y pintar la lista
            await page.screenshot({ path: join(artefactos, 'admin-ciudades-santo.png'), fullPage: true })
                .catch(() => {});
            console.log('  · capturado el desplegable con «santo»');
        } else {
            console.log('  · el campo de ciudad no está visible sin abrir el modal de una entidad');
        }
    }

    console.log(`  ✔ comercio RD (${COMERCIO_RD}): «santo» → ${paises(santoRD).length} municipios, todos de RD`);
    console.log(`  ✔ comercio RD: «medel» → 0 opciones (antes ofrecía MEDELLÍN)`);
    console.log(`  ✔ comercio CO (${COMERCIO_CO}): «santo» → sólo Colombia`);
    console.log(`  · capturas en harness/.auth/\n`);
});

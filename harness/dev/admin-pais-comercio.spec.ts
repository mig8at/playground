import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * ¿El país de un comercio se puede corregir hasta la primera SOLICITUD?
 *
 * Antes la puerta la cerraba la primera SUCURSAL, y eso dejaba sin salida el caso más común al abrir
 * un país: se crea el comercio, se le crea la sucursal, y recién ahí se nota que el país estaba mal.
 * Medido en la base compartida el 2026-08-31: 27 comercios editables contra 26 con sucursales y sin
 * una sola solicitud.
 *
 * Se mira la PANTALLA y no sólo el modelo porque el campo vive detrás de un `v-if` alimentado por el
 * share de Inertia: el modelo puede decir «editable» y el formulario seguir sin mostrarlo si la prop
 * no llega. Eso es justamente lo que no se ve desde PHP.
 *
 *   php <legacy-application>/artisan serve --host=127.0.0.1 --port=8000
 *   npx playwright test dev/admin-pais-comercio.spec.ts --reporter=list
 *
 * ⚠ La base es `admin.localhost:8000` y no `localhost:8000`: el routing resuelve por `getHost()`, que
 * excluye el puerto, así que sin el subdominio todas las rutas del admin dan 404.
 */
const BASE = process.env.E2E_ADMIN_URL ?? 'http://admin.localhost:8000';

/**
 * Los tres casos en la base local, por ID.
 *
 * ⚠ Va el **id numérico y no el hash**: el route model binding resuelve por id, y un hash como
 * `094d1218` no falla — PHP lo castea a entero y da 94, o sea que te lleva a OTRO comercio sin avisar.
 * Costó una corrida: el test medía Amoblando Pullman (39.976 solicitudes) creyendo que miraba uno vacío.
 */
const CASOS = {
      conSucursalesSinSolicitudes: process.env.E2E_ALLIED_B ?? '33',
      conSolicitudes: process.env.E2E_ALLIED_C ?? '14',
      /** Entidad (no comercio) que arrastra tipos de otro país: smartpay, en un país sin catálogo. */
      entidadConTiposAjenos: process.env.E2E_LENDER_AJENOS ?? '152',
};

test.use({ baseURL: BASE });

test.beforeEach(async ({ context }) => {
      // Sin contraseña: `bin/admin-sesion` emite la cookie de sesión directamente. Se pasa `url` y no
      // `domain` porque Chromium descarta un dominio con punto inicial (`.localhost` es sufijo público).
      const salida = execFileSync(join(process.cwd(), 'bin/admin-sesion'), { encoding: 'utf8' });
      const s = JSON.parse(salida.trim()) as { cookie: string; value: string; roles: string[] };
      expect(s.roles).toContain('Administrador');
      await context.addCookies([
            { name: s.cookie, value: s.value, url: BASE, httpOnly: true, secure: false, sameSite: 'Lax' },
      ]);
});

test('un comercio con sucursales y sin solicitudes puede corregir su país', async ({ page }) => {
      // `/editar` no renderiza: hace un meta-refresh a la pestaña de puntos de venta, que es donde vive
      // el formulario (el layout es compartido por las pestañas, por eso los datos van en el share).
      await page.goto(`/aliados/${CASOS.conSucursalesSinSolicitudes}/editar`);
      await page.waitForURL(/\/aliados\/\d+\//, { timeout: 15_000 });
      // Sin esto se consulta el DOM antes de que Vue monte y todo da «element not found», que se
      // lee como «la regla bloqueó» en vez de «todavía no dibujó».
      await page.waitForLoadState('networkidle');

      // Se afirma sobre la PANTALLA y no sobre las props de Inertia: Vue consume `data-page` al hidratar
      // y el atributo desaparece del DOM, así que leerlo devuelve `undefined` para todo — que se lee como
      // «la regla bloqueó» cuando en realidad no se leyó nada. Costó dos corridas.
      // Se ancla en el HINT del campo y no en su label: `app-select` (Vuetify) no propaga el `id` ni
      // asocia el label en el DOM, así que ni `#country` ni `getByLabel` lo encuentran aunque esté a la
      // vista. El hint es texto propio del campo: si está, el campo se renderizó.
      await expect(page.getByText(/todavía no tiene solicitudes/i),
            'el campo País no aparece: la regla lo bloqueó o el share no llegó').toBeVisible();

      // Y con sucursales, el aviso tiene que advertir que quedan con una ciudad de otro país.
      await expect(page.getByText(/puntos de venta quedar/i),
            'falta el aviso de que las sucursales quedan con una ciudad de otro país').toBeVisible();

      // El país actual, en pantalla: si el selector se quedó sin opciones saldría vacío.
      await expect(page.getByText('Colombia').first(),
            'el selector no muestra el país actual: la lista de países no llegó').toBeVisible();

      await page.screenshot({ path: 'test-results/pais-comercio-editable.png' });
});

test('un comercio con solicitudes ve el campo, pero deshabilitado y con el motivo', async ({ page }) => {
      await page.goto(`/aliados/${CASOS.conSolicitudes}/editar`);
      await page.waitForURL(/\/aliados\/\d+\//, { timeout: 15_000 });
      // Sin esto se consulta el DOM antes de que Vue monte y todo da «element not found», que se
      // lee como «la regla bloqueó» en vez de «todavía no dibujó».
      await page.waitForLoadState('networkidle');

      // Con solicitudes el campo SE VE, deshabilitado y con el motivo. Esconderlo era peor: un campo
      // ausente no se distingue de uno roto, y quien no lo ve concluye que la pantalla no tiene esa
      // opción. Mismo criterio que la edición de entidades.
      await expect(page.getByLabel('Nombre', { exact: true }),
            'el formulario no montó: las aserciones de abajo no probarían nada').toBeVisible();

      await expect(page.getByText(/Ya tiene solicitudes/i),
            'falta el motivo: el campo gris se lee como un error de la pantalla').toBeVisible();
      await expect(page.getByText(/todavía no tiene solicitudes/i),
            'dice que se puede corregir, y este comercio tiene solicitudes').toHaveCount(0);

      // Y de verdad deshabilitado, no sólo con el cartel.
      await expect(page.locator('.v-input--disabled').filter({ hasText: 'País' }).first(),
            'el campo se ve pero no está deshabilitado: la regla no está frenando').toBeVisible();

      await page.screenshot({ path: 'test-results/pais-comercio-bloqueado.png' });
});

/**
 * Una entidad puede arrastrar tipos de documento que no son de su país — pasa al cambiarle el país:
 * los viejos se quedan. Antes se veían como chip pero NO se podían quitar, porque deseleccionar exige
 * que la opción exista y las opciones eran sólo las del país. El resultado era un tipo ajeno a la vista,
 * sin forma de sacarlo, que se volvía a guardar tal cual.
 */
test('los tipos de documento ajenos al país se ven, se explican y se pueden quitar', async ({ page }) => {
      await page.goto(`/entidades/${CASOS.entidadConTiposAjenos}/editar`);
      await page.waitForLoadState('networkidle');

      // El aviso dice cuáles sobran y por qué.
      await expect(page.getByText(/no (es|son) de .*: qued/i),
            'no se avisa que la entidad tiene tipos que no son de su país').toBeVisible();

      // Y están entre las opciones, que es lo que permite deseleccionarlos. Sin esto el chip se ve
      // pero es inamovible.
      await page.getByText('Tipos de documento que acepta').click();
      await expect(page.getByText(/— no es de/i).first(),
            'los tipos ajenos no aparecen en la lista: no hay forma de quitarlos').toBeVisible();

      await page.screenshot({ path: 'test-results/tipos-ajenos.png' });
});

/**
 * El selector de país filtra al escribir.
 *
 * Son 18 países operativos y la lista sigue creciendo: con un desplegable pelado hay que buscarlos a
 * ojo. `app-autocomplete` es el mismo componente que ya usan otras pantallas del admin, así que el
 * cambio es de `app-select` a ése y nada más.
 */
test('el selector de país filtra al escribir', async ({ page }) => {
      await page.goto(`/aliados/${CASOS.conSucursalesSinSolicitudes}/editar`);
      await page.waitForURL(/\/aliados\/\d+\//, { timeout: 15_000 });
      await page.waitForLoadState('networkidle');

      // El input del autocomplete: es el que está dentro del campo cuyo hint ya conocemos.
      const campo = page.locator('.v-input').filter({ hasText: 'País' }).first();
      const input = campo.locator('input').first();
      await input.click();

      // Sin filtrar están todos.
      await expect(page.getByRole('option'), 'el desplegable no se abrió o no tiene países')
            .not.toHaveCount(0);
      const total = await page.getByRole('option').count();

      await input.fill('per');
      await expect(page.getByRole('option'),
            'escribir no redujo la lista: el campo no está filtrando').toHaveCount(1);
      await expect(page.getByRole('option').first()).toContainText(/per[uú]/i);

      console.log(`\n  · sin filtrar: ${total} países · escribiendo "per": 1`);
      await page.screenshot({ path: 'test-results/pais-filtrado.png' });
});

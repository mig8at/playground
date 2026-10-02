// Qué se fija acá: las piezas PURAS de la creación de comercios por el admin (`pkg/admin-http.ts` y
// `pkg/allied-admin.ts`). No abren navegador, no tocan la red ni la base: el alta de verdad se prueba
// corriéndola (`make harness-allied-create TARGET=local CLEANUP=1`).
//
// Se prueba porque dos de ellas ya mordieron en la primera corrida real y se leen como «el admin falló»:
// la página de Inertia de este admin viaja en `window.inertiaPage` y no en `data-page`, y los países llegan
// como `{value, title}` y no como `{id, name}`.
import { expect, test } from '@playwright/test';
import { CookieJar, adminBaseFor, alliedIdFromLocation, parseDataPage, unescapeHtml } from './admin-http.ts';
import { AUTO_PREFIX, ONE_PIXEL_PNG, autoName, flashOf, pickOption } from './allied-admin.ts';

test.describe('la página de Inertia en el HTML', () => {
      // 🔴 Lo que sirve legacy-application: un <script inertia>, NO el atributo. Con sólo el atributo, el formulario
      // «no traía opciones» y no había forma de saber por qué.
      test('se lee de window.inertiaPage', () => {
            const html = '<head><script inertia> window.inertiaPage = {"component":"admin\\/allieds\\/AlliedCreate","props":{"settings":{"countries":[{"value":47,"title":"Colombia"}]}},"url":"\\/aliados\\/crear","version":"abc"}; </script></head>';
            const page = parseDataPage(html);
            expect(page?.component).toBe('admin/allieds/AlliedCreate');
            expect(page?.props.settings.countries[0]).toEqual({ value: 47, title: 'Colombia' });
            expect(page?.version).toBe('abc');
      });

      test('y también del atributo data-page, escapado', () => {
            const html = '<div id="app" data-page="{&quot;component&quot;:&quot;A&quot;,&quot;props&quot;:{&quot;n&quot;:&quot;a &amp;amp; b&quot;},&quot;url&quot;:&quot;/&quot;}"></div>';
            expect(parseDataPage(html)?.props.n).toBe('a &amp; b');
            expect(unescapeHtml('&amp;quot;')).toBe('&quot;');
      });

      test('sin página, o con JSON roto, devuelve null y no lanza', () => {
            expect(parseDataPage('<html></html>')).toBeNull();
            expect(parseDataPage('<script inertia> window.inertiaPage = {roto}; </script>')).toBeNull();
      });
});

test.describe('las cookies', () => {
      test('aplica las que manda el servidor y borra las vencidas o vacías', () => {
            const jar = new CookieJar();
            jar.set('sesion', 'vieja');
            jar.apply(['XSRF-TOKEN=abc%3D; Path=/; Max-Age=7200', 'sesion=nueva; Path=/; HttpOnly']);
            expect(jar.get('sesion')).toBe('nueva');
            jar.apply(['sesion=; Path=/; Max-Age=0']);
            expect(jar.get('sesion')).toBeUndefined();
            expect(jar.header()).toBe('XSRF-TOKEN=abc%3D');
      });

      // 🔴 Laravel devuelve el token en una cookie codificada y lo espera DECODIFICADO en el header; mandarlo
      // tal cual da un 419 que no explica nada.
      test('el token CSRF se manda decodificado', () => {
            const jar = new CookieJar();
            jar.apply(['XSRF-TOKEN=eyJpdiI6IkFC%3D%3D; Path=/']);
            expect(jar.xsrf()).toBe('eyJpdiI6IkFC==');
            expect(new CookieJar().xsrf()).toBeUndefined();
      });
});

test.describe('el id del comercio que devuelve el alta', () => {
      test('sale del query o de la ruta', () => {
            expect(alliedIdFromLocation('http://admin.localhost:8000/aliados?allied=349')).toBe(349);
            expect(alliedIdFromLocation('/aliados/349/puntosdeventa')).toBe(349);
      });

      test('si no hay id, null', () => {
            expect(alliedIdFromLocation('/aliados')).toBeNull();
            expect(alliedIdFromLocation('/aliados/crear')).toBeNull();
            expect(alliedIdFromLocation('/aliados?allied=abc')).toBeNull();
      });
});

test.describe('a qué admin se le habla', () => {
      test('local, dev y staging tienen el suyo', () => {
            expect(adminBaseFor('dev')).toBe('https://admin.dev.creditop.com');
            expect(adminBaseFor('LOCAL')).toBe('http://admin.localhost:8000');
      });

      // 🔴 Producción es sólo lectura y qa no tiene admin: equivocarse acá crearía un comercio donde no se debe.
      test('producción se rechaza y qa manda a dev', () => {
            expect(() => adminBaseFor('prod')).toThrow(/sólo lectura/);
            expect(() => adminBaseFor('production')).toThrow(/sólo lectura/);
            expect(() => adminBaseFor('qa')).toThrow(/con --target dev/);
            expect(() => adminBaseFor('inventado')).toThrow(/no conozco/);
      });
});

test.describe('el formulario de alta', () => {
      // 🔴 Los países llegan como {value, title} (selector de Vuetify) y el resto como {id, name}.
      test('lee las dos formas de opción y prefiere Colombia', () => {
            const countries = [{ value: 10, title: 'Argentina' }, { value: 47, title: 'Colombia' }];
            expect(pickOption(countries, undefined, 47)).toBe(47);
            expect(pickOption([{ id: 3, name: 'Grande' }, { id: 1, name: 'Pequeño' }])).toBe(3);
      });

      test('una opción pedida que no existe se rechaza diciendo cuáles hay; sin opciones, también', () => {
            expect(() => pickOption([{ id: 1 }], 9)).toThrow(/hay: 1/);
            expect(() => pickOption([], undefined)).toThrow(/no trajo opciones/);
      });

      test('el nombre automático lleva el prefijo, y es el que exige el permiso de borrado', () => {
            const name = autoName(new Date(2026, 9, 2, 13, 5, 7));
            expect(name).toBe(`${AUTO_PREFIX} 1002-130507`);
            expect(name.startsWith(AUTO_PREFIX)).toBe(true);
      });

      test('el PNG de 1×1 tiene la firma de un PNG', () => {
            expect([...ONE_PIXEL_PNG.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      });
});

test.describe('lo que muestra el admin del asesor de prueba', () => {
      test('lo normaliza; sin flash, null', () => {
            const f = flashOf({ testAdvisor: { created: true, cognito: 'created', email: 'c1-fake@x', passwordFixed: true, branchName: 'b1-fake', notes: ['uno'] } });
            expect(f).toMatchObject({ created: true, cognito: 'created', email: 'c1-fake@x', passwordFixed: true, notes: ['uno'] });
            expect(flashOf({})).toBeNull();
            expect(flashOf(undefined)).toBeNull();
      });
});

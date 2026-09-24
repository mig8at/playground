// Pruebas de `pkg/fecha-trio.ts` — la regla compartida por los DOS autorrellenos.
//
// No tocan la base. Doce son PURAS (corren en Node) y la última abre un Chromium, porque la regla
// viaja a la página como TEXTO y eso sólo se puede afirmar ejecutándolo ahí. Se corren con
//     npx playwright test pkg/fecha-trio.spec.ts
// (nunca `npm test` pelado: colecta el guiado, que es interactivo — ver `harness/CLAUDE.md`).
import { expect, test } from '@playwright/test';
import {
      MONTHS, isDateTrio, screenDate, injectableSource, comboPart, searchedValue, alreadyShows,
} from './fecha-trio.ts';

const part = (text: string, label = '', index = 9) => comboPart(text, label, index, MONTHS);

test.describe('qué parte de la fecha es cada combo', () => {
      // Señal 1: el trío que nace con un default puesto. Es lo que ve el autorrelleno INYECTADO.
      test('por el valor que muestra', () => {
            expect(part('Enero')).toBe('mes');
            expect(part('agosto')).toBe('mes');
            expect(part('2026')).toBe('anio');
            expect(part('1')).toBe('dia');
            expect(part('20')).toBe('dia');
      });

      // 🔴 Señal 2: el combo VACÍO no muestra valor sino su placeholder. Es lo que ve el autorrelleno de
      // PLAYWRIGHT, y por lo que la señal 1 no le alcanzaba — de ahí salía `1 / Enero / 2026`.
      test('por el placeholder, que es lo único que hay cuando está vacío', () => {
            expect(part('Día*')).toBe('dia');
            expect(part('Mes*')).toBe('mes');
            expect(part('Año*')).toBe('anio');
            expect(part('', 'Año de expedición')).toBe('anio');
      });

      test('por la posición, como último recurso', () => {
            expect(part('', '', 0)).toBe('dia');
            expect(part('', '', 1)).toBe('mes');
            expect(part('', '', 2)).toBe('anio');
            expect(part('', '', 3)).toBeNull();
            // ...y también cuando el combo dice que todavía no eligió nada.
            expect(part('Seleccionar', '', 0)).toBe('dia');
      });

      // 🔴 LA POSICIÓN NO ALCANZA SI EL COMBO YA MUESTRA OTRA COSA, y esto costó dos capturas.
      // En `/lenders` hay un selector de PLAZO por entidad; con tres tarjetas, el fallback por posición
      // los daba como día/mes/año y `isDateTrio` decía `true`. El autorrelleno abría los tres
      // buscando una fecha adentro, ninguno la tenía, y quedaban abiertos uno encima del otro: se veía
      // como «el select se quedó pegado y no cierra». Medido contra `qa` el 2026-09-15 con Crédito 365
      // (3,6,9,12), Addi (3…24) y Vanti (2…60).
      test('un selector de cuotas NO es parte de una fecha, aunque esté en la posición de una', () => {
            const terms = ['12 cuotas', '24 cuotas', '60 cuotas'];
            const parts = terms.map((t, i) => part(t, '', i));
            expect(parts).toEqual([null, null, null]);
            expect(isDateTrio(parts)).toBe(false);
      });

      // 🔴 Un combo suelto que casualmente muestra un número NO es una fecha: sin esto, el autorrelleno
      // le elegiría un día a un selector de cuotas.
      test('tres partes distintas hacen un trío; menos, no', () => {
            expect(isDateTrio(['dia', 'mes', 'anio'])).toBe(true);
            expect(isDateTrio(['dia', 'dia', 'dia'])).toBe(false);
            expect(isDateTrio(['dia', 'mes'])).toBe(false);
            expect(isDateTrio([null, null, null])).toBe(false);
      });
});

test.describe('qué valor le va', () => {
      test('el día se ofrece con y sin cero', () => {
            expect(searchedValue('dia', '2010-08-05', MONTHS)).toEqual(['5', '05']);
            expect(searchedValue('dia', '2010-08-20', MONTHS)).toEqual(['20', '20']);
      });

      test('el mes, por nombre primero y por número después', () => {
            expect(searchedValue('mes', '2010-08-20', MONTHS)).toEqual(['agosto', '8', '08']);
      });

      test('el año, tal cual', () => {
            expect(searchedValue('anio', '2010-08-20', MONTHS)).toEqual(['2010']);
      });
});

test.describe('cuál de las dos fechas pide la pantalla', () => {
      test('la de expedición se reconoce escrita de varias formas', () => {
            for (const text of ['Fecha de expedición', 'FECHA DE EXPEDICION del documento', 'issue date']) {
                  expect(screenDate(text, '1990-05-14', '2010-08-20')).toBe('2010-08-20');
            }
      });

      test('cualquier otra pantalla es la de nacimiento', () => {
            expect(screenDate('Fecha de nacimiento', '1990-05-14', '2010-08-20')).toBe('1990-05-14');
            expect(screenDate('', '1990-05-14', '2010-08-20')).toBe('1990-05-14');
      });
});

// 🔴 LA REGRESIÓN QUE ORIGINÓ ESTE MÓDULO. El trío nace en `1 / Enero / <año actual>` —el día de hoy,
// que ninguna validación acepta como fecha de expedición— y la SEGUNDA pasada del autorrelleno lo
// volvía a elegir, porque su memoria era por elemento y Radix reemplaza el nodo al cambiar el valor.
// Si esta prueba se cae, la fecha volvió a cambiar dos veces.
test('dos pasadas: la primera corrige el default, la segunda no toca nada', () => {
      const goal = '2010-08-20';
      const pass = (texts: string[]) => texts.map((txt, i) => {
            const p = comboPart(txt, '', i, MONTHS);
            if (!p) return 'no es fecha';
            const searched = searchedValue(p, goal, MONTHS);
            return alreadyShows(txt, searched) ? 'salta' : `elige ${searched[0]}`;
      });

      expect(pass(['1', 'Enero', '2026'])).toEqual(['elige 20', 'elige agosto', 'elige 2010']);
      expect(pass(['20', 'Agosto', '2010'])).toEqual(['salta', 'salta', 'salta']);
});

test('un combo vacío no cuenta como «ya muestra el valor»', () => {
      expect(alreadyShows('', ['20', '20'])).toBe(false);
      expect(alreadyShows('  ', ['20', '20'])).toBe(false);
});

// 🔴 LA PRUEBA QUE FIJA LA FRAGILIDAD DE LA INYECCIÓN. El autorrelleno del camino visual se serializa
// con `addInitScript`, así que la regla viaja como TEXTO —`Function.prototype.toString()`—. Eso sólo
// funciona mientras el borrado de tipos de Node deje un cuerpo que sea JS válido. Hoy lo deja; si una
// versión futura cambiara eso, la fuente inyectada sería un error de sintaxis EN EL NAVEGADOR, sin
// mensaje útil y a mitad de un flujo. Acá se cae una prueba en vez de eso.
test('la fuente inyectable es JS válido y se porta igual que el módulo', () => {
      const source = injectableSource();
      expect(source).not.toMatch(/:\s*(string|number|boolean|ParteDeFecha)\b/);   // sin anotaciones sueltas

      const timeWindow: Record<string, any> = {};
      // `new Function` es el evaluador honesto acá: si la fuente no es JS válido, LANZA.
      new Function('window', source)(timeWindow);
      const trio = timeWindow.__trioFecha;

      expect(trio.MESES).toEqual(MONTHS);
      expect(trio.parteDeCombo('Enero', '', 9, trio.MESES)).toBe('mes');
      expect(trio.parteDeCombo('Día*', '', 9, trio.MESES)).toBe('dia');
      expect(trio.valorBuscado('mes', '2010-08-20', trio.MESES)).toEqual(['agosto', '8', '08']);
      expect(trio.fechaDeLaPantalla('Fecha de expedición', '1990-05-14', '2010-08-20')).toBe('2010-08-20');
      expect(trio.yaMuestra('Agosto', ['agosto'])).toBe(true);
      expect(trio.esTrioDeFecha(['dia', 'mes', 'anio'])).toBe(true);
      expect(trio.normalizarTexto(' ENERO ')).toBe('enero');
});

// 🔴 QUE LA REGLA LLEGUE A LA PÁGINA DE VERDAD. Las pruebas de arriba corren en Node; el autorrelleno
// del camino visual corre DENTRO del navegador y recibe la regla por un `addInitScript` aparte. Si ese
// script no llegara —orden de instalación, o una serialización que el navegador rechaza— la fecha se
// saltearía EN SILENCIO, que es el peor de los dos modos de fallar. Esto lo comprueba en un Chromium.
test('la regla llega al navegador y decide igual que en Node', async ({ browser }) => {
      const { installAutofill } = await import('./autorelleno.ts');
      const context = await browser.newContext();
      await installAutofill(context);
      const page = await context.newPage();
      // Una página cualquiera: lo que se prueba es el init script, no el contenido.
      await page.setContent('<h1>Fecha de expedición</h1>');

      const onPage = await page.evaluate(() => {
            const T = (window as any).__trioFecha;
            if (!T) return null;
            const texts = ['1', 'Enero', '2026'];
            const parts = texts.map((t, i) => T.parteDeCombo(t, '', i, T.MESES));
            const date = T.fechaDeLaPantalla(document.body.innerText, '1990-05-14', '2010-08-20');
            return {
                  partes: parts,
                  esTrio: T.esTrioDeFecha(parts),
                  fecha: date,
                  elegidos: parts.map((p: any) => T.valorBuscado(p, date, T.MESES)[0]),
                  segundaPasada: ['20', 'Agosto', '2010'].map((t, i) =>
                        T.yaMuestra(t, T.valorBuscado(parts[i], date, T.MESES))),
            };
      });

      expect(onPage, 'el init script de la regla no llegó a la página').not.toBeNull();
      expect(onPage!.partes).toEqual(['dia', 'mes', 'anio']);
      expect(onPage!.esTrio).toBe(true);
      expect(onPage!.fecha).toBe('2010-08-20');            // lo dijo el <h1>
      expect(onPage!.elegidos).toEqual(['20', 'agosto', '2010']);
      expect(onPage!.segundaPasada).toEqual([true, true, true]);   // idempotente
      await context.close();
});

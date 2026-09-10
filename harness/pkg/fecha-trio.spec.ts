// Pruebas de `pkg/fecha-trio.ts` — la regla compartida por los DOS autorrellenos.
//
// No tocan la base. Doce son PURAS (corren en Node) y la última abre un Chromium, porque la regla
// viaja a la página como TEXTO y eso sólo se puede afirmar ejecutándolo ahí. Se corren con
//     npx playwright test pkg/fecha-trio.spec.ts
// (nunca `npm test` pelado: colecta el guiado, que es interactivo — ver `harness/CLAUDE.md`).
import { expect, test } from '@playwright/test';
import {
      MESES, esTrioDeFecha, fechaDeLaPantalla, fuenteInyectable, parteDeCombo, valorBuscado, yaMuestra,
} from './fecha-trio.ts';

const parte = (texto: string, etiqueta = '', indice = 9) => parteDeCombo(texto, etiqueta, indice, MESES);

test.describe('qué parte de la fecha es cada combo', () => {
      // Señal 1: el trío que nace con un default puesto. Es lo que ve el autorrelleno INYECTADO.
      test('por el valor que muestra', () => {
            expect(parte('Enero')).toBe('mes');
            expect(parte('agosto')).toBe('mes');
            expect(parte('2026')).toBe('anio');
            expect(parte('1')).toBe('dia');
            expect(parte('20')).toBe('dia');
      });

      // 🔴 Señal 2: el combo VACÍO no muestra valor sino su placeholder. Es lo que ve el autorrelleno de
      // PLAYWRIGHT, y por lo que la señal 1 no le alcanzaba — de ahí salía `1 / Enero / 2026`.
      test('por el placeholder, que es lo único que hay cuando está vacío', () => {
            expect(parte('Día*')).toBe('dia');
            expect(parte('Mes*')).toBe('mes');
            expect(parte('Año*')).toBe('anio');
            expect(parte('', 'Año de expedición')).toBe('anio');
      });

      test('por la posición, como último recurso', () => {
            expect(parte('', '', 0)).toBe('dia');
            expect(parte('', '', 1)).toBe('mes');
            expect(parte('', '', 2)).toBe('anio');
            expect(parte('', '', 3)).toBeNull();
      });

      // 🔴 Un combo suelto que casualmente muestra un número NO es una fecha: sin esto, el autorrelleno
      // le elegiría un día a un selector de cuotas.
      test('tres partes distintas hacen un trío; menos, no', () => {
            expect(esTrioDeFecha(['dia', 'mes', 'anio'])).toBe(true);
            expect(esTrioDeFecha(['dia', 'dia', 'dia'])).toBe(false);
            expect(esTrioDeFecha(['dia', 'mes'])).toBe(false);
            expect(esTrioDeFecha([null, null, null])).toBe(false);
      });
});

test.describe('qué valor le va', () => {
      test('el día se ofrece con y sin cero', () => {
            expect(valorBuscado('dia', '2010-08-05', MESES)).toEqual(['5', '05']);
            expect(valorBuscado('dia', '2010-08-20', MESES)).toEqual(['20', '20']);
      });

      test('el mes, por nombre primero y por número después', () => {
            expect(valorBuscado('mes', '2010-08-20', MESES)).toEqual(['agosto', '8', '08']);
      });

      test('el año, tal cual', () => {
            expect(valorBuscado('anio', '2010-08-20', MESES)).toEqual(['2010']);
      });
});

test.describe('cuál de las dos fechas pide la pantalla', () => {
      test('la de expedición se reconoce escrita de varias formas', () => {
            for (const texto of ['Fecha de expedición', 'FECHA DE EXPEDICION del documento', 'issue date']) {
                  expect(fechaDeLaPantalla(texto, '1990-05-14', '2010-08-20')).toBe('2010-08-20');
            }
      });

      test('cualquier otra pantalla es la de nacimiento', () => {
            expect(fechaDeLaPantalla('Fecha de nacimiento', '1990-05-14', '2010-08-20')).toBe('1990-05-14');
            expect(fechaDeLaPantalla('', '1990-05-14', '2010-08-20')).toBe('1990-05-14');
      });
});

// 🔴 LA REGRESIÓN QUE ORIGINÓ ESTE MÓDULO. El trío nace en `1 / Enero / <año actual>` —el día de hoy,
// que ninguna validación acepta como fecha de expedición— y la SEGUNDA pasada del autorrelleno lo
// volvía a elegir, porque su memoria era por elemento y Radix reemplaza el nodo al cambiar el valor.
// Si esta prueba se cae, la fecha volvió a cambiar dos veces.
test('dos pasadas: la primera corrige el default, la segunda no toca nada', () => {
      const objetivo = '2010-08-20';
      const pasada = (textos: string[]) => textos.map((txt, i) => {
            const p = parteDeCombo(txt, '', i, MESES);
            if (!p) return 'no es fecha';
            const buscado = valorBuscado(p, objetivo, MESES);
            return yaMuestra(txt, buscado) ? 'salta' : `elige ${buscado[0]}`;
      });

      expect(pasada(['1', 'Enero', '2026'])).toEqual(['elige 20', 'elige agosto', 'elige 2010']);
      expect(pasada(['20', 'Agosto', '2010'])).toEqual(['salta', 'salta', 'salta']);
});

test('un combo vacío no cuenta como «ya muestra el valor»', () => {
      expect(yaMuestra('', ['20', '20'])).toBe(false);
      expect(yaMuestra('  ', ['20', '20'])).toBe(false);
});

// 🔴 LA PRUEBA QUE FIJA LA FRAGILIDAD DE LA INYECCIÓN. El autorrelleno del camino visual se serializa
// con `addInitScript`, así que la regla viaja como TEXTO —`Function.prototype.toString()`—. Eso sólo
// funciona mientras el borrado de tipos de Node deje un cuerpo que sea JS válido. Hoy lo deja; si una
// versión futura cambiara eso, la fuente inyectada sería un error de sintaxis EN EL NAVEGADOR, sin
// mensaje útil y a mitad de un flujo. Acá se cae una prueba en vez de eso.
test('la fuente inyectable es JS válido y se porta igual que el módulo', () => {
      const fuente = fuenteInyectable();
      expect(fuente).not.toMatch(/:\s*(string|number|boolean|ParteDeFecha)\b/);   // sin anotaciones sueltas

      const ventana: Record<string, any> = {};
      // `new Function` es el evaluador honesto acá: si la fuente no es JS válido, LANZA.
      new Function('window', fuente)(ventana);
      const trio = ventana.__trioFecha;

      expect(trio.MESES).toEqual(MESES);
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
      const { instalarAutorelleno } = await import('./autorelleno.ts');
      const context = await browser.newContext();
      await instalarAutorelleno(context);
      const page = await context.newPage();
      // Una página cualquiera: lo que se prueba es el init script, no el contenido.
      await page.setContent('<h1>Fecha de expedición</h1>');

      const enLaPagina = await page.evaluate(() => {
            const T = (window as any).__trioFecha;
            if (!T) return null;
            const textos = ['1', 'Enero', '2026'];
            const partes = textos.map((t, i) => T.parteDeCombo(t, '', i, T.MESES));
            const fecha = T.fechaDeLaPantalla(document.body.innerText, '1990-05-14', '2010-08-20');
            return {
                  partes,
                  esTrio: T.esTrioDeFecha(partes),
                  fecha,
                  elegidos: partes.map((p: any) => T.valorBuscado(p, fecha, T.MESES)[0]),
                  segundaPasada: ['20', 'Agosto', '2010'].map((t, i) =>
                        T.yaMuestra(t, T.valorBuscado(partes[i], fecha, T.MESES))),
            };
      });

      expect(enLaPagina, 'el init script de la regla no llegó a la página').not.toBeNull();
      expect(enLaPagina!.partes).toEqual(['dia', 'mes', 'anio']);
      expect(enLaPagina!.esTrio).toBe(true);
      expect(enLaPagina!.fecha).toBe('2010-08-20');            // lo dijo el <h1>
      expect(enLaPagina!.elegidos).toEqual(['20', 'agosto', '2010']);
      expect(enLaPagina!.segundaPasada).toEqual([true, true, true]);   // idempotente
      await context.close();
});

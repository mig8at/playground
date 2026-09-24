import { expect, test } from '@playwright/test';
import { DOCUMENT_LENGTH, DOCUMENT_CEILING, syntheticDocument } from './documentos.ts';

/**
 * Qué se fija acá: que el documento sintético tenga el largo del PAÍS.
 *
 * Es lógica pura. Se prueba porque el costo de no tenerlo está medido: con el largo colombiano fijo, el
 * recorrido de CeluRD (RD) moría en `request-personal-info` con «La cédula debe tener exactamente 11
 * dígitos» — un mensaje del producto para un hueco del harness, que manda a depurar el lado equivocado.
 */

const BASE = 1_095_449_405;

test.describe('el documento sale del país', () => {
      // 🔴 EL caso: RD pide 11 y el harness daba 10.
      test('cada país, su largo', () => {
            expect(syntheticDocument('DOM', 3, BASE)).toHaveLength(11);
            expect(syntheticDocument('COL', 3, BASE)).toHaveLength(10);
            expect(syntheticDocument('PER', 3, BASE)).toHaveLength(8);
      });

      test('un país que no está en la tabla cae al respaldo y no a una forma inventada', () => {
            expect(syntheticDocument('XXX', 3, BASE)).toHaveLength(10);
            expect(syntheticDocument('', 3, BASE)).toHaveLength(10);
      });

      test('el iso no distingue mayúsculas', () => {
            expect(syntheticDocument('dom', 7, BASE)).toBe(syntheticDocument('DOM', 7, BASE));
      });

      // 🔴 Los dos últimos dígitos son el índice: es lo que da uno distinto por caso, que es la condición
      // para correr en paralelo. Sin eso, dos casos comparten usuario y se pisan.
      test('cada caso mantiene su número propio', () => {
            for (const iso of Object.keys(DOCUMENT_LENGTH)) {
                  const hundred = new Set(Array.from({ length: 100 }, (_, i) => syntheticDocument(iso, i, BASE)));
                  expect(hundred.size, iso).toBe(100);
            }
      });

      // 🔴 Sólo dígitos, y sin cero adelante: varios validadores lo leen como número y ahí el largo se
      // pierde — un documento de 11 que viaja como 10 se rechaza por una razón que no se ve.
      test('sólo dígitos y nunca arranca en cero', () => {
            for (let i = 0; i < 100; i++) {
                  const d = syntheticDocument('DOM', i, BASE);
                  expect(d, `caso ${i}`).toMatch(/^[1-9][0-9]*$/);
            }
      });
});

/**
 * Y que CAIGA EN EL RANGO que el proveedor de KYC exige, que es una regla aparte del largo.
 *
 * ⚠ Esto no estaba, y el `BASE` de arriba —`1_095_449_405`, el mismo que ya usaban los casos del largo—
 * producía `9544940503`: tres veces por encima del techo. O sea que la suite fijaba la forma y dejaba
 * pasar el valor, y el caminador murió por eso el 2026-09-18 con un síntoma que no nombraba el
 * documento. Un test que mide una sola de las dos reglas no protege la otra: la hace parecer cubierta.
 */
test.describe('el documento cae en el rango que el backend acepta', () => {
      const CEILING = DOCUMENT_CEILING.COL;

      // 🔴 EL caso. Barrido, no un valor de muestra: el defecto dependía de QUÉ dígito quedaba primero
      // al cortar la cola, así que un solo ejemplo puede acertar de casualidad — de hecho el de arriba
      // fallaba y el de otro día habría pasado.
      test('ninguna base ni ningún índice se pasa del techo', () => {
            for (const base of [1_095_449_405, 1_090_000_000, 1_098_999_999, 1_030_000_003, 999_999_999]) {
                  for (const i of [0, 1, 7, 42, 99]) {
                        const doc = syntheticDocument('COL', i, base);
                        const n = Number(doc);

                        expect(n, `documentoSintetico('COL', ${i}, ${base}) = ${doc} se pasa del techo`)
                              .toBeLessThanOrEqual(CEILING);
                        expect(n, `documentoSintetico('COL', ${i}, ${base}) = ${doc} está por debajo del piso`)
                              .toBeGreaterThanOrEqual(10_000);
                        expect(doc).toHaveLength(DOCUMENT_LENGTH.COL);
                  }
            }
      });

      // El techo es de un `CC` colombiano y de nadie más: el backend lo condiciona a `$type === 'CC'`.
      // Si mañana alguien lo copia a los otros países «por simetría», el dominicano de 11 dígitos —que
      // por largo SIEMPRE supera 3e9— quedaría recortado a la fuerza y nadie lo notaría.
      test('el techo es sólo de Colombia: RD conserva sus 11 dígitos', () => {
            expect(DOCUMENT_CEILING.DOM).toBeUndefined();
            expect(syntheticDocument('DOM', 3, 1_095_449_405)).toHaveLength(11);
      });

      // Sigue valiendo lo que ya protegía la línea del `1`: un 0 adelante pierde el largo al leerse
      // como número. La corrección del techo reusa ese mismo lugar y no podía romperlo.
      test('el primer dígito nunca es 0', () => {
            for (const base of [1_000_000_000, 1_090_000_000, 100_000_000]) {
                  for (const i of [0, 5, 99]) {
                        expect(syntheticDocument('COL', i, base).startsWith('0')).toBe(false);
                        expect(syntheticDocument('PER', i, base).startsWith('0')).toBe(false);
                  }
            }
      });
});

import { expect, test } from '@playwright/test';
import { LARGO_DEL_DOCUMENTO, documentoSintetico } from './documentos.ts';

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
            expect(documentoSintetico('DOM', 3, BASE)).toHaveLength(11);
            expect(documentoSintetico('COL', 3, BASE)).toHaveLength(10);
            expect(documentoSintetico('PER', 3, BASE)).toHaveLength(8);
      });

      test('un país que no está en la tabla cae al respaldo y no a una forma inventada', () => {
            expect(documentoSintetico('XXX', 3, BASE)).toHaveLength(10);
            expect(documentoSintetico('', 3, BASE)).toHaveLength(10);
      });

      test('el iso no distingue mayúsculas', () => {
            expect(documentoSintetico('dom', 7, BASE)).toBe(documentoSintetico('DOM', 7, BASE));
      });

      // 🔴 Los dos últimos dígitos son el índice: es lo que da uno distinto por caso, que es la condición
      // para correr en paralelo. Sin eso, dos casos comparten usuario y se pisan.
      test('cada caso mantiene su número propio', () => {
            for (const iso of Object.keys(LARGO_DEL_DOCUMENTO)) {
                  const cien = new Set(Array.from({ length: 100 }, (_, i) => documentoSintetico(iso, i, BASE)));
                  expect(cien.size, iso).toBe(100);
            }
      });

      // 🔴 Sólo dígitos, y sin cero adelante: varios validadores lo leen como número y ahí el largo se
      // pierde — un documento de 11 que viaja como 10 se rechaza por una razón que no se ve.
      test('sólo dígitos y nunca arranca en cero', () => {
            for (let i = 0; i < 100; i++) {
                  const d = documentoSintetico('DOM', i, BASE);
                  expect(d, `caso ${i}`).toMatch(/^[1-9][0-9]*$/);
            }
      });
});

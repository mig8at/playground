// Qué se fija acá: que el móvil sintético tenga la forma del país. Es lógica pura — sin base, sin
// variables de entorno, sin red — así que corre contra cualquier target y no escribe en ningún lado.
//
// Se prueba porque un teléfono con la forma equivocada NO falla donde se arma: falla tres pantallas
// después, con un 422 del backend que habla de validación y no de países, o —peor— no falla y el país
// resuelto sale mal. Las dos derivaciones que esto reemplazó tenían cada una media lección, y ninguna
// tenía una prueba que lo dijera.
import { expect, test } from '@playwright/test';
import { FORMA_DEL_CELULAR, telefonoDelCodeudor, telefonoSintetico } from './telefonos.ts';

const BASE = 1_094_719_876;

test.describe('la forma del móvil sale del país', () => {
      test('cada país, su largo', () => {
            expect(telefonoSintetico('COL', 0, BASE)).toHaveLength(10);
            expect(telefonoSintetico('DOM', 0, BASE)).toHaveLength(10);
            expect(telefonoSintetico('PER', 0, BASE)).toHaveLength(9);
      });

      // 🔴 La lección que una de las dos copias NO tenía: en RD el área ES el país. Con un dígito
      // cualquiera el número se ubica en otro lado del NANP y el país resuelto sale mal SIN FALLAR,
      // que es el modo de error más caro.
      test('República Dominicana arranca en un área suya', () => {
            expect(telefonoSintetico('DOM', 7, BASE).startsWith('809')).toBe(true);
      });

      test('Colombia arranca en 3 y Perú en 9', () => {
            expect(telefonoSintetico('COL', 7, BASE).startsWith('3')).toBe(true);
            expect(telefonoSintetico('PER', 7, BASE).startsWith('9')).toBe(true);
      });

      // 🔴 Esto es lo que hace posible el paralelo: dos casos de la misma tanda NO pueden compartir
      // teléfono, porque compartirían usuario y la tanda entera deja de medir lo que dice medir.
      test('los dos últimos dígitos son el índice del caso', () => {
            expect(telefonoSintetico('COL', 0, BASE).slice(-2)).toBe('00');
            expect(telefonoSintetico('COL', 7, BASE).slice(-2)).toBe('07');
            expect(telefonoSintetico('COL', 42, BASE).slice(-2)).toBe('42');
            const tanda = new Set(Array.from({ length: 20 }, (_, i) => telefonoSintetico('PER', i, BASE)));
            expect(tanda.size).toBe(20);
      });

      test('el índice da la vuelta a los 100 sin cambiar el largo', () => {
            expect(telefonoSintetico('COL', 100, BASE)).toBe(telefonoSintetico('COL', 0, BASE));
            expect(telefonoSintetico('PER', 103, BASE)).toHaveLength(9);
      });

      // 🔴 El relleno sale de los ÚLTIMOS dígitos de la base. Si saliera de los primeros, dos tandas
      // del mismo día darían casi el mismo número —la base arranca con una constante— y chocarían.
      test('bases distintas dan teléfonos distintos', () => {
            expect(telefonoSintetico('COL', 1, 1_094_719_876)).not.toBe(telefonoSintetico('COL', 1, 1_094_711_111));
      });

      test('el largo del país pisa al de la tabla', () => {
            // `countries.cell_phone_lenght` es un DATO del ambiente: si dice otra cosa, manda ese.
            expect(telefonoSintetico('COL', 3, BASE, 8)).toHaveLength(8);
            expect(telefonoSintetico('COL', 3, BASE, 8).slice(-2)).toBe('03');
      });

      test('un país que no está en la tabla cae a Colombia y no a una forma inventada', () => {
            expect(telefonoSintetico('XXX', 5, BASE)).toBe(telefonoSintetico('COL', 5, BASE));
            expect(telefonoSintetico('', 5, BASE)).toHaveLength(FORMA_DEL_CELULAR.COL.largo);
      });

      test('el iso no distingue mayúsculas', () => {
            expect(telefonoSintetico('per', 5, BASE)).toBe(telefonoSintetico('PER', 5, BASE));
      });
});

test.describe('el teléfono del codeudor', () => {
      test('es distinto del titular, mismo largo, y reproducible', () => {
            const titular = telefonoSintetico('COL', 7, BASE);
            const codeudor = telefonoDelCodeudor(titular);

            expect(codeudor).not.toBe(titular);
            expect(codeudor).toHaveLength(titular.length);
            expect(codeudor).toBe(telefonoDelCodeudor(titular));
            expect(codeudor.endsWith('99')).toBe(true);
      });
});

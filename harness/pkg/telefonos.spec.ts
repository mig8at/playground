// Qué se fija acá: que el móvil sintético tenga la forma del país. Es lógica pura — sin base, sin
// variables de entorno, sin red — así que corre contra cualquier target y no escribe en ningún lado.
//
// Se prueba porque un teléfono con la forma equivocada NO falla donde se arma: falla tres pantallas
// después, con un 422 del backend que habla de validación y no de países, o —peor— no falla y el país
// resuelto sale mal. Las dos derivaciones que esto reemplazó tenían cada una media lección, y ninguna
// tenía una prueba que lo dijera.
import { expect, test } from '@playwright/test';
import { PHONE_SHAPE, coSignerPhone, syntheticPhone } from './telefonos.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** La regla del FRONT. Es una copia — el harness es otro repo y no puede importar de `@creditop/*` —,
 *  así que más abajo hay un caso que la compara contra el archivo real y avisa si derivó. */
const COLOMBIAN_PHONE_REGEX = /^3[0-5][0-9]{8}$/;
const RULE_SOURCE = join(
      homedir(), 'Desktop/CREDITOP/github/frontend-monorepo/packages/shared/utils/src/phone/config.ts');

const BASE = 1_094_719_876;

test.describe('la forma del móvil sale del país', () => {
      test('cada país, su largo', () => {
            expect(syntheticPhone('COL', 0, BASE)).toHaveLength(10);
            expect(syntheticPhone('DOM', 0, BASE)).toHaveLength(10);
            expect(syntheticPhone('PER', 0, BASE)).toHaveLength(9);
      });

      // 🔴 La lección que una de las dos copias NO tenía: en RD el área ES el país. Con un dígito
      // cualquiera el número se ubica en otro lado del NANP y el país resuelto sale mal SIN FALLAR,
      // que es el modo de error más caro.
      test('República Dominicana arranca en un área suya', () => {
            expect(syntheticPhone('DOM', 7, BASE).startsWith('809')).toBe(true);
      });

      test('Colombia arranca en 3 y Perú en 9', () => {
            expect(syntheticPhone('COL', 7, BASE).startsWith('3')).toBe(true);
            expect(syntheticPhone('PER', 7, BASE).startsWith('9')).toBe(true);
      });

      // 🔴 Esto es lo que hace posible el paralelo: dos casos de la misma tanda NO pueden compartir
      // teléfono, porque compartirían usuario y la tanda entera deja de medir lo que dice medir.
      test('los dos últimos dígitos son el índice del caso', () => {
            expect(syntheticPhone('COL', 0, BASE).slice(-2)).toBe('00');
            expect(syntheticPhone('COL', 7, BASE).slice(-2)).toBe('07');
            expect(syntheticPhone('COL', 42, BASE).slice(-2)).toBe('42');
            const round = new Set(Array.from({ length: 20 }, (_, i) => syntheticPhone('PER', i, BASE)));
            expect(round.size).toBe(20);
      });

      test('el índice da la vuelta a los 100 sin cambiar el largo', () => {
            expect(syntheticPhone('COL', 100, BASE)).toBe(syntheticPhone('COL', 0, BASE));
            expect(syntheticPhone('PER', 103, BASE)).toHaveLength(9);
      });

      // 🔴 El relleno sale de los ÚLTIMOS dígitos de la base. Si saliera de los primeros, dos tandas
      // del mismo día darían casi el mismo número —la base arranca con una constante— y chocarían.
      test('bases distintas dan teléfonos distintos', () => {
            expect(syntheticPhone('COL', 1, 1_094_719_876)).not.toBe(syntheticPhone('COL', 1, 1_094_711_111));
      });

      test('el largo del país pisa al de la tabla', () => {
            // `countries.cell_phone_lenght` es un DATO del ambiente: si dice otra cosa, manda ese.
            expect(syntheticPhone('COL', 3, BASE, 8)).toHaveLength(8);
            expect(syntheticPhone('COL', 3, BASE, 8).slice(-2)).toBe('03');
      });

      test('un país que no está en la tabla cae a Colombia y no a una forma inventada', () => {
            expect(syntheticPhone('XXX', 5, BASE)).toBe(syntheticPhone('COL', 5, BASE));
            expect(syntheticPhone('', 5, BASE)).toHaveLength(PHONE_SHAPE.COL.largo);
      });

      test('el iso no distingue mayúsculas', () => {
            expect(syntheticPhone('per', 5, BASE)).toBe(syntheticPhone('PER', 5, BASE));
      });
});

test.describe('el teléfono del codeudor', () => {
      test('es distinto del titular, mismo largo, y reproducible', () => {
            const holder = syntheticPhone('COL', 7, BASE);
            const coSigner = coSignerPhone(holder);

            expect(coSigner).not.toBe(holder);
            expect(coSigner).toHaveLength(holder.length);
            expect(coSigner).toBe(coSignerPhone(holder));
            expect(coSigner.endsWith('99')).toBe(true);
      });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// El número generado tiene que pasar la validación DEL FRONT, no sólo parecerse a un móvil.
//
// El caso que lo motivó (2026-09-18): con el prefijo en `3`, el segundo dígito salía de la base de la
// corrida y podía caer entre 6 y 9 — `3609420000`—. El front valida `^3[0-5][0-9]{8}$`, así que lo
// rechazaba y el canal de asesor moría en la PRIMERA pantalla con «Ingresa un número de teléfono
// colombiano válido». Y como depende de la base, fallaba unas corridas sí y otras no: el peor modo,
// porque se lee como un problema del producto y no se reproduce cuando lo vas a mirar.
// ─────────────────────────────────────────────────────────────────────────────────────────────
test.describe('el móvil colombiano pasa la validación del front', () => {
      // 🔴 Contra la expresión REAL del front, reexportada por `telefonos.ts` — no contra una copia. Una
      // copia se queda vieja el día que el front acepte un prefijo nuevo, y este test diría que sí.
      test('cien casos seguidos, todos válidos', () => {
            for (let i = 0; i < 100; i++) {
                  const tel = syntheticPhone('COL', i, 1095360942);
                  expect(tel, `caso ${i}`).toMatch(COLOMBIAN_PHONE_REGEX);
            }
      });

      // 🔴 El que rompió: una base cuyos dígitos empujaban el segundo carácter fuera de 0-5.
      test('la base de la corrida no puede sacar el segundo dígito de rango', () => {
            for (const base of [1095360942, 1099999999, 1096666666, 1098888888]) {
                  expect(syntheticPhone('COL', 7, base)).toMatch(COLOMBIAN_PHONE_REGEX);
            }
      });

      // 🔴 Y sigue habiendo uno distinto por caso, que es la condición para correr en paralelo.
      test('cada caso mantiene su número propio', () => {
            const hundred = new Set(Array.from({ length: 100 }, (_, i) => syntheticPhone('COL', i, 1095360942)));

            expect(hundred.size).toBe(100);
      });

      // 🔴 EL caso que evita que esta copia envejezca en silencio. Si el front acepta un prefijo nuevo y
      // acá no nos enteramos, el generador va a seguir produciendo números válidos —no rompe— pero
      // vamos a estar probando un subconjunto sin saberlo. Y al revés es peor: si el front se vuelve
      // MÁS estricto, las corridas empiezan a morir en la primera pantalla por una razón que no es del
      // producto, que es exactamente lo que acaba de pasar.
      test('la copia de la regla sigue igual a la del front', () => {
            test.skip(!existsSync(RULE_SOURCE), `no está el monorepo en ${RULE_SOURCE}`);

            const source = readFileSync(RULE_SOURCE, 'utf8');
            const declared = /COLOMBIAN_PHONE_REGEX\s*=\s*(\/[^\n;]+\/)/.exec(source)?.[1];

            expect(declared, 'no encontré COLOMBIAN_PHONE_REGEX en el archivo del front').toBeTruthy();
            expect(declared).toBe(String(COLOMBIAN_PHONE_REGEX));
      });
});

import { expect, test } from '@playwright/test';
import { evidenceNotice } from './wizard-browser.ts';

/**
 * Qué se fija acá: que un caso que CIERRA BIEN pero ensució la consola igual lo diga.
 *
 * Hasta el 2026-09-18 el caminador del wizard volcaba la consola y la red **sólo si el caso había
 * fallado**. O sea que una corrida podía llegar a estado 11 con el navegador tirando errores y el
 * reporte no decía una palabra — el mismo patrón que dejó vivir a F-227 dos meses: lo que nadie mira,
 * nadie arregla.
 *
 * Se prueba acá y no corriendo porque es la rama más difícil de alcanzar de verdad: hace falta un caso
 * que cierre Y que además haya ensuciado la consola, y en local los que ensucian son justo los que no
 * cierran (medido el mismo día: el único que ensució murió en `validar-persona` por `ADO_HOST` sin
 * configurar, o sea por la rama de fallo). Una rama escrita y nunca ejercitada es como se cuelan los
 * errores que nadie ve hasta que importan.
 */

test.describe('el aviso de evidencia de un caso que cerró', () => {
      test('sin nada que decir, no dice nada', () => {
            expect(evidenceNotice([], [])).toEqual([]);
      });

      // 🔴 Cuenta las dos fuentes por separado: «3 de consola y 2 de red» ubica el problema antes de abrir
      // la traza. Un «5 errores» a secas no distingue un front roto de un backend caído.
      test('cuenta consola y red por separado', () => {
            const lines = evidenceNotice(['error: a', 'error: b', 'error: c'], ['HTTP 500 GET /x', 'HTTP 404 GET /y']);

            expect(lines[0]).toContain('3 de consola y 2 de red');
      });

      test('con una sola fuente, no inventa la otra', () => {
            expect(evidenceNotice(['error: a'], [])[0]).toContain('1 de consola');
            expect(evidenceNotice(['error: a'], [])[0]).not.toContain('de red');
            expect(evidenceNotice([], ['HTTP 500 GET /x'])[0]).toContain('1 de red');
      });

      // 🔴 NO dice «falló» y NO cambia el veredicto: el caso cerró. Si esto se leyera como un fallo, la
      // primera reacción sería silenciarlo, y ahí se pierde la señal entera.
      test('invita a mirar, no declara un fallo', () => {
            const lines = evidenceNotice(['error: a'], []);

            expect(lines[0]).toContain('cerró');
            expect(lines[0]).toContain('no cambia el veredicto');
            expect(lines[0]).not.toMatch(/fall[óo]|error del caso/i);
      });

      // 🔴 Acotado a propósito: un volcado entero en cada caso feliz vuelve la tanda ilegible, y una
      // tanda ilegible se aprende a saltear. La traza en disco queda para el detalle.
      test('muestra unas pocas líneas, no el volcado entero', () => {
            const many = Array.from({ length: 30 }, (_, i) => `error: ${i}`);

            expect(evidenceNotice(many, []).length).toBe(1 + 3);
            expect(evidenceNotice(many, [], 1).length).toBe(1 + 1);
      });
});

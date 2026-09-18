import { expect, test } from '@playwright/test';
import { esRuidoDeLocal } from './wizard-navegador.ts';

/**
 * Qué se fija acá: que el filtro de ruido **no se coma la señal**.
 *
 * Los dos caminadores con navegador descartan los errores de consola conocidos de local, porque sin eso
 * cuatro líneas de WebSocket tapan el informe entero. El riesgo de un filtro así es el opuesto y es
 * peor: silenciar algo que importaba, y que nadie se entere nunca — un filtro que filtra de más no
 * falla, deja la pantalla en verde.
 *
 * El caso que lo motivó: el patrón era `hydrat` a secas, así que se comía **todos** los avisos de
 * hidratación de React. Y la hidratación es el modo de falla nº1 de este canal: si el DOM del servidor y
 * el del cliente no coinciden, react-hook-form monta con sus defaults, el formulario queda inválido y
 * **el botón nunca se habilita, sin un solo mensaje de error**. O sea que el filtro estaba tapando
 * justo la pista de la trampa más cara.
 *
 * Es lógica pura: no abre navegador, no toca BD y no depende del target.
 */

test.describe('el filtro de ruido de local', () => {
      // 🔴 EL caso. El `nonce` sí es ruido —y está medido por qué: en `react-router dev` no se manda
      // cabecera CSP, así que el navegador no vacía el atributo y el cliente renderiza `nonce=""`—,
      // pero un mismatch de CUALQUIER otro atributo tiene que pasar el filtro y verse.
      test('descarta la hidratación del nonce y deja pasar cualquier otra', () => {
            const delNonce = 'A tree hydrated but some attributes of the server rendered HTML didn\'t match'
                  + ' the client properties. <script + nonce="" - nonce="yhopWL14+9f/xNUx4omRiQ==" >';
            const deUnCampo = 'A tree hydrated but some attributes of the server rendered HTML didn\'t match'
                  + ' the client properties. <input + value="" - value="3131010101" >';

            expect(esRuidoDeLocal(delNonce)).toBe(true);
            expect(esRuidoDeLocal(deUnCampo)).toBe(false);
      });

      // 🔴 El `nonce` aparece en el DIFF de React, muy después del encabezado. Por eso la función pide el
      // mensaje COMPLETO: decidir sobre un texto ya recortado hacía que esta regla no mordiera nunca.
      test('reconoce el nonce aunque venga al final de un mensaje largo', () => {
            const largo = 'A tree hydrated but some attributes didn\'t match. ' + 'x'.repeat(1200) + ' nonce="abc"';

            expect(esRuidoDeLocal(largo)).toBe(true);
      });

      test('el WebSocket de Echo que no resuelve en local es ruido', () => {
            expect(esRuidoDeLocal('WebSocket connection to \'wss://ws.credito/app/x\' failed: ERR_NAME_NOT_RESOLVED')).toBe(true);
      });

      // 🔴 Lo que NUNCA puede filtrarse: un error de verdad del producto.
      test('un error real del producto no es ruido', () => {
            expect(esRuidoDeLocal('Uncaught TypeError: Cannot read properties of undefined (reading \'value\')')).toBe(false);
            expect(esRuidoDeLocal('No routes matched location "/self-service/abc/continue"')).toBe(false);
            expect(esRuidoDeLocal('The API version "5.4.296" does not match the Worker version "5.4.449"')).toBe(false);
      });
});

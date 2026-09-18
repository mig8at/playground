// Qué se fija acá: que lo que el arnés emite con `MD=1` sea lo que el tablero PARSEA. Es lógica pura
// —sin base, sin red, sin variables de entorno— así que corre contra cualquier target.
//
// Se prueba porque el modo de falla es silencioso en los dos extremos: la anotación se pega en la
// tarea, se ve bien en el markdown, y la pestaña Hallazgos no la muestra — o la muestra sin fuentes,
// que es peor, porque la tarjeta afirma «esto no dice con qué se comprobó» sobre una medición que sí
// lo decía. Nada falla; sólo se pierde el dato.
import { expect, test } from '@playwright/test';
import { anotacionMD, cmdMake } from './anotacion.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOY = new Date().toLocaleDateString('sv-SE');

test.describe('la anotación tiene la forma que el tablero parsea', () => {
      test('el marcador con tipo y fecha arranca la primera línea', () => {
            const md = anotacionMD('1/1 cerraron.', 'make harness-caso CASOS=pullman TARGET=local');
            expect(md.startsWith(`> **MEDICIÓN · ${HOY}** — `)).toBe(true);
      });

      test('NINGUNA línea se sale de la cita', () => {
            // Una línea fuera de `>` corta el bloque, y todo lo que sigue deja de ser parte de la
            // anotación: el `Cómo` queda huérfano y la medición pierde justo su fuente.
            const md = anotacionMD('x', 'make harness-caso TARGET=local', ['una', '', 'otra']);
            for (const l of md.trimEnd().split('\n')) expect(l.startsWith('>')).toBe(true);
      });

      test('el comando cierra como «Cómo se vuelve a comprobar»', () => {
            const cmd = 'make harness-caso CASOS=pullman TARGET=local';
            expect(anotacionMD('x', cmd)).toContain(`**Cómo se vuelve a comprobar:** \`${cmd}\``);
      });

      test('una línea vacía separa sin salirse de la cita', () => {
            expect(anotacionMD('x', 'make y TARGET=local', ['a', '', 'b'])).toContain('\n>\n');
      });
});

test.describe('el comando que se ofrece es pegable', () => {
      test('el TARGET va SIEMPRE, aunque sea el default', () => {
            // ⚠ El default de `E2E_TARGET` es `dev`, no `local` — una anotación sin ambiente no se
            // puede contrastar, y acá dev y staging comparten base.
            expect(cmdMake('harness-caso', 'dev')).toBe('make harness-caso TARGET=dev');
      });

      test('lo que el shell partiría va entrecomillado', () => {
            const c = cmdMake('harness-caso', 'local', { CASOS: 'pullman@meddipay=rechaza;x@income=900000' });
            expect(c).toContain(`CASOS='pullman@meddipay=rechaza;x@income=900000'`);
      });

      test('los vacíos no se imprimen: `CASOS=` solo ensucia', () => {
            expect(cmdMake('harness-listado', 'local', { COMERCIO: '', MONTO: undefined }))
                  .toBe('make harness-listado TARGET=local');
      });
});

// ⚠ LA PRUEBA QUE DE VERDAD IMPORTA: el contrato no lo define este archivo, lo define el parser del
// tablero. Acá se lee su regex REAL y se comprueba contra ella — si alguien la cambia allá, esto se
// entera. Sin esto, las de arriba sólo verifican que el arnés es consistente consigo mismo, que es
// exactamente el error que ya costó caro con los mocks (un mock no puede contradecir el documento del
// que nació).
test('la forma coincide con el regex REAL de `store.Anotaciones`', () => {
      const fuente = join(homedir(),
            'Desktop/CREDITOP/playground/tablero/server/internal/store/anotaciones.go');
      test.skip(!existsSync(fuente), `no está ${fuente}: el contrato queda SIN contrastar`);

      const go = readFileSync(fuente, 'utf8');
      const m = /reAnotacion\s*=\s*regexp\.MustCompile\(`([^`]+)`\)/.exec(go);
      expect(m, 'no encontré `reAnotacion` en anotaciones.go — ¿se renombró?').toBeTruthy();

      // El patrón de Go es compatible con JS salvo el flag inline `(?i)`, que JS no acepta inline.
      const patron = m![1].replace('(?i)', '');
      const re = new RegExp(patron, 'i');
      const primera = anotacionMD('uReq 1 en `local`: cerró.', 'make harness-caso TARGET=local').split('\n')[0];
      expect(re.test(primera.trim()),
            `el parser del tablero NO reconoce la primera línea:\n  ${primera}\n  patrón: ${patron}`).toBe(true);
});

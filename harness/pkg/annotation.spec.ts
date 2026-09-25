// Qué se fija acá: que lo que el arnés emite sea lo que el tablero entiende — el bloque de `BLOQUE=`,
// el que acepta su validador, y la anotación de `MD=1`, la que reconoce su regex. Es lógica pura —sin
// base, sin red, sin variables de entorno— así que corre contra cualquier target.
//
// ⚠ Desde el 2026-09-23 una anotación ya no va en una TAREA: lo que se mide para una tarea entra a su
// pila como bloque, con `BLOQUE=`. La de `MD=1` es para los documentos que no son una tarea —un
// `CLAUDE.md`, una trampa del sistema—, y el tablero la reconoce para frenarla si alguien la pega en
// una tarea. Se prueba porque el modo de falla es silencioso: una forma que el tablero no reconoce se
// ve bien en el markdown y nadie se entera de que no es lo que dice ser.
import { expect, test } from '@playwright/test';
import { addBlock, annotationMD, blockMD, cmdMake } from './annotation.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TODAY = new Date().toLocaleDateString('sv-SE');

test.describe('la anotación tiene la forma que el tablero parsea', () => {
      test('el marcador con tipo y fecha arranca la primera línea', () => {
            const md = annotationMD('1/1 cerraron.', 'make harness-case CASES=pullman TARGET=local');
            expect(md.startsWith(`> **MEDICIÓN · ${TODAY}** — `)).toBe(true);
      });

      test('NINGUNA línea se sale de la cita', () => {
            // Una línea fuera de `>` corta el bloque, y todo lo que sigue deja de ser parte de la
            // anotación: el `Cómo` queda huérfano y la medición pierde justo su fuente.
            const md = annotationMD('x', 'make harness-case TARGET=local', ['una', '', 'otra']);
            for (const l of md.trimEnd().split('\n')) expect(l.startsWith('>')).toBe(true);
      });

      test('el comando cierra como «Cómo se vuelve a comprobar»', () => {
            const cmd = 'make harness-case CASES=pullman TARGET=local';
            expect(annotationMD('x', cmd)).toContain(`**Cómo se vuelve a comprobar:** \`${cmd}\``);
      });

      test('una línea vacía separa sin salirse de la cita', () => {
            expect(annotationMD('x', 'make y TARGET=local', ['a', '', 'b'])).toContain('\n>\n');
      });
});

test.describe('el comando que se ofrece es pegable', () => {
      test('el TARGET va SIEMPRE, aunque sea el default', () => {
            // ⚠ El default de `E2E_TARGET` es `dev`, no `local` — una anotación sin ambiente no se
            // puede contrastar, y acá dev y staging comparten base.
            expect(cmdMake('harness-case', 'dev')).toBe('make harness-case TARGET=dev');
      });

      test('lo que el shell partiría va entrecomillado', () => {
            const c = cmdMake('harness-case', 'local', { CASOS: 'pullman@meddipay=rechaza;x@income=900000' });
            expect(c).toContain(`CASOS='pullman@meddipay=rechaza;x@income=900000'`);
      });

      test('los vacíos no se imprimen: `CASOS=` solo ensucia', () => {
            expect(cmdMake('harness-listing', 'local', { COMERCIO: '', MONTO: undefined }))
                  .toBe('make harness-listing TARGET=local');
      });
});

// ⚠ LA PRUEBA QUE DE VERDAD IMPORTA: el contrato no lo define este archivo, lo define el parser del
// tablero. Acá se lee su regex REAL y se comprueba contra ella — si alguien la cambia allá, esto se
// entera. Sin esto, las de arriba sólo verifican que el arnés es consistente consigo mismo, que es
// exactamente el error que ya costó caro con los mocks (un mock no puede contradecir el documento del
// que nació).
test('la forma coincide con el regex REAL con que el tablero reconoce una anotación', () => {
      const source = join(homedir(),
            'Desktop/CREDITOP/playground/tablero/server/internal/store/annotations.go');
      test.skip(!existsSync(source), `no está ${source}: el contrato queda SIN contrastar`);

      const go = readFileSync(source, 'utf8');
      const m = /reAnnotation\s*=\s*regexp\.MustCompile\(`([^`]+)`\)/.exec(go);
      expect(m, 'no encontré `reAnnotation` en annotations.go — ¿se renombró?').toBeTruthy();

      // El patrón de Go es compatible con JS salvo el flag inline `(?i)`, que JS no acepta inline.
      const pattern = m![1].replace('(?i)', '');
      const re = new RegExp(pattern, 'i');
      const first = annotationMD('uReq 1 en `local`: cerró.', 'make harness-case TARGET=local').split('\n')[0];
      expect(re.test(first.trim()),
            `el tablero NO reconoce la primera línea:\n  ${first}\n  patrón: ${pattern}`).toBe(true);
});

test.describe('el bloque que emite con BLOQUE=<tarea> es el que el tablero acepta', () => {
      test('título en una línea de hasta 120, el comando en su caja y lo que dio', () => {
            const md = blockMD('x'.repeat(200) + '.', 'make harness-case TARGET=local',
                  ['✔ pullman · cerró', '✘ otro · <div> en /Users/yo/log']);
            const [title] = md.split('\n');
            expect(title.startsWith('# ')).toBe(true);
            expect([...title.slice(2)].length).toBeLessThanOrEqual(120);
            // El HTML y las rutas de esta máquina se neutralizan antes: el validador los rechazaría, y un
            // mensaje de error de la corrida no puede dejar a la tarea sin su bloque.
            expect(md).toContain('```harness\nmake harness-case TARGET=local\n```\nResultado: ✔ pullman · cerró; ✘ otro · ‹div› en …/log');
      });

      // ⚠ LA QUE IMPORTA: quien decide si el bloque entra es el validador del tablero, no este archivo. Se
      // le pregunta al de verdad y en seco (`make tarea-bloque … SECO=1`): si allá cambia una regla, acá se
      // nota — que es lo que una copia de sus reglas en TypeScript no haría nunca.
      test('el validador del tablero lo acepta, en seco', () => {
            const md = blockMD('2/2 caso(s) en `local`.', cmdMake('harness-case', 'local', { CASOS: 'pullman@meddipay=rechaza' }),
                  ['✔ pullman · uReq 123 · listado [23, 141]']);
            const { ok, salida: output } = addBlock('tablero', md, true);
            expect(output).toContain('-n: no se escribió');
            expect(ok).toBe(true);
      });
});

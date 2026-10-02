// Qué se fija acá: lo que queda en el harness del comercio de prueba. El cliente del admin, las cookies, el token CSRF y la lectura de
// las páginas de Inertia ahora son del conector `admin` (Go) y se prueban allá (`connectors/admin/admin_test.go`). Acá: cómo se lee lo
// que el conector devuelve. No abre navegador, no toca la red ni la base: el alta de verdad se prueba corriéndola
// (`make harness-allied-create TARGET=local CLEANUP=1`).
import { expect, test } from '@playwright/test';
import { AUTO_PREFIX, parseCreated } from './allied-admin.ts';
import { lastLine } from './pg.ts';

const CREATED = JSON.stringify({
      id: 350, name: 'PRUEBA AUTO 1002-141553', elapsed_ms: 8800,
      flash: { created: true, existed: false, cognito: 'created', email: 'c369f2ee4-fake@creditop.com', password_fixed: true, branch_name: 'b369f2ee4-fake', notes: ['uno'] },
});

test.describe('lo que devuelve el conector del admin', () => {
      // 🔴 Los campos del JSON de Go van en snake_case (`password_fixed`, `branch_name`, `elapsed_ms`) y los del harness en camelCase:
      // si el mapeo se pierde, el asesor se ve «sin clave fija» y sin sucursal sin que nada falle.
      test('el alta se lee con sus campos, en el formato del harness', () => {
            const c = parseCreated(CREATED, '  Va a CREARSE…\n    actúa como DUNCAN ESTRADA (duncan.estrada@creditop.com)\n');
            expect(c).toMatchObject({ id: 350, name: 'PRUEBA AUTO 1002-141553', ms: 8800, actingAs: 'DUNCAN ESTRADA (duncan.estrada@creditop.com)' });
            expect(c.flash).toEqual({ created: true, existed: false, cognito: 'created', email: 'c369f2ee4-fake@creditop.com', passwordFixed: true, branchName: 'b369f2ee4-fake', notes: ['uno'] });
      });

      test('sin flash (versión del admin sin la función) el flash es null', () => {
            expect(parseCreated(JSON.stringify({ id: 1, name: 'PRUEBA AUTO x', elapsed_ms: 1 })).flash).toBeNull();
      });

      // 🔴 Una respuesta sin id no puede pasar por «creado»: después se verificaría y borraría el comercio equivocado.
      test('una respuesta sin id se rechaza', () => {
            expect(() => parseCreated(JSON.stringify({ name: 'x' }))).toThrow(/no trae el id/);
            expect(() => parseCreated('no es json')).toThrow();
      });

      test('si el conector no dijo con quién actuó, queda vacío y no inventa', () => {
            expect(parseCreated(CREATED, '').actingAs).toBe('');
      });
});

test.describe('el prefijo de la automatización', () => {
      // El permiso angosto de borrado (`prueba-comercio`) y la sentencia exigen exactamente este prefijo.
      test('es el que reconoce el borrado', () => {
            expect(AUTO_PREFIX).toBe('PRUEBA AUTO');
      });
});

test.describe('el error de un comando', () => {
      test('la última línea útil, sin el prefijo de pg', () => {
            expect(lastLine('pg: no hay sesión de admin\n\n')).toBe('no hay sesión de admin');
            expect(lastLine('')).toBe('');
      });
});

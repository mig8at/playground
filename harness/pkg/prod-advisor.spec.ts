// Qué se fija acá: cómo se juzga a un asesor de prueba de producción y cómo se arma la consulta. Lo puro: no toca red, ni base, ni AWS. La lectura
// de verdad se comprueba corriéndola (`make harness-prod-advisor ALLIED=<id>`).
import { expect, test } from '@playwright/test';
import {
    advisorQuery, buildChecks, exitCodeOf, hintsOf, safeEmail, safeId, verdictOf, PROD_LOGIN_HOST,
    type AdvisorRow, type PoolState,
} from './prod-advisor.ts';

const SUB = '110b85c0-2011-70a5-f994-838599e91de9';
const advisor = (over: Partial<AdvisorRow> = {}): AdvisorRow => ({
    id: 431929, email: 'c9aa92333-fake@creditop.com', allied_id: 363, allied_name: 'Comercio Demo', branch_id: 2400, branch_name: 'b9aa92333-fake',
    user_profile_id: 4, is_test: 1, test_reason: 'manual', cognito_id: SUB, created_at: '2026-10-08T15:27:15', ...over,
});
const poolOk: PoolState = { state: 'existe', status: 'CONFIRMED', enabled: true, sub: SUB };
const hosted = { host: PROD_LOGIN_HOST, clientId: 'x' };

test.describe('el veredicto del asesor de prueba de producción', () => {
    test('todo bien: lista, y sale con 0', () => {
        const v = verdictOf(buildChecks(advisor(), poolOk, hosted));
        expect(v).toBe('lista');
        expect(exitCodeOf(v)).toBe(0);
    });

    // 🔴 El caso del 2026-10-08: el admin creó al asesor en la base y la cuenta del pool no existía.
    test('sin cuenta en el pool ni cognito_id: con problemas, y dice que reintente la cuenta', () => {
        const a = advisor({ cognito_id: null });
        const pool: PoolState = { state: 'no-existe' };
        expect(verdictOf(buildChecks(a, pool, hosted))).toBe('con-problemas');
        expect(hintsOf(a, pool).join(' ')).toMatch(/Reintentar cuenta de Cognito/);
    });

    test('un sub distinto del cognito_id es un problema, aunque la cuenta exista', () => {
        const pool: PoolState = { state: 'existe', status: 'CONFIRMED', enabled: true, sub: 'otro-sub' };
        const checks = buildChecks(advisor(), pool, hosted);
        expect(checks.find((c) => c.label.includes('sub'))?.ok).toBe(false);
        expect(hintsOf(advisor(), pool).join(' ')).toMatch(/no es el sub del pool/);
    });

    test('una cuenta pendiente de clave o deshabilitada no está lista', () => {
        expect(verdictOf(buildChecks(advisor(), { ...poolOk, status: 'FORCE_CHANGE_PASSWORD' } as PoolState, hosted))).toBe('con-problemas');
        expect(verdictOf(buildChecks(advisor(), { ...poolOk, enabled: false } as PoolState, hosted))).toBe('con-problemas');
    });

    test('sin acceso al pool no se afirma nada: queda sin comprobar y sale con 2', () => {
        const v = verdictOf(buildChecks(advisor(), { state: 'sin-acceso', motivo: 'venció' }, hosted));
        expect(v).toBe('sin-comprobar');
        expect(exitCodeOf(v)).toBe(2);
    });

    test('un problema gana sobre lo no comprobado', () => {
        const v = verdictOf(buildChecks(advisor({ cognito_id: null }), { state: 'sin-acceso', motivo: 'venció' }, hosted));
        expect(v).toBe('con-problemas');
    });

    test('is_test distinto de 1 se marca: no parece un usuario de prueba', () => {
        const checks = buildChecks(advisor({ is_test: 0 }), poolOk, hosted);
        expect(checks.find((c) => c.label.includes('usuario de prueba'))?.ok).toBe(false);
    });

    test('un wizard que manda a otro login no está bien', () => {
        const checks = buildChecks(advisor(), poolOk, { host: 'auth.merchant.creditop.com', clientId: 'y' });
        expect(checks.find((c) => c.label.includes('login'))?.ok).toBe(false);
    });

    test('sin asesor: una sola comprobación fallida y qué hacer', () => {
        const checks = buildChecks(null, null, hosted);
        expect(checks).toHaveLength(1);
        expect(verdictOf(checks)).toBe('con-problemas');
        expect(hintsOf(null, null).join(' ')).toMatch(/Crear el asesor/);
    });
});

test.describe('la consulta solo interpola lo que se puede interpolar', () => {
    test('por comercio y por correo exacto', () => {
        expect(advisorQuery({ allied: 363 })).toContain("u.allied_id = 363 AND u.email LIKE 'c%-fake@%'");
        expect(advisorQuery({ email: 'c9aa92333-fake@creditop.com' })).toContain("u.email = 'c9aa92333-fake@creditop.com'");
        expect(advisorQuery({ allied: 1 })).toMatch(/^SELECT /);
    });

    // 🔴 La consulta va al conector de solo lectura, pero un correo con comillas no debe llegar ni a armarla.
    test('un correo o un id con algo raro no llegan a la consulta', () => {
        expect(() => safeEmail("a@b.com' OR '1'='1")).toThrow(/correo inválido/);
        expect(() => safeEmail('sin-arroba')).toThrow();
        expect(() => safeId('1; DROP TABLE users')).toThrow(/id inválido/);
        expect(() => safeId('-3')).toThrow();
        expect(() => safeId('0')).toThrow();
        expect(safeId('363')).toBe(363);
    });
});

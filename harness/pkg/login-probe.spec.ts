// Qué se fija acá: la parte PURA de la sonda de login del asesor de prueba. No abre navegador, no toca la
// base ni la red: el login real se prueba corriéndolo (`make harness-login-check`).
//
// Se prueba porque cada una de estas piezas decide qué se le dice a quien lee la tabla: si «a qué login
// manda el front» se parsea mal, el diagnóstico culpa al pool equivocado; si el exit code deja pasar un
// «no se pudo probar» como verde, un ambiente sin probar se lee como ambiente sano.
import { expect, test } from '@playwright/test';
import {
    TEST_ADVISOR_EMAIL, exitCodeOf, notProbed, parseHostedUi, renderLoginTable, stageOfUrl, type LoginResult,
} from './login-probe.ts';

const AUTHORIZE = 'https://auth.merchant.creditop.com/oauth2/authorize?client_id=il7p9uebtjjaoaqc6q9brg6f'
    + '&response_type=code&redirect_uri=https%3A%2F%2Foriginaciones-qa.dev.creditop.com%2Fauth%2Fcallback';

const result = (patch: Partial<LoginResult>): LoginResult => ({ ...notProbed({ veredicto: 'entró', detalle: 'ok' }), target: 'dev', ...patch });

test.describe('¿a qué login manda el front?', () => {
    test('saca el host, el client_id y a dónde vuelve', () => {
        expect(parseHostedUi(AUTHORIZE)).toEqual({
            host: 'auth.merchant.creditop.com',
            clientId: 'il7p9uebtjjaoaqc6q9brg6f',
            redirectHost: 'originaciones-qa.dev.creditop.com',
        });
    });

    // 🔴 Una URL de la propia app no es un login: sin `client_id` no hay nada que descubrir, y devolver
    // algo haría seguir una redirección intermedia como si fuera el destino.
    test('una URL sin client_id no es un login', () => {
        expect(parseHostedUi('https://originaciones-qa.dev.creditop.com/login')).toBeNull();
        expect(parseHostedUi('esto no es una url')).toBeNull();
    });
});

test.describe('¿en qué paso se quedó?', () => {
    const app = 'originaciones-qa.dev.creditop.com';

    test('lo deduce de la URL', () => {
        expect(stageOfUrl('https://auth.merchant.creditop.com/login?client_id=x', app)).toBe('usuario');
        expect(stageOfUrl('https://auth.merchant.creditop.com/verifyPassword?client_id=x', app)).toBe('clave');
        expect(stageOfUrl(`https://${app}/auth/callback?code=1`, app)).toBe('callback');
        expect(stageOfUrl(`https://${app}/merchant/6b23a2c1/solicitar`, app)).toBe('app');
    });

    // 🔴 La trampa documentada en `cognitoLogin` (F-66): el host de la app aparece DENTRO del query del
    // login alojado (`redirect_uri=…`). Comparar el host de la URL —no un substring— es lo que impide
    // dar por «dentro de la app» a quien sigue en la página de la clave.
    test('el host de la app dentro del query no cuenta como estar en la app', () => {
        expect(stageOfUrl(AUTHORIZE, app)).toBe('usuario');
    });
});

test.describe('¿es un asesor de prueba?', () => {
    test('reconoce el correo que crea el admin y nada más', () => {
        expect(TEST_ADVISOR_EMAIL.test('c1a955441-fake@creditop.com')).toBe(true);
        expect(TEST_ADVISOR_EMAIL.test('ce433694c-fake@creditop.com')).toBe(true);
        // El comercial de verdad, y un correo que sólo se le parece:
        expect(TEST_ADVISOR_EMAIL.test('oscar+dentix@creditop.com')).toBe(false);
        expect(TEST_ADVISOR_EMAIL.test('comercial-fake@creditop.com')).toBe(false);
        expect(TEST_ADVISOR_EMAIL.test('xc1a955441-fake@creditop.com')).toBe(false);
    });
});

test.describe('el veredicto del recorrido', () => {
    test('si todos entraron, sale 0', () => {
        expect(exitCodeOf([result({}), result({ target: 'qa' })])).toBe(0);
    });

    test('un ambiente que no entró manda sobre uno que no se pudo probar', () => {
        expect(exitCodeOf([result({ veredicto: 'no entró' }), result({ veredicto: 'no se pudo probar' })])).toBe(1);
    });

    // 🔴 Lo que no se probó NO es verde: un front caído o una clave que falta no pueden leerse como «sano».
    test('lo que no se pudo probar o quedó sin clave no sale 0', () => {
        expect(exitCodeOf([result({}), result({ veredicto: 'no se pudo probar' })])).toBe(2);
        expect(exitCodeOf([result({ veredicto: 'sin clave' })])).toBe(2);
    });
});

test.describe('la tabla', () => {
    test('lleva el login y el motivo de cada ambiente, sin la clave', () => {
        const table = renderLoginTable([
            result({ target: 'dev', hosted: { host: 'login.creditop.com', clientId: '14lo4ra4khrdaomd78f0sqh2l4', redirectHost: 'localhost:5174' } }),
            result({ target: 'qa', veredicto: 'no entró', detalle: 'se quedó en el paso «clave»: Incorrect username or password.' }),
        ]);
        expect(table).toMatch(/dev\s+✅entró\s+login\.creditop\.com · 14lo4ra4…/);
        expect(table).toMatch(/qa\s+✖ no entró\s+—\s+se quedó en el paso «clave»/);
    });
});

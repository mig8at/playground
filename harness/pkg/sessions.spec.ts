// Qué se fija acá: las piezas PURAS del módulo de sesiones y del lector de credenciales de `connectors/`.
// No abren navegador ni tocan la red; entrar de verdad se prueba corriéndolo (`make harness-signin`).
//
// Se prueba, sobre todo, lo que el 2026-10-02 falló en la primera corrida real: una credencial de un archivo
// viejo se usó SOLA para entrar a dev, y era la de otra persona.
import { expect, test } from '@playwright/test';
import { credentialsFor, legacyCredentialHint, parseEnvText, resolveKey, type EnvSources } from './connector-env.ts';
import { cookieHeaderFor, sessionFile, type StoredCookie } from './sessions.ts';

const src = (over: Partial<EnvSources> = {}): EnvSources => ({ proc: {}, target: {}, shared: {}, ...over });

test.describe('el .env de connectors', () => {
      test('lee KEY=VALUE, ignora comentarios y acepta export y comillas', () => {
            const text = '# nota\n\nexport A=1\nB="dos"\nC = tres \nD=a=b\nsin igual\n';
            expect(parseEnvText(text)).toEqual({ A: '1', B: 'dos', C: 'tres', D: 'a=b' });
      });

      // La misma regla que connectors/env/env.go: el proceso gana; después el del ambiente; al final el compartido.
      test('la prioridad es proceso > ambiente > compartido', () => {
            const all = src({ proc: { K: 'p' }, target: { K: 't' }, shared: { K: 's' } });
            expect(resolveKey(['K'], all)).toEqual({ value: 'p', from: 'proceso' });
            expect(resolveKey(['K'], src({ target: { K: 't' }, shared: { K: 's' } }))).toEqual({ value: 't', from: 'ambiente' });
            expect(resolveKey(['K'], src({ shared: { K: 's' } }))).toEqual({ value: 's', from: 'compartido' });
            expect(resolveKey(['K'], src())).toBeNull();
      });

      // 🔴 Igual que en Go: una variable VACÍA en el proceso no tapa la del archivo.
      test('un valor vacío en el proceso no tapa el del archivo', () => {
            expect(resolveKey(['K'], src({ proc: { K: '  ' }, target: { K: 't' } }))?.value).toBe('t');
      });
});

test.describe('las credenciales de login', () => {
      test('salen de connectors con la clave del tipo de login', () => {
            const admin = credentialsFor('admin', 'dev', src({ target: { ADMIN_USER: 'miguel@x', ADMIN_PASS: 'a' } }));
            expect(admin).toMatchObject({ user: 'miguel@x', pass: 'a', legacy: false });
            expect(credentialsFor('advisor', 'dev', src({ target: { ADMIN_USER: 'miguel@x', ADMIN_PASS: 'a' } }))).toBeNull();
      });

      test('hace falta el usuario Y la clave', () => {
            expect(credentialsFor('admin', 'dev', src({ target: { ADMIN_USER: 'miguel@x' } }))).toBeNull();
            expect(credentialsFor('admin', 'dev', src({ target: { ADMIN_PASS: 'a' } }))).toBeNull();
      });

      // 🔴 EL CASO DEL 2026-10-02. En esta máquina `harness/.admin.json` guarda la cuenta de Duncan. Con fuentes vacías,
      // `credentialsFor` NO puede devolver nada: lo viejo se avisa, no se usa. Si este test falla, un `signin` vuelve a
      // poder entrar a un ambiente compartido con una identidad que nadie eligió.
      test('las variables viejas sólo producen un aviso sin contraseña, nunca una credencial de login', () => {
            const sources = src({ proc: { E2E_COGNITO_USER: 'old@example.test', E2E_COGNITO_PASS: 'old-secret' } });
            expect(legacyCredentialHint('advisor', 'qa', sources)).toEqual({ user: 'old@example.test', source: 'variables E2E_COGNITO_*' });
            expect(credentialsFor('advisor', 'qa', sources)).toBeNull();
      });

      test('una credencial de un archivo viejo NO se devuelve para entrar', () => {
            expect(credentialsFor('admin', 'dev', src())).toBeNull();
            expect(credentialsFor('advisor', 'qa', src())).toBeNull();
      });
});

test.describe('dónde queda cada sesión', () => {
      test('el admin va por ambiente; el asesor lleva además el host del wizard', () => {
            expect(sessionFile('admin', 'dev', 'https://admin.dev.creditop.com')).toBe('admin-dev.json');
            expect(sessionFile('advisor', 'dev', 'http://localhost:5174')).toMatch(/^advisor-dev-localhost_5174-[a-f0-9]+\.json$/);
            expect(sessionFile('advisor', 'dev', 'https://originaciones.dev.creditop.com')).toMatch(/^advisor-dev-originaciones.dev.creditop.com-[a-f0-9]+\.json$/);
      });
});

test.describe('qué cookies viajan a qué URL', () => {
      const c = (over: Partial<StoredCookie>): StoredCookie => ({ name: 'n', value: 'v', domain: 'admin.dev.creditop.com', path: '/', expires: -1, httpOnly: true, secure: true, ...over });
      const NOW = 1_800_000_000;

      test('lleva las del dominio y sus subdominios, y deja las ajenas', () => {
            const cookies = [c({ name: 'a' }), c({ name: 'b', domain: '.creditop.com' }), c({ name: 'x', domain: 'otro.com' })];
            expect(cookieHeaderFor(cookies, 'https://admin.dev.creditop.com/aliados', NOW)).toBe('a=v; b=v');
      });

      test('una cookie vencida no viaja; una de sesión (expires -1) sí', () => {
            const cookies = [c({ name: 'vieja', expires: NOW - 10 }), c({ name: 'viva', expires: NOW + 600 }), c({ name: 'sesion', expires: -1 })];
            expect(cookieHeaderFor(cookies, 'https://admin.dev.creditop.com/', NOW)).toBe('viva=v; sesion=v');
      });

      test('una cookie secure no viaja por http, salvo a localhost', () => {
            const sec = c({ name: 's', domain: 'localhost', secure: true });
            expect(cookieHeaderFor([sec], 'http://localhost:5174/merchant', NOW)).toBe('s=v');
            expect(cookieHeaderFor([c({ name: 's' })], 'http://admin.dev.creditop.com/', NOW)).toBe('');
      });
});

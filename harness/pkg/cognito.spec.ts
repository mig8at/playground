// Qué se fija acá: que se pueda saber si la sesión de asesor sirve SIN salir a preguntarle a nadie.
// Es lógica pura sobre las cookies del storageState — no lee `.auth/`, no depende del target y no
// depende del reloj de quien corre (el instante se pasa por parámetro).
//
// Se prueba porque el costo de no tenerlo está medido: el 2026-09-17 el canal de asesor arrancó con un
// archivo de dos horas antes, cargó las cookies y salió a caminar; recién en la primera pantalla —40 s
// el primer caso, 54 s el segundo— el front lo mandó al login. La causa estaba EN EL ARCHIVO: `_at`
// había vencido hacía 170 minutos.
import { expect, test } from '@playwright/test';
import { cookiesHealth } from './cognito.ts';

const NOW = 1_800_000_000;                       // un instante fijo, en segundos
const inMin = (m: number) => NOW + m * 60;
const health = (cookies: Array<{ name: string; expires?: number }>) => cookiesHealth(cookies, '.auth/prueba.json', NOW);

const ALIVE = [
      { name: '_at', expires: inMin(50) },
      { name: 'cognito', expires: inMin(50) },
      { name: '_rt', expires: inMin(43_000) },
];

test.describe('¿sirve la sesión cacheada?', () => {
      test('con los tokens vivos, sirve y dice cuánto le queda', () => {
            const s = health(ALIVE);
            expect(s.sirve).toBe(true);
            expect(s.minutos).toBe(50);
            expect(s.motivo).toMatch(/válida por 50 min/);
      });

      // 🔴 El caso real del 2026-09-17. El mensaje tiene que NOMBRAR la cookie: es la diferencia entre
      // «entrá una vez por el panel» y saber por qué.
      test('con el token de acceso vencido, no sirve y nombra la cookie', () => {
            const s = health([{ name: '_at', expires: inMin(-170) }, { name: 'cognito', expires: inMin(-170) }, { name: '_rt', expires: inMin(43_000) }]);
            expect(s.sirve).toBe(false);
            expect(s.motivo).toMatch(/venció hace 170 min/);
            expect(s.motivo).toMatch(/_at/);
      });

      // 🔴 `renovable` mira la COOKIE del refresh, y eso no es lo mismo que que el token sirva. Medido
      // el 2026-09-17 contra qa: con `_rt` sin vencer por un mes, el wizard intentó renovar, falló, y
      // contestó borrando las tres cookies. El mensaje no puede prometer lo que no sabe.
      test('mira la cookie del refresh, sin prometer que vaya a funcionar', () => {
            const withRefresh = health([{ name: '_at', expires: inMin(-10) }, { name: '_rt', expires: inMin(1_000) }]);
            expect(withRefresh.renovable).toBe(true);
            expect(withRefresh.motivo).toMatch(/NO garantiza que sirva/);
            expect(withRefresh.motivo).toMatch(/volver a entrar igual/);

            const withoutRefresh = health([{ name: '_at', expires: inMin(-10) }, { name: '_rt', expires: inMin(-10) }]);
            expect(withoutRefresh.renovable).toBe(false);
            expect(withoutRefresh.motivo).not.toMatch(/NO garantiza/);
      });

      // 🔴 Basta con que UNA de las dos haya vencido: la corrida termina en /login igual.
      test('alcanza con que venza una de las dos', () => {
            expect(health([{ name: '_at', expires: inMin(50) }, { name: 'cognito', expires: inMin(-1) }, ...ALIVE.slice(2)]).sirve).toBe(false);
            expect(health([{ name: '_at', expires: inMin(-1) }, { name: 'cognito', expires: inMin(50) }, ...ALIVE.slice(2)]).sirve).toBe(false);
      });

      // 🔴 Mira el VENCIMIENTO, no la antigüedad del archivo: el saneo de `cognitoStorageState` reescribe
      // el archivo sin renovar nada, así que un mtime fresco no prueba que la sesión viva.
      test('una cookie sin expiración no cuenta como vencida', () => {
            const s = health([{ name: '_at' }, { name: 'cognito', expires: -1 }]);
            expect(s.sirve).toBe(true);
            expect(s.minutos).toBeNull();
            expect(s.motivo).toBe('sesión válida');
      });

      test('el minuto que queda es el de la que vence PRIMERO', () => {
            expect(health([{ name: '_at', expires: inMin(90) }, { name: 'cognito', expires: inMin(12) }]).minutos).toBe(12);
      });

      // 🔴 Un archivo con cookies pero sin las de sesión no es «válido»: es incompleto, y decirlo así
      // evita mandar a renovar una sesión que en realidad nunca se guardó bien.
      test('un archivo sin cookies de sesión se reporta como incompleto, no como válido', () => {
            const s = health([{ name: 'lang', expires: inMin(9_000) }, { name: 'XSRF-TOKEN', expires: inMin(9_000) }]);
            expect(s.sirve).toBe(false);
            expect(s.motivo).toMatch(/no trae ninguna cookie de sesión/);
      });

      test('sin ninguna cookie, tampoco sirve', () => {
            expect(health([]).sirve).toBe(false);
      });
});

// Qué se fija acá: que se pueda saber si la sesión de asesor sirve SIN salir a preguntarle a nadie.
// Es lógica pura sobre las cookies del storageState — no lee `.auth/`, no depende del target y no
// depende del reloj de quien corre (el instante se pasa por parámetro).
//
// Se prueba porque el costo de no tenerlo está medido: el 2026-09-17 el canal de asesor arrancó con un
// archivo de dos horas antes, cargó las cookies y salió a caminar; recién en la primera pantalla —40 s
// el primer caso, 54 s el segundo— el front lo mandó al login. La causa estaba EN EL ARCHIVO: `_at`
// había vencido hacía 170 minutos.
import { expect, test } from '@playwright/test';
import { saludDeCookies } from './cognito.ts';

const AHORA = 1_800_000_000;                       // un instante fijo, en segundos
const enMin = (m: number) => AHORA + m * 60;
const salud = (cookies: Array<{ name: string; expires?: number }>) => saludDeCookies(cookies, '.auth/prueba.json', AHORA);

const VIVA = [
      { name: '_at', expires: enMin(50) },
      { name: 'cognito', expires: enMin(50) },
      { name: '_rt', expires: enMin(43_000) },
];

test.describe('¿sirve la sesión cacheada?', () => {
      test('con los tokens vivos, sirve y dice cuánto le queda', () => {
            const s = salud(VIVA);
            expect(s.sirve).toBe(true);
            expect(s.minutos).toBe(50);
            expect(s.motivo).toMatch(/válida por 50 min/);
      });

      // 🔴 El caso real del 2026-09-17. El mensaje tiene que NOMBRAR la cookie: es la diferencia entre
      // «entrá una vez por el panel» y saber por qué.
      test('con el token de acceso vencido, no sirve y nombra la cookie', () => {
            const s = salud([{ name: '_at', expires: enMin(-170) }, { name: 'cognito', expires: enMin(-170) }, { name: '_rt', expires: enMin(43_000) }]);
            expect(s.sirve).toBe(false);
            expect(s.motivo).toMatch(/venció hace 170 min/);
            expect(s.motivo).toMatch(/_at/);
      });

      // 🔴 `renovable` mira la COOKIE del refresh, y eso no es lo mismo que que el token sirva. Medido
      // el 2026-09-17 contra qa: con `_rt` sin vencer por un mes, el wizard intentó renovar, falló, y
      // contestó borrando las tres cookies. El mensaje no puede prometer lo que no sabe.
      test('mira la cookie del refresh, sin prometer que vaya a funcionar', () => {
            const conRefresh = salud([{ name: '_at', expires: enMin(-10) }, { name: '_rt', expires: enMin(1_000) }]);
            expect(conRefresh.renovable).toBe(true);
            expect(conRefresh.motivo).toMatch(/NO garantiza que sirva/);
            expect(conRefresh.motivo).toMatch(/volver a entrar igual/);

            const sinRefresh = salud([{ name: '_at', expires: enMin(-10) }, { name: '_rt', expires: enMin(-10) }]);
            expect(sinRefresh.renovable).toBe(false);
            expect(sinRefresh.motivo).not.toMatch(/NO garantiza/);
      });

      // 🔴 Basta con que UNA de las dos haya vencido: la corrida termina en /login igual.
      test('alcanza con que venza una de las dos', () => {
            expect(salud([{ name: '_at', expires: enMin(50) }, { name: 'cognito', expires: enMin(-1) }, ...VIVA.slice(2)]).sirve).toBe(false);
            expect(salud([{ name: '_at', expires: enMin(-1) }, { name: 'cognito', expires: enMin(50) }, ...VIVA.slice(2)]).sirve).toBe(false);
      });

      // 🔴 Mira el VENCIMIENTO, no la antigüedad del archivo: el saneo de `cognitoStorageState` reescribe
      // el archivo sin renovar nada, así que un mtime fresco no prueba que la sesión viva.
      test('una cookie sin expiración no cuenta como vencida', () => {
            const s = salud([{ name: '_at' }, { name: 'cognito', expires: -1 }]);
            expect(s.sirve).toBe(true);
            expect(s.minutos).toBeNull();
            expect(s.motivo).toBe('sesión válida');
      });

      test('el minuto que queda es el de la que vence PRIMERO', () => {
            expect(salud([{ name: '_at', expires: enMin(90) }, { name: 'cognito', expires: enMin(12) }]).minutos).toBe(12);
      });

      // 🔴 Un archivo con cookies pero sin las de sesión no es «válido»: es incompleto, y decirlo así
      // evita mandar a renovar una sesión que en realidad nunca se guardó bien.
      test('un archivo sin cookies de sesión se reporta como incompleto, no como válido', () => {
            const s = salud([{ name: 'lang', expires: enMin(9_000) }, { name: 'XSRF-TOKEN', expires: enMin(9_000) }]);
            expect(s.sirve).toBe(false);
            expect(s.motivo).toMatch(/no trae ninguna cookie de sesión/);
      });

      test('sin ninguna cookie, tampoco sirve', () => {
            expect(salud([]).sirve).toBe(false);
      });
});

// Qué se fija acá: el frasco de cookies de la sesión HTTP del arnés.
//
// No es plomería: es lo que hace que la sesión del asesor se RENUEVE sola. El wizard trae un
// middleware que, cuando el token de acceso vence, lo cambia por uno nuevo usando el de refresco y
// devuelve los dos por `Set-Cookie`. Si el frasco no los recogiera, la sesión duraría lo que dura el
// token de acceso — medido contra qa el 2026-09-17: **4 minutos**.
//
// Y la otra mitad, que es la que faltaba: cuando el refresco FALLA, el servidor contesta borrando las
// cookies. Guardarlas igual dejaba el frasco con valores vacíos y el runner mandando basura para
// siempre, sin poder distinguir «no tengo sesión» de «tengo una vacía».
import { expect, test } from '@playwright/test';
import { FrontSession } from './front.ts';

const session = () => new FrontSession('https://ejemplo.test');

test.describe('el frasco de cookies', () => {
      test('guarda lo que el servidor manda', () => {
            const s = session().aplicarSetCookie([
                  '_at=nuevo123; Path=/; HttpOnly; SameSite=Lax; Max-Age=240',
                  '_rt=refresco456; Path=/; HttpOnly; Max-Age=2592000',
            ]);

            expect(s.frascoDeCookies()).toEqual({ _at: 'nuevo123', _rt: 'refresco456' });
      });

      // 🔴 El caso que hace que la sesión sobreviva: llega un token renovado y pisa al viejo.
      test('un token renovado reemplaza al anterior', () => {
            const s = session()
                  .conCookiesDe({ cookies: [{ name: '_at', value: 'viejo' }, { name: '_rt', value: 'refresco' }] })
                  .aplicarSetCookie(['_at=renovado; Path=/; Max-Age=240']);

            expect(s.frascoDeCookies()._at).toBe('renovado');
            expect(s.frascoDeCookies()._rt).toBe('refresco');
      });

      // 🔴 Las tres formas de decir «borrala». Medido contra qa: cuando el refresco falla, el 302 al
      // login viene con las tres cookies de sesión expiradas en la misma respuesta.
      test('`Max-Age=0` borra la cookie en vez de guardarla vacía', () => {
            const s = session()
                  .conCookiesDe({ cookies: [{ name: '_at', value: 'algo' }] })
                  .aplicarSetCookie(['_at=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);

            expect(s.frascoDeCookies()).not.toHaveProperty('_at');
      });

      test('una fecha pasada también borra', () => {
            const s = session()
                  .conCookiesDe({ cookies: [{ name: '_session', value: 'algo' }] })
                  .aplicarSetCookie(['_session=; Domain=.ejemplo.test; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);

            expect(s.frascoDeCookies()).not.toHaveProperty('_session');
      });

      test('un valor vacío también borra', () => {
            const s = session()
                  .conCookiesDe({ cookies: [{ name: '_rt', value: 'algo' }] })
                  .aplicarSetCookie(['_rt=; Path=/']);

            expect(s.frascoDeCookies()).not.toHaveProperty('_rt');
      });

      // 🔴 Y una fecha FUTURA no borra: si el chequeo no mirara el valor de `Expires` sino su mera
      // presencia, cada cookie normal se borraría sola y la sesión no duraría una petición.
      test('una fecha futura NO borra', () => {
            const withinAYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
            const s = session().aplicarSetCookie([`_at=vigente; Path=/; Expires=${withinAYear}`]);

            expect(s.frascoDeCookies()._at).toBe('vigente');
      });

      test('el borrado de una no se lleva a las demás', () => {
            const s = session()
                  .conCookiesDe({ cookies: [{ name: '_at', value: 'a' }, { name: 'lang', value: 'es' }] })
                  .aplicarSetCookie(['_at=; Max-Age=0']);

            expect(s.frascoDeCookies()).toEqual({ lang: 'es' });
      });
});

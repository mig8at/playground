// Qué se fija acá: que el cliente de los runners distinga «tardó» de «se cayó», y que deje rastro de
// lo que pidió. Levanta un servidor propio en un puerto efímero — no toca ningún ambiente.
//
// Se prueba porque las dos cosas son invisibles cuando fallan. Un timeout reportado como «HTTP 0» se
// lee como que el backend se murió y manda a mirar si está vivo, cuando lo que hay que mirar es la
// concurrencia (medido el 2026-08-23: 90.002 ms, o sea el límite clavado). Y una bitácora que no anota
// la llamada que falló obliga a repetir una corrida de 90 s para ver qué se pidió.
import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createCustomer } from './http.ts';

/** Un servidor de juguete en un puerto que elige el sistema: dos specs en paralelo no se pisan. */
async function server(handler: (url: string, res: any) => void): Promise<{ base: string; cerrar: () => Promise<void> }> {
      const s: Server = createServer((req, res) => handler(req.url ?? '', res));
      await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
      const port = (s.address() as any).port;
      return {
            base: `http://127.0.0.1:${port}`,
            cerrar: () => new Promise<void>((ok) => { s.closeAllConnections?.(); s.close(() => ok()); }),
      };
}

test.describe('el cliente HTTP de los runners', () => {
      test('una respuesta con JSON vuelve parseada y sin `error`', async () => {
            const srv = await server((_u, res) => {
                  res.writeHead(200, { 'content-type': 'application/json' });
                  res.end(JSON.stringify({ data: { id: 7 } }));
            });
            const c = createCustomer({ base: srv.base });

            const r = await c.get('/lo-que-sea');
            expect(r.status).toBe(200);
            expect(r.json.data.id).toBe(7);
            // 🔴 `error` sólo aparece cuando algo salió mal: si apareciera siempre, un `if (r.error)`
            // dejaría de significar nada y los runners que lo leen reportarían fallas inventadas.
            expect(r.error).toBeUndefined();

            await srv.cerrar();
      });

      test('un cuerpo que no es JSON vuelve en las DOS formas que los runners leían', async () => {
            const srv = await server((_u, res) => { res.writeHead(500); res.end('<html>Gateway</html>'); });
            const c = createCustomer({ base: srv.base });

            const r = await c.get('/roto');
            expect(r.status).toBe(500);
            expect(r.json.raw).toContain('Gateway');   // lo que leían listado/sweep/qr
            expect(r.error).toContain('Gateway');      // lo que leía ecommerce

            await srv.cerrar();
      });

      // 🔴 LA razón de ser de este módulo. Las cinco copias devolvían `HTTP 0` para las dos cosas.
      test('un timeout dice que TARDÓ, y no que se cayó', async () => {
            const srv = await server(() => { /* nunca contesta */ });
            const c = createCustomer({ base: srv.base, timeoutMs: 150 });

            const r = await c.get('/lento');
            expect(r.status).toBe(0);
            expect(r.expiro).toBe(true);
            expect(r.error).toMatch(/no falló: tardó/);

            await srv.cerrar();
      });

      test('una caída de verdad NO se marca como timeout', async () => {
            const srv = await server((_u, res) => res.end('ok'));
            const base = srv.base;
            await srv.cerrar();                        // el puerto queda sin nadie escuchando
            const c = createCustomer({ base, timeoutMs: 5_000 });

            const r = await c.get('/nadie');
            expect(r.status).toBe(0);
            expect(r.expiro).toBe(false);
            expect(r.error).not.toMatch(/tardó/);
      });

      test('el timeout se puede dar por verbo, porque un POST no espera lo mismo que un GET', async () => {
            const srv = await server((_u, res) => { /* nunca contesta */ });
            const c = createCustomer({ base: srv.base, timeoutMs: { get: 120, post: 400 } });

            const t0 = Date.now();
            await c.get('/lento');
            const slowGet = Date.now() - t0;

            const t1 = Date.now();
            await c.post('/lento', {});
            const slowPost = Date.now() - t1;

            expect(slowGet).toBeLessThan(slowPost);
            await srv.cerrar();
      });

      test('las cabeceras del cliente se mandan, y las de la llamada se suman', async () => {
            const vistas: Record<string, string>[] = [];
            const s: Server = createServer((req, res) => {
                  vistas.push(req.headers as any);
                  res.writeHead(200, { 'content-type': 'application/json' });
                  res.end('{}');
            });
            await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
            const c = createCustomer({ base: `http://127.0.0.1:${(s.address() as any).port}`, headers: { 'user-agent': 'arnes/1' } });

            await c.get('/a');
            await c.get('/b', { 'x-fake-scenario': 'apellido-no-coincide' });

            expect(vistas[0]['user-agent']).toBe('arnes/1');
            expect(vistas[1]['user-agent']).toBe('arnes/1');
            expect(vistas[1]['x-fake-scenario']).toBe('apellido-no-coincide');

            await new Promise<void>((ok) => { s.closeAllConnections?.(); s.close(() => ok()); });
      });

      // 🔴 El cuerpo entero sólo cuando falló: es cuando hace falta, y evita volcar datos personales de
      // las respuestas buenas a un archivo de la corrida.
      test('la bitácora anota todo, y el cuerpo sólo de lo que falló', async () => {
            const srv = await server((u, res) => {
                  if (u === '/bien') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"secreto":"no volcar"}'); }
                  else { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"message":"el celular debe tener 9 digitos"}'); }
            });
            const c = createCustomer({ base: srv.base });

            await c.get('/bien');
            await c.post('/mal', { x: 1 });

            const b = c.bitacora();
            expect(b).toHaveLength(2);
            expect(b[0]).toMatchObject({ metodo: 'GET', ruta: '/bien', status: 200 });
            expect(b[0].cuerpo).toBeUndefined();
            expect(b[1]).toMatchObject({ metodo: 'POST', ruta: '/mal', status: 422 });
            expect(b[1].cuerpo).toContain('9 digitos');
            expect(c.lineas().join('\n')).toContain('/mal');

            await srv.cerrar();
      });

      test('la barra final de la base no duplica la de la ruta', async () => {
            const vistas: string[] = [];
            const s: Server = createServer((req, res) => { vistas.push(req.url ?? ''); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
            await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
            const c = createCustomer({ base: `http://127.0.0.1:${(s.address() as any).port}/` });

            await c.get('/api/x');
            expect(vistas[0]).toBe('/api/x');

            await new Promise<void>((ok) => { s.closeAllConnections?.(); s.close(() => ok()); });
      });
});

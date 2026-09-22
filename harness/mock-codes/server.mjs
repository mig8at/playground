// Mock del SERVICIO DE CÓDIGOS — el servicio externo que emite, consulta y consume el código que el
// cliente ve en la app y presenta en el comercio.
//
// POR QUÉ EXISTE (2026-09-22):
//   El camino del «código de cliente» no se podía correr en local: `CODE_GENERATION_SERVICE_BASE_URL`
//   no está configurado, así que la consulta muere antes de empezar con «base URL is not configured».
//   Sin esto no hay forma de ejercitar `POST /api/onboarding/client-code/redeem` ni de ver la
//   solicitud quedando creada con la entidad del preaprobado.
//
// CONTRATO — leído de `legacy-backend/Modules/Onboarding/App/Repositories/GenerateServiceRepository.php`
// (origin/qa), no inventado:
//   · Las rutas son `/api/v1/generate/code`, `/code/consult` y `/code/consumConfirm`, todas POST.
//   · `postJson()` EXIGE `Content-Type: application/json` y que el cuerpo sea un arreglo; cualquier
//     otra cosa es `GenerateServiceException` 502. Por eso acá el header se escribe siempre.
//   · `generateCode()` en cambio exige `text/plain` y devuelve el cuerpo crudo.
//   · Cualquier respuesta >= 400 se traduce a error upstream con su estado, así que los códigos de
//     estado de abajo son lo que el backend va a propagar al front.
//   · El proxy (`GenerateServiceProxyService::buildConsultPlainCodeResponse`) lee `data.user_id` y
//     además comprueba contra la BD que ese usuario EXISTA y tenga celular y correo. O sea: el
//     user_id que se siembre acá tiene que ser un usuario real de la base local, o la consulta
//     responde 404/422 aunque el mock diga que todo bien.
//   · `ClientCodeRedemptionService` lee además `data.lender_id`: sin él rechaza con 422.
//
// LO QUE **NO** MOCKEA:
//   · La emisión real. Hoy nadie la llama para este flujo: la app arma el código que muestra en el
//     propio teléfono. `/code` está sólo para que el contrato quede completo.
//   · El QR y el código de barras (`/qr`, `/barcode`), que devuelven PNG y no los usa este camino.
//
// APUNTÁ EL BACKEND (legacy-backend/.env) — corre en Docker, así que NO es `localhost`:
//   CODE_GENERATION_SERVICE_BASE_URL=http://host.docker.internal:8111
//
// USO:  node mock-codes/server.mjs
//   env: MOCK_CODES_PORT (8111)
// CONTROL en caliente (sin reiniciar):
//   GET  /                     → estado + códigos en memoria
//   POST /_control/sembrar     {code, user_id, lender_id, merchant_id}  → registra un código sin usar
//   POST /_control/reset       → limpia el registro

import http from 'node:http';

const PORT = Number(process.env.MOCK_CODES_PORT || 8111);

/** code → { code, user_id, lender_id, merchant_id, used, used_at } */
const codes = new Map();

const json = (res, status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
};

const readBody = (req) =>
      new Promise((resolve) => {
            let raw = '';
            req.on('data', (chunk) => {
                  raw += chunk;
            });
            req.on('end', () => {
                  try {
                        resolve(raw ? JSON.parse(raw) : {});
                  } catch {
                        resolve({});
                  }
            });
      });

// La clave incluye el comercio porque el servicio real recibe merchant_id en las dos llamadas: el
// mismo código en otro comercio no es el mismo código.
const key = (merchantId, code) => `${merchantId}:${code}`;

const server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
      const body = req.method === 'POST' ? await readBody(req) : {};

      if (req.method === 'GET' && pathname === '/') {
            return json(res, 200, {
                  mock: 'code-generation-service',
                  port: PORT,
                  codes: [...codes.values()],
            });
      }

      if (req.method === 'POST' && pathname === '/_control/reset') {
            codes.clear();
            return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/_control/sembrar') {
            const entry = {
                  code: String(body.code ?? ''),
                  user_id: Number(body.user_id ?? 0),
                  lender_id: body.lender_id == null ? null : Number(body.lender_id),
                  merchant_id: Number(body.merchant_id ?? 0),
                  used: false,
                  used_at: null,
            };

            if (!entry.code || !entry.merchant_id) {
                  return json(res, 422, { success: false, message: 'Faltan code o merchant_id.' });
            }

            codes.set(key(entry.merchant_id, entry.code), entry);
            return json(res, 200, { ok: true, seeded: entry });
      }

      if (req.method === 'POST' && pathname === '/api/v1/generate/code/consult') {
            const entry = codes.get(key(Number(body.merchant_id), String(body.code)));

            if (!entry) {
                  return json(res, 404, { success: false, message: 'El código no existe para ese comercio.' });
            }

            if (entry.used) {
                  return json(res, 409, { success: false, message: 'El código ya fue usado.' });
            }

            return json(res, 200, {
                  success: true,
                  message: 'ok',
                  data: {
                        user_id: entry.user_id,
                        lender_id: entry.lender_id,
                        merchant_id: entry.merchant_id,
                        code: entry.code,
                        status: 'unused',
                  },
            });
      }

      if (req.method === 'POST' && pathname === '/api/v1/generate/code/consumConfirm') {
            const entry = codes.get(key(Number(body.merchant_id), String(body.code)));

            if (!entry) {
                  return json(res, 404, { success: false, message: 'El código no existe para ese comercio.' });
            }

            if (entry.used) {
                  return json(res, 409, { success: false, message: 'El código ya fue usado.' });
            }

            entry.used = true;
            entry.used_at = new Date().toISOString();

            return json(res, 200, {
                  success: true,
                  message: 'ok',
                  data: { code: entry.code, status: 'used', used_at: entry.used_at },
            });
      }

      // El emisor real devuelve texto plano, no JSON: `generateCode()` lo exige.
      if (req.method === 'POST' && pathname === '/api/v1/generate/code') {
            const code = String(Math.floor(1000 + Math.random() * 9000));
            const merchantId = Number(body.merchant_id ?? 0);

            if (merchantId) {
                  codes.set(key(merchantId, code), {
                        code,
                        user_id: Number(body.user_id ?? 0),
                        lender_id: body.lender_id == null ? null : Number(body.lender_id),
                        merchant_id: merchantId,
                        used: false,
                        used_at: null,
                  });
            }

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end(code);
      }

      return json(res, 404, { success: false, message: 'Ruta no mockeada.' });
});

server.listen(PORT, () => {
      console.log(`mock-codes escuchando en http://127.0.0.1:${PORT}`);
      console.log(`  sembrar: curl -s -XPOST localhost:${PORT}/_control/sembrar -d '{"code":"1234","user_id":1,"lender_id":24,"merchant_id":26}' -H 'Content-Type: application/json'`);
});

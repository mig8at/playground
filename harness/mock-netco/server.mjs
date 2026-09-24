// Mock LOCAL de NETCO — el proveedor de FIRMA ELECTRÓNICA de Credifamilia (rt=4).
//
// POR QUÉ EXISTE. Es el sexto muro de la fila que separa a Credifamilia del estado 11: con Deceval ya
// contestando, la autorización muere en `NETCO_PASSWORD_DERIVATION_SECRET is missing` y la solicitud
// queda en estado 28. Netco es un PKI real: emite un certificado por persona y firma el PDF con él.
//
// ⚠ QUÉ PRUEBA ESTO Y QUÉ NO. Prueba que nuestro cliente hable el protocolo —login con cookie de
// sesión, alta de usuario, firma, logout— y que el flujo siga. NO prueba NADA criptográfico: el
// «PDF firmado» que devuelve es el mismo que entró. Un verde acá no dice que el documento tenga
// validez legal, dice que la orquestación corre.
//
// LOS SEIS ENDPOINTS que usa `NetcoSignerClient.php`, todos POST bajo el prefijo de `NETCO_BASE_URL`
// (que ya incluye `/credifamilia/rest`):
//   /LoginService/checkBasicAuthentication  → 200 + Set-Cookie  ⚠ la cookie NO puede faltar
//   /LoginService/logoutUser                → 200
//   /UserService/userExists                 → {exists:true}
//   /UserService/basicRegistration          → 200
//   /UserService/createUserAndUserCertNetcoPKI → 200
//   /SignService/signFiles                  → {success, filesInfo:{uid}, base64SignedFile}
//
// LA TRAMPA DE LA COOKIE. `extractCookie()` lee `Set-Cookie` y si sale vacío tira
// `NetcoAuthException('Netco login returned no session cookie')` — un 200 con cuerpo perfecto y sin ese
// header falla igual, y el mensaje habla de sesión, no de mock. Por eso se manda siempre.
//
// DEVOLVEMOS `exists:true` a propósito: con el usuario ya existente el proveedor se salta el alta y el
// camino queda más corto. Los endpoints de creación igual responden, porque el proveedor puede tomar la
// otra rama según el estado del certificado y un 404 ahí sería un muro nuevo.
//
// Uso:  node mock-netco/server.mjs      env: MOCK_NETCO_PORT (8107)
//       MOCK_NETCO_FAIL=1 → signFiles devuelve success=false, para probar el camino de rechazo

import http from 'node:http';

const PORT = Number(process.env.MOCK_NETCO_PORT || 8107);
const FAIL = process.env.MOCK_NETCO_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

let signatures = 0;

http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        const path = req.url.split('?')[0];
        const json = (code, obj, headers = {}) => {
            res.writeHead(code, { 'content-type': 'application/json', ...headers });
            res.end(JSON.stringify(obj));
        };

        if (req.method === 'GET') return json(200, { mock: 'netco', puerto: PORT, fail: FAIL, firmas: signatures });

        if (path.endsWith('/LoginService/checkBasicAuthentication')) {
            log('login → sesión MOCK-SESSION');
            // La cookie es obligatoria: sin ella el cliente tira NetcoAuthException aunque el 200 esté bien.
            return json(200, { success: true }, { 'set-cookie': 'JSESSIONID=MOCK-SESSION; Path=/; HttpOnly' });
        }
        if (path.endsWith('/LoginService/logoutUser')) return json(200, { success: true });
        if (path.endsWith('/UserService/userExists')) return json(200, { exists: true });
        if (path.endsWith('/UserService/basicRegistration')) return json(200, { success: true });
        if (path.endsWith('/UserService/createUserAndUserCertNetcoPKI')) return json(200, { success: true });

        if (path.endsWith('/SignService/signFiles')) {
            let entry = {};
            try { entry = JSON.parse(body || '{}'); } catch { /* el cuerpo se loguea abajo */ }
            const name = entry.fileName || '(sin nombre)';
            if (FAIL) {
                log(`signFiles ${name} → success=false`);
                return json(200, { success: false, detail: 'Firma rechazada por el mock' });
            }
            signatures += 1;
            log(`signFiles ${name} → firmado (#${signatures})`);
            // El «firmado» es el MISMO PDF que entró: alcanza para que el flujo siga y deja claro en el
            // artefacto que acá no hubo criptografía.
            return json(200, {
                success: true,
                filesInfo: { uid: `MOCK-NETCO-UID-${signatures}` },
                base64SignedFile: entry.base64File || '',
            });
        }

        // Ruidoso a propósito: un 404 mudo se lee como un fallo del proveedor, no como un endpoint que
        // el mock todavía no cubre.
        log(`⚠ endpoint NO cubierto: ${req.method} ${path}`);
        json(404, { error: 'mock-netco: endpoint no cubierto', ruta: path });
    });
}).listen(PORT, () => log(`mock-netco escuchando en :${PORT}${FAIL ? ' (FAIL)' : ''}`));

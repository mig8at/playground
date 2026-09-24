// Mock LOCAL del SOAP de CONSUMER de CREDIFAMILIA — la RADICACIÓN, o sea el último paso del crédito.
//
// POR QUÉ EXISTE. Es el séptimo y último externo de la fila de Credifamilia (rt=4). Sin él, el backend
// local sale a `https://pruebas.credifamilia.com.mx/...` —el sandbox REAL del lender— que desde acá
// devuelve **504** y deja la transacción en `CREDIT_ERROR`. Lo peligroso es cómo se ve: la solicitud ya
// está en estado 11 y el endpoint de autorización responde **HTTP 200**, así que el runner reporta
// «CERRÓ» y el fallo de radicación queda invisible salvo que uno vaya a mirar `lender_transactions`.
//
// ⚠ Y ANTES DE ESTE MOCK, LOCAL PEGABA CONTRA UN SERVICE EXTERNO REAL. No es sólo lentitud: son
// solicitudes sintéticas viajando al ambiente de pruebas del lender. Apuntar esto al mock corta eso.
//
// LAS DOS OPERACIONES, y qué las hace exitosas (`CredifamiliaConsumo::mapStatusCode`):
//   transaccionConsumo      registra la operación   → statusCode 200 = CREDIT_REGISTERED
//   guardarDocumentoOpenKm  manda el PDF unificado  → statusCode 200 (o 409) = CREDIT_COMPLETED
// La radicación cuenta como exitosa SÓLO si termina en CREDIT_COMPLETED, o sea si las dos pasan.
//
// NO HAY WSDL QUE SERVIR. El cliente (`app/Actions/Lenders/CredifamiliaConsumo/SoapClient.php`) está
// hecho a mano: arma el sobre él mismo y lo manda por cURL crudo. Así que esto es un POST normal, igual
// que el mock de Deceval — no hace falta publicar un contrato.
//
// CÓMO SE LEE LA RESPUESTA: se busca el `Body` de SOAP 1.1 y de ahí, POR NOMBRE y a cualquier
// profundidad, un `statusCode` y un `message`. Por eso los hijos van sin prefijo.
//
// ⚠ Un `soapenv:Fault` NO es un error de transporte para este cliente: es respuesta válida y la mapea a
// statusCode 500 → CREDIT_ERROR. Por eso el modo de fallo devuelve un Fault y no un 500 pelado.
//
// Uso:  node mock-credifamilia/server.mjs   env: MOCK_CREDIFAMILIA_PORT (8108)
//       MOCK_CREDIFAMILIA_FAIL=1 → Fault de aplicación, para probar el camino de rechazo

import http from 'node:http';

const PORT = Number(process.env.MOCK_CREDIFAMILIA_PORT || 8108);
const FAIL = process.env.MOCK_CREDIFAMILIA_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const NS = 'http://schemas.xmlsoap.org/soap/envelope/';
let filings = 0;

const over = (interior) =>
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS}"><soapenv:Body>${interior}</soapenv:Body></soapenv:Envelope>`;

const fault = (text) =>
    over(`<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>${text}</faultstring></soapenv:Fault>`);

function operationOf(headers, body) {
    const action = String(headers.soapaction || '').replace(/"/g, '');
    if (action.includes('transaccionConsumo') || body.includes('transaccionConsumo')) return 'transaccionConsumo';
    if (action.includes('guardarDocumentoOpenKm') || body.includes('guardarDocumentoOpenKm')) return 'guardarDocumentoOpenKm';
    return null;
}

http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ mock: 'credifamilia-consumo', puerto: PORT, fail: FAIL, radicaciones: filings }));
        }

        const op = operationOf(req.headers, body);
        if (!op) {
            // Ruidoso a propósito: una operación desconocida contestada con un sobre genérico se
            // registraría como radicada, que es la mentira más cara de todas.
            log('⚠ operación DESCONOCIDA — ni transaccionConsumo ni guardarDocumentoOpenKm');
            log('   SOAPAction:', req.headers.soapaction, '· cuerpo:', body.slice(0, 200).replace(/\s+/g, ' '));
            res.writeHead(500, { 'content-type': 'text/xml' });
            return res.end(fault('mock-credifamilia: operación no reconocida'));
        }

        if (FAIL) {
            log(`${op} → Fault (modo fallo)`);
            res.writeHead(500, { 'content-type': 'text/xml' });
            return res.end(fault(`mock-credifamilia: ${op} rechazado`));
        }

        if (op === 'guardarDocumentoOpenKm') filings += 1;
        const detail = op === 'transaccionConsumo'
            ? 'Operacion de consumo registrada por el mock'
            : `Documento almacenado por el mock (#${filings})`;

        log(`${op} → statusCode 200 · ${body.length}b de sobre`);
        res.writeHead(200, { 'content-type': 'text/xml' });
        res.end(over(
            `<return><statusCode>200</statusCode><message>${detail}</message>` +
            `<numeroOperacion>MOCK-CF-${String(filings).padStart(4, '0')}</numeroOperacion></return>`,
        ));
    });
}).listen(PORT, () => log(`mock-credifamilia escuchando en :${PORT}${FAIL ? ' (FAIL)' : ''}`));

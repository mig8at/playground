// Mock LOCAL de DECEVAL — el depósito de valores que registra y firma el PAGARÉ.
//
// POR QUÉ EXISTE. Credifamilia (rt=4) firma con pagaré desmaterializado en Deceval. Sin este mock, la
// generación de documentos muere con `Error al generar pagaré Deceval` y la solicitud NO llega a
// estado 11 — es el quinto muro de una fila donde cada uno tapaba al siguiente.
//
// ⚠ QUÉ PRUEBA ESTO Y QUÉ NO. Prueba **nuestra orquestación**: que el backend arme el SOAP, lea la
// respuesta y siga el flujo. NO prueba la firma — un pagaré desmaterializado vale justamente porque no
// se puede simular. Un verde acá significa «el flujo corre», nunca «el título es válido».
//
// HAY QUE RAMIFICAR POR OPERACIÓN, Y ESO SE MIDIÓ. La primera versión devolvía UN sobre con todos los
// nodos que el parser lee, apostando a que cada operación tomaría los suyos. No funciona: el parser
// entra por el CONTENEDOR, con `getElementsByTagNameNS('http://deceval.com/sdl/services/', …)`, y el
// contenedor tiene un nombre DISTINTO por operación (`DecevalSoap.php:338,489,620,752`). Un sobre con
// los hijos correctos pero el contenedor equivocado no falla al parsear: da cero nodos y el backend
// dice «sin respuesta» — que se lee como si el mock no hubiera contestado. Contestó; el `count()===0`
// no distingue «no llegó» de «llegó con otro nombre».
//
// Y el namespace es obligatorio: la búsqueda es NS-aware, así que el contenedor va con el prefijo
// declarado. Los hijos, en cambio, se leen con `getElementsByTagName` (por nombre calificado) y van
// SIN prefijo.
//
// Y CADA OPERACIÓN JUZGA EL ÉXITO CON OTRA VARA — son tres criterios distintos, no uno:
//   girador y pagaré → `exitoso === 'true'`
//   consultar        → `exitoso`, y además lee `estadoPagare`
//   firmar           → NO mira `exitoso`: pide `descripcion` empezando con `SDL.SE.0000`
//
// LAS CUATRO PAREJAS (petición → contenedor de respuesta):
//   CreacionGiradoresCodificados → RespuestaCrearGiradorDaneServiceDTO
//   CreacionPagaresCodificado    → RespuestaDocumentoPagareDaneServiceDTO
//   consultarPagares             → RespuestaConsultarPagaresDTO
//   firmarPagares                → RespuestaFirmarPagaresDTO
//
// Uso:  node mock-deceval/server.mjs      env: MOCK_DECEVAL_PORT (8106)
//       MOCK_DECEVAL_FAIL=1 → `exitoso=false`, para probar el camino de rechazo

import http from 'node:http';

const PORT = Number(process.env.MOCK_DECEVAL_PORT || 8106);
const FAIL = process.env.MOCK_DECEVAL_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const NS = 'http://deceval.com/sdl/services/';
const exitoso = FAIL ? 'false' : 'true';

// ⚠ LOS IDENTIFICADORES TIENEN QUE SER ÚNICOS POR LLAMADA. La primera versión devolvía constantes
// (`MOCK-DECEVAL-0001` para todos) y en serie funcionaba; con tres casos EN PARALELO cerraba uno solo y
// los otros dos morían con `There is no active transaction` — un mensaje que no nombra ni al pagaré ni
// al mock, y que se lee como un defecto de concurrencia del backend. Era la colisión de ids.
let secuencia = 0;
const nuevoId = () => `${Date.now().toString(36)}${(secuencia++).toString(36)}`.toUpperCase();

// Un PDF mínimo pero VÁLIDO: el backend lo guarda y después lo abre un visor. Un base64 cualquiera
// pasa el flujo y revienta al mirarlo, que es peor que fallar acá.
const PDF_B64 = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
).toString('base64');

/** El contenido de cada contenedor. Sólo los nodos que el parser de esa operación lee. */
const CUERPOS = {
    RespuestaCrearGiradorDaneServiceDTO: (id) => `
        <exitoso>${exitoso}</exitoso>
        <descripcion>${FAIL ? 'Girador rechazado por el mock' : 'Girador creado'}</descripcion>
        <cuentaGirador>MOCK-GIRADOR-${id}</cuentaGirador>
        <numeroDocumento>0000000000</numeroDocumento>
        <fkIdTipoDocumento>1</fkIdTipoDocumento>`,
    RespuestaDocumentoPagareDaneServiceDTO: (id) => `
        <exitoso>${exitoso}</exitoso>
        <descripcion>${FAIL ? 'Pagaré rechazado por el mock' : 'Pagaré creado'}</descripcion>
        <idDocumentoPagare>MOCK-DOC-${id}</idDocumentoPagare>
        <numPagareEntidad>MOCK-NUM-${id}</numPagareEntidad>
        <idPagareDeceval>MOCK-DECEVAL-${id}</idPagareDeceval>
        <nombreArchivo>pagare-mock.pdf</nombreArchivo>
        <contenido>${PDF_B64}</contenido>`,
    RespuestaConsultarPagaresDTO: (id) => `
        <exitoso>${exitoso}</exitoso>
        <descripcion>Consulta OK</descripcion>
        <estadoPagare>1</estadoPagare>
        <idPagareDeceval>MOCK-DECEVAL-${id}</idPagareDeceval>
        <nombreArchivo>pagare-mock.pdf</nombreArchivo>
        <contenido>${PDF_B64}</contenido>`,
    // ⚠ Esta operación NO mira `exitoso`: exige que `descripcion` empiece con el código de Deceval
    // `SDL.SE.0000` (`DecevalSoap.php:766`). Un sobre con `exitoso=true` y una descripción en prosa se
    // rechaza igual, y el log dice «no exitoso» — que apunta al nodo equivocado.
    RespuestaFirmarPagaresDTO: (id) => `
        <exitoso>${exitoso}</exitoso>
        <descripcion>${FAIL ? 'SDL.SE.9999 Firma rechazada por el mock' : 'SDL.SE.0000 Pagaré firmado'}</descripcion>`,
};

/** Del DTO raíz de la petición al contenedor de la respuesta. */
function contenedorPara(cuerpo) {
    if (cuerpo.includes('CreacionGiradoresCodificados')) return 'RespuestaCrearGiradorDaneServiceDTO';
    if (cuerpo.includes('CreacionPagaresCodificado')) return 'RespuestaDocumentoPagareDaneServiceDTO';
    if (cuerpo.includes('consultarPagares')) return 'RespuestaConsultarPagaresDTO';
    if (cuerpo.includes('firmarPagares')) return 'RespuestaFirmarPagaresDTO';
    return null;
}

http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
        if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ mock: 'deceval', puerto: PORT, fail: FAIL }));
        }

        const contenedor = contenedorPara(cuerpo);
        if (!contenedor) {
            // Ruidoso a propósito: una operación que no reconozco devolvería un sobre que el backend
            // lee como «sin respuesta», y ese mensaje no dice que el mock fue el que no supo.
            log('⚠ operación DESCONOCIDA — el cuerpo no trae ninguno de los cuatro DTO raíz');
            log('   primeros 300 caracteres:', cuerpo.slice(0, 300).replace(/\s+/g, ' '));
            res.writeHead(500, { 'content-type': 'text/xml' });
            return res.end('<error>mock-deceval: operación no reconocida</error>');
        }

        log(`${contenedor} → exitoso=${exitoso}`);
        res.writeHead(200, { 'content-type': 'text/xml' });
        res.end(
            `<?xml version="1.0" encoding="UTF-8"?>` +
            `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
            `<soap:Body><ser:${contenedor} xmlns:ser="${NS}">` +
            CUERPOS[contenedor](nuevoId()) +
            `</ser:${contenedor}></soap:Body></soap:Envelope>`,
        );
    });
}).listen(PORT, () => log(`mock-deceval escuchando en :${PORT}${FAIL ? ' (FAIL)' : ''}`));

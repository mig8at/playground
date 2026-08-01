// Mock del PDF-MAPPER-SERVICE — el microservicio que genera documentos que NO tienen plantilla Blade.
//
// POR QUÉ EXISTE (descubierto corriendo `dev/sweep.ts close creditop 24`, 2026-07-19):
//   El cierre de Credifamilia (rt=4) NO se traba en el SOAP como se suponía, sino acá:
//     "Credifamilia document generation failed for vinculacion: pdf-mapper-service connection failure"
//   En `config/documents.php` casi todos los documentos tienen `default => 'blade'`, pero **`vinculacion`
//   es 'microservice' POR DISEÑO** (decisión D-TF-3): no tiene contraparte Blade en el monolito, y la
//   política operativa es devolver 503 en vez de degradar. O sea: no hay fallback que activar — la única
//   forma de recorrer ese flujo en local es mockear el micro.
//
// CONTRATO (leído de app/Services/PdfMapperClient.php):
//   POST {base}/api/projects/{projectSlug}/documents/{serviceDocName}/generate   body = payload JSON
//        → 2xx y **el BODY de la respuesta SON LOS BYTES DEL PDF** (no un JSON con una url).
//   GET  {base}/api/projects/{projectSlug}/documents/{serviceDocName}/status
//   Un 5xx del micro → DocumentGenerationUnavailableException; 404 → TemplateNotFoundException.
//
// Uso:  node mock-pdf-mapper/server.mjs   (o  bin/mock-pdf-mapper start)
//   env: MOCK_PDFMAP_PORT (8100) · MOCK_PDFMAP_FAIL=1 → 503 (probar la política de "no degradar")

import http from 'node:http';
import { minimalPdf } from '../pkg/pdf-mock.ts';

const PORT = Number(process.env.MOCK_PDFMAP_PORT || 8100);
const FAIL = process.env.MOCK_PDFMAP_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// `/api/projects/{slug}/documents/{doc}/generate|status`
const RUTA = /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/(generate|status)$/;

const server = http.createServer((req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ mock: 'pdf-mapper-service', port: PORT, fail: FAIL }));
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        const m = RUTA.exec(url.pathname);
        if (!m) {
            log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${body ? ' body=' + body.slice(0, 200) : ''}`);
            res.writeHead(404, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ruta no mockeada', path: url.pathname }));
        }
        const [, slug, doc, accion] = m;

        if (accion === 'status') {
            log(`status proyecto=${slug} doc=${doc}`);
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ project: slug, document: doc, available: true }));
        }

        if (FAIL) {
            log(`FAIL forzado ← generate proyecto=${slug} doc=${doc}`);
            res.writeHead(503, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'servicio no disponible (simulado)' }));
        }

        // Éxito: el BODY es el PDF. Lo etiquetamos con el proyecto y el documento para poder reconocerlo
        // si alguien lo abre (es un documento de demo, no el real).
        const pdf = minimalPdf(`DEMO ${slug} / ${doc} - generado por el mock del pdf-mapper`);
        log(`generate proyecto=${slug} doc=${doc} payload=${body.length}b → PDF ${pdf.length}b`);
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
        res.end(pdf);
    });
});

server.listen(PORT, () => log(`mock-pdf-mapper escuchando en :${PORT}${FAIL ? ' · modo 503' : ''}`));

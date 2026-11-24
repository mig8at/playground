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
//        → { doc, status: { "<doc>.json": bool, "<doc>.pdf": bool }, updatedAt }  ← la forma la
//          exige `pdf:health-check`, que NO mira un `available` (ver el comentario en la ruta).
//   GET  {base}/health   ← liveness; sin esto `pdf:health-check` aborta antes de mirar nada.
//   Un 5xx del micro → DocumentGenerationUnavailableException; 404 → TemplateNotFoundException.
//
// Uso:  node mock-pdf-mapper/server.mjs   (o  bin/mock-pdf-mapper start)
//   env: MOCK_PDFMAP_PORT (8100) · MOCK_PDFMAP_FAIL=1 → 503 (probar la política de "no degradar")
//        MOCK_PDFMAP_REAL (http://localhost:8080; vacío = nunca) → el pdf-mapper-service REAL de la máquina
//
// LO QUE EL SERVICIO REAL TIENE, LO GENERA ÉL (2026-11-24). Si el pdf-mapper-service de la máquina (el que corre el
// PDF Mapper Studio, :8080) tiene ese proyecto y ese documento, el pedido se le reenvía tal cual y vuelve su PDF:
// el documento de verdad, lleno con el payload del backend (así se ven los de Finandina en local). Lo que no tiene
// sigue saliendo del PDF de demo de siempre, así que el resto de las entidades no cambia. Si el real no contesta, se
// usa el demo y se avisa en el log.
//
// ESO ES EL MODO «auto», y hay otros dos (`pkg/mock-modes.ts`, se eligen en la pestaña Mocks del panel o con
// `bin/mock-pdf-mapper mode mock|auto|real`; se lee en cada pedido, sin reiniciar):
//   mock → siempre el PDF de demo, aunque el servicio real tenga el documento.
//   real → TODO va al pdf-mapper-service (también /health, status y merge-urls), sin demo de respaldo: un documento
//          que falta da el 404 del servicio y uno que falla, su error. Si el servicio no contesta, 502 y se dice.

import http from 'node:http';
import { minimalPdf } from '../pkg/pdf-mock.ts';
import { mockMode } from '../pkg/mock-modes.ts';

const PORT = Number(process.env.MOCK_PDFMAP_PORT || 8100);
const FAIL = process.env.MOCK_PDFMAP_FAIL === '1';
const REAL = (process.env.MOCK_PDFMAP_REAL ?? 'http://localhost:8080').replace(/\/$/, '');

// ¿El servicio real tiene este documento? Pregunta la lista de documentos del proyecto (2 s como mucho).
async function realHas(slug, doc) {
    if (!REAL) return false;
    try {
        const r = await fetch(`${REAL}/api/projects/${encodeURIComponent(slug)}/documents`, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) return false;
        const docs = (await r.json())?.documents ?? [];
        return docs.includes(doc);
    } catch {
        return false;
    }
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Modo «real»: el pedido tal cual al servicio, y su respuesta tal cual de vuelta.
async function proxyToReal(req, res, body, url) {
    if (!REAL) {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'modo real sin servicio: MOCK_PDFMAP_REAL está vacío' }));
    }
    try {
        const r = await fetch(`${REAL}${url.pathname}${url.search}`, {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] ?? 'application/json', accept: req.headers.accept ?? '*/*' },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
            signal: AbortSignal.timeout(45000),
        });
        const bytes = Buffer.from(await r.arrayBuffer());
        log(`REAL ${req.method} ${url.pathname} → ${r.status} ${bytes.length}b`);
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream', 'content-length': bytes.length });
        res.end(bytes);
    } catch (e) {
        log(`✗ REAL ${req.method} ${url.pathname}: el servicio no contestó (${e?.message ?? e})`);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `modo real: el pdf-mapper-service no contesta en ${REAL}`, detail: String(e?.message ?? e) }));
    }
}

// `/api/projects/{slug}/documents/{doc}/generate|status`
const PATH = /^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/(generate|status)$/;

const server = http.createServer((req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ mock: 'pdf-mapper-service', port: PORT, fail: FAIL, mode: mockMode('pdf-mapper'), real: REAL }));
    }

    const mode = mockMode('pdf-mapper');
    if (mode === 'real') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => void proxyToReal(req, res, raw, url));
        return;
    }

    // `/health` es la SONDA DEL PRODUCT, no una comodidad del mock: `artisan pdf:health-check` la pega
    // primero y, si no contesta 2xx, ABORTA sin llegar a mirar ningún documento. Sin esta ruta el
    // chequeo decía «pdf-mapper-service /health returned HTTP 404» — que se lee como «el servicio está
    // mal cableado» cuando lo único que pasaba era que el mock no implementaba la ruta. Medido el
    // 2026-09-18 contra `PdfMapperClient::checkHealth()` (`$this->baseUrl.'/health'`).
    if (url.pathname === '/health') {
        res.writeHead(FAIL ? 503 : 200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ status: FAIL ? 'down' : 'ok', mock: true }));
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        // `/api/merge-urls` es la RADICACIÓN de Credifamilia, no la generación de un documento: recibe
        // las nueve URLs del paquete legalizado y devuelve UN pdf con todo pegado.
        //
        // ⚠ NO DESCARGA NADA, y eso importa saberlo: el servicio real sí baja cada URL, así que una
        // rota allá revienta y acá pasa. Lo que se prueba con este mock es que el backend arme la lista
        // y siga; que las nueve URLs sean alcanzables es otra pregunta, y ésta no la contesta.
        if (url.pathname === '/api/merge-urls') {
            let urls = [];
            try { urls = JSON.parse(body || '{}').urls ?? []; } catch { /* se loguea abajo */ }
            if (FAIL) {
                log(`merge-urls ${urls.length} urls → 503 (modo fallo)`);
                res.writeHead(503, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ error: 'merge no disponible' }));
            }
            const pdf = minimalPdf(`DEMO paquete legalizado - ${urls.length} documentos unidos por el mock`);
            log(`merge-urls ${urls.length} urls → PDF ${pdf.length}b`);
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
            return res.end(pdf);
        }

        const m = PATH.exec(url.pathname);
        if (!m) {
            log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${body ? ' body=' + body.slice(0, 200) : ''}`);
            res.writeHead(404, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'ruta no mockeada', path: url.pathname }));
        }
        const [, slug, doc, action] = m;

        if (action === 'status') {
            log(`status proyecto=${slug} doc=${doc}`);
            // ⚠ LA FORMA IMPORTA, y la primera versión de este mock la inventó. Devolvía
            // `{project, document, available: true}` y `pdf:health-check` lo leía como NO
            // bootstrappeado: el comando no mira `available`, busca DOS CLAVES cuyo nombre incluye el
            // del documento (`PdfHealthCheck.php:202-207`, verificado contra `main` el 2026-09-18):
            //     { doc, status: { "<doc>.json": bool, "<doc>.pdf": bool }, updatedAt }
            // Un mock que contesta 200 con la forma equivocada es peor que uno que no contesta: el 404
            // se ve, y este se lee como «el mapper de ese documento no está subido».
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({
                doc,
                status: { [`${doc}.json`]: !FAIL, [`${doc}.pdf`]: !FAIL },
                updatedAt: Math.floor(Date.now() / 1000),
            }));
        }

        if (FAIL) {
            log(`FAIL forzado ← generate proyecto=${slug} doc=${doc}`);
            res.writeHead(503, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'servicio no disponible (simulado)' }));
        }

        const demo = () => {
            // Éxito: el BODY es el PDF. Lo etiquetamos con el proyecto y el documento para poder reconocerlo
            // si alguien lo abre (es un documento de demo, no el real).
            const pdf = minimalPdf(`DEMO ${slug} / ${doc} - generado por el mock del pdf-mapper`);
            log(`generate proyecto=${slug} doc=${doc} payload=${body.length}b → PDF ${pdf.length}b`);
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
            res.end(pdf);
        };
        (mode === 'mock' ? Promise.resolve(false) : realHas(slug, doc)).then(async (has) => {
            if (!has) return demo();
            try {
                const r = await fetch(`${REAL}/api/projects/${encodeURIComponent(slug)}/documents/${encodeURIComponent(doc)}/generate`, {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: body || '{}', signal: AbortSignal.timeout(45000),
                });
                const bytes = Buffer.from(await r.arrayBuffer());
                log(`generate proyecto=${slug} doc=${doc} payload=${body.length}b → REAL ${REAL} ${r.status} ${bytes.length}b`);
                res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/pdf', 'content-length': bytes.length });
                res.end(bytes);
            } catch (e) {
                log(`⚠ el servicio real no contestó (${e?.message ?? e}): se usa el demo`);
                demo();
            }
        });
    });
});

server.listen(PORT, () => log(`mock-pdf-mapper escuchando en :${PORT} · modo ${mockMode('pdf-mapper')}${FAIL ? ' · fallo 503' : ''}`));

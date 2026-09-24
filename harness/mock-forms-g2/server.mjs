// Mock del FORM-SERVICE (el «G2», backend-driven) — el que sirve el formulario del VEHÍCULO de BCP.
//
// ⚠ NO CONFUNDIR CON `mock-forms/` (:8101). Ése imita `onboarding-forms-service`, el de los comercios
// dominicanos, cuyos schemas viven en S3 y cuelgan de `VITE_ONBOARDING_FORM_SERVICE`. Éste imita
// `form-service` (el MS Go de José, repo `github/form-service`), que cuelga de
// `VITE_FORM_SERVICE_BASE_URL` y es de donde salen el esquema, las respuestas guardadas y los árboles
// de opciones del formulario dinámico backend-driven.
//
// POR QUÉ EXISTE (medido el 2026-09-07):
//   En local, `bin/asesor` apuntaba `VITE_FORM_SERVICE_BASE_URL` a **dev**
//   (`form-service.inertia-develop:8082`) porque «no hay mock G2». Leer de ahí es gratis, pero
//   **guardar no**: `POST /v1/dynamic-form/{ft}/response/{userRequestId}` ESCRIBE, y el
//   `userRequestId` de una corrida local (466347) es en dev la solicitud de otra persona. O sea que
//   recorrer el formulario del vehículo de BCP en «local» ensuciaba la BD COMPARTIDA de dev+staging
//   con las respuestas de un vehículo sintético, colgadas de una solicitud ajena.
//   El servicio real sí es ejecutable en local (Go), pero pide Go 1.25, Taskfile, Redis, un módulo
//   privado y el árbol de vehículos en S3: correrlo no alcanza, hace falta el bucket.
//
// DISEÑO — misma idea que `mock-forms/`: fidelidad REAL sin inventar nada.
//   · Los esquemas y los árboles se sirven desde `fixtures/`, **capturados de dev** (sólo lectura) el
//     2026-09-07. Para refrescarlos, `node mock-forms-g2/server.mjs --capturar`.
//   · Las RESPUESTAS son en memoria, por `(form_type_id, user_request_id)`: es lo único que el
//     servicio real persiste y lo único que no se puede traer de dev sin escribirle.
//   · Se pierde al reiniciar A PROPÓSITO: un mock que recuerda entre corridas hace pasar una prueba
//     por lo que dejó la anterior. Para inspeccionarlo sin adivinar: `GET /_estado`.
//
// Uso:  node mock-forms-g2/server.mjs   ·   env: MOCK_FORMS_G2_PORT (8109)

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const PORT = Number(process.env.MOCK_FORMS_G2_PORT || 8109);
/** El servicio de dev, del que salen los fixtures. Sólo se lee, y sólo con `--capturar`. */
const ORIGIN = process.env.FORM_SERVICE_ORIGEN || 'http://form-service.inertia-develop:8082';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

const fixture = (name) => {
    const path = join(FIXTURES, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

/* ── LAS RESPUESTAS, lo único que este mock guarda ────────────────────────────────────────────────
 * Clave `<form_type_id>:<user_request_id>`, igual que el servicio real: por SOLICITUD, no por
 * cliente. Es la diferencia que el front documenta en `form-response-answers.repository.ts` — la
 * información suplementaria es del cliente y por eso llenaba un formulario nuevo con el vehículo de
 * la solicitud anterior; esto es de la solicitud y por eso sirve para retomar. */
const answers_ = new Map();
const key = (ft, ur) => `${ft}:${ur}`;

/** El id numérico que el front usa como clave: manda `field_248`, el servicio guarda `248`. */
const withoutPrefix = (k) => String(k).replace(/^field_/, '');

async function capture() {
    const pieces = [
        ['dynamic-form/8/schema', 'esquema-8.json', 'GET'],
        ['dynamic-form/9/schema', 'esquema-9.json', 'GET'],
        ['field-options/bcp/cars-tree', 'cars-tree.json', 'GET'],
        ['field-options/countries', 'countries.json', 'GET'],
        // ⚠ El árbol de un país se pide con PUT, no con GET: lo CONSTRUYE si no está cacheado.
        // Es una lectura para quien llama, pero el verbo no lo parece.
        ['field-options/country-tree/167', 'country-tree-167.json', 'PUT'],
    ];
    for (const [path, file, method] of pieces) {
        const r = await fetch(`${ORIGIN}/v1/${path}`, { method: method, headers: { 'content-type': 'application/json' } });
        const text = await r.text();
        if (!r.ok) { log(`✗ ${file}: HTTP ${r.status}`); continue; }
        writeFileSync(join(FIXTURES, file), text);
        log(`✓ ${file}  ${text.length} bytes  (de ${ORIGIN})`);
    }
}

if (process.argv.includes('--capturar')) { await capture(); process.exit(0); }

const server = http.createServer(async (req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/_salud') return json(res, 200, { mock: 'form-service (G2)', port: PORT });
    /* La ventana al estado. Existe para que una prueba pueda AFIRMAR qué quedó guardado sin leer
       la BD de nadie — es el equivalente del `SELECT` que acá no hay. */
    if (path === '/_estado') {
        return json(res, 200, {
            guardadas: [...answers_.entries()].map(([k, v]) => ({ clave: k, campos: Object.keys(v).length, answers: v })),
        });
    }
    if (path === '/_reset') { answers_.clear(); return json(res, 200, { ok: true }); }

    // ── el ESQUEMA de un formulario ──
    let m = path.match(/^\/v1\/dynamic-form\/(\d+)\/schema$/);
    if (m) {
        const reqBody = fixture(`esquema-${m[1]}.json`);
        if (!reqBody) return json(res, 404, { code: 'DYNAMIC_FORM_SCHEMA_NOT_FOUND', message: `sin fixture para el form_type ${m[1]}`, payload: null });
        return json(res, 200, reqBody);
    }

    // ── las RESPUESTAS de una solicitud a un formulario ──
    m = path.match(/^\/v1\/dynamic-form\/(\d+)\/response\/(\d+)$/);
    if (m) {
        const [, ft, ur] = m;
        if (req.method === 'GET') {
            const saved = answers_.get(key(ft, ur));
            /* ⚠ EL 404 NO ES UN ERROR ACÁ: es «esta solicitud todavía no respondió este formulario»,
               y los tres consumidores del front lo tratan así (respuestas vacías, `hasAnswered` en
               false). Devolver 200 con `{}` rompería `hasAnswered`, que sólo mira el status. */
            if (!saved) return json(res, 404, { code: 'DYNAMIC_FORM_RESPONSE_NOT_FOUND', message: 'Dynamic form response not found.', payload: null });
            return json(res, 200, {
                code: 'DYNAMIC_FORM_RESPONSE_FOUND', message: 'Dynamic form response found.',
                payload: { formId: Number(ft), userRequestId: Number(ur), answers: saved },
            });
        }
        if (req.method === 'POST') {
            const raw = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
            let entry = {};
            try { entry = JSON.parse(raw || '{}'); } catch { return json(res, 400, { code: 'INVALID_BODY', message: 'cuerpo no es JSON', payload: null }); }
            const normalized = {};
            for (const [k, v] of Object.entries(entry.answers ?? {})) normalized[withoutPrefix(k)] = v;
            /* REEMPLAZA, no mezcla: es lo que hace el servicio real (EAV replace) y lo que hace que
               volver a guardar el formulario con un campo menos DEJE ESE CAMPO VACÍO. Si acá se
               mezclara, una prueba de re-edición pasaría por el recuerdo del mock. */
            answers_.set(key(ft, ur), normalized);
            log(`guardado form ${ft} · solicitud ${ur} · ${Object.keys(normalized).length} campos`);
            return json(res, 200, {
                code: 'DYNAMIC_FORM_RESPONSE_SAVED', message: 'Dynamic form response saved.',
                payload: { formId: Number(ft), userRequestId: Number(ur), answers: normalized },
            });
        }
    }

    // ── los ÁRBOLES de opciones ──
    if (path === '/v1/field-options/bcp/cars-tree') {
        const reqBody = fixture('cars-tree.json');
        return reqBody ? json(res, 200, reqBody) : json(res, 404, { code: 'CARS_TREE_NOT_FOUND', payload: null });
    }
    if (path === '/v1/field-options/countries') {
        const reqBody = fixture('countries.json');
        return reqBody ? json(res, 200, reqBody) : json(res, 404, { code: 'COUNTRIES_NOT_FOUND', payload: null });
    }
    m = path.match(/^\/v1\/field-options\/country-tree\/(\d+)$/);
    if (m) {
        // Sólo está el de Perú: es el país que este mock existe para poder recorrer. Otro país cae al
        // 404, que el front trata como accesorio (el formulario abre igual y se completa a mano).
        const reqBody = fixture(`country-tree-${m[1]}.json`);
        return reqBody ? json(res, 200, reqBody) : json(res, 404, { code: 'COUNTRY_TREE_NOT_FOUND', message: `sin fixture del país ${m[1]}`, payload: null });
    }

    /* ── la INFORMACIÓN SUPLEMENTARIA ──
     * Se contesta VACÍA a propósito. El front dejó de usarla para precargar el formulario del
     * vehículo justamente porque devuelve los datos de la solicitud ANTERIOR del cliente
     * (`placement-form.tsx`: «el formulario no se precarga, a propósito»). Un mock que la llenara
     * volvería a meter ese dato por la ventana y taparía la regresión que el comentario describe. */
    if (/^\/v1\/suplementary-info\/user-info\/\d+$/.test(path)) {
        return json(res, 200, { code: 'SUPPLEMENTARY_INFO_FOUND', message: 'Supplementary info found.', payload: { userInfo: {} } });
    }

    log(`✗ sin manejador: ${req.method} ${path}`);
    return json(res, 404, { code: 'NOT_FOUND', message: `mock-forms-g2 no maneja ${req.method} ${path}`, payload: null });
});

server.listen(PORT, () => log(`mock-forms-g2 (form-service) escuchando en :${PORT} · fixtures de dev en mock-forms-g2/fixtures/`));

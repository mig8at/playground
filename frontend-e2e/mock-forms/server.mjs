// Mock del ONBOARDING-FORMS-SERVICE — el que sirve el SCHEMA del flujo dinámico (`/request-amount`).
//
// POR QUÉ EXISTE (verificado 2026-07-19):
//   Los comercios de RD (`allieds.country_id = 60`, ej. CeluRD/SmartPay) entran por el flujo DINÁMICO:
//   `/merchant/{hash}/request-amount` en vez de `/solicitar`. Ese loader hace
//       GET {VITE_ONBOARDING_FORM_SERVICE}/dynamic/{partner_hash}/schema
//   y si falla muestra **"Formulario no encontrado"**. En local el host apunta a
//   `onboarding-forms-service.inertia-develop:8092` (necesita VPN).
//
//   El servicio REAL sí es ejecutable en local (Go, `~/github/onboarding-forms-service`, compila y
//   levanta) — PERO los schemas viven en **S3** y con las credenciales del `config.example.yaml` la
//   llamada devuelve `S3 HeadObject 400`. O sea: correr el servicio no alcanza, hace falta el bucket.
//
// DISEÑO — pensado para migrar a fidelidad REAL sin tocar código:
//   · Si existe `mock-forms/schemas/<form_id>.json` → **se sirve ESE** (dejá ahí el schema real y listo).
//   · Si no, se sirve un schema genérico VÁLIDO (tipos verificados contra `FormSchema` de
//     `@creditop/dynamic-form`) que permite recorrer el flujo, pero cuyo CONTENIDO es inventado.
//   Para conseguir el schema real: con VPN, `curl http://onboarding-forms-service.inertia-develop:8092/v1/dynamic/<hash>/schema > mock-forms/schemas/<hash>.json`
//
// Cubre además los otros endpoints del flujo dinámico (send-otp, validate-otp, submit, upload,
// find-user-by-*), en sus dos variantes de ruta (`/dynamic/...` y `/dynamic/full/...`).
//
// Uso:  node mock-forms/server.mjs   (o  bin/mock-forms start)
//   env: MOCK_FORMS_PORT (8101)

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_FORMS_PORT || 8101);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

// Schema genérico VÁLIDO: tipos tomados de la unión `Field` (text|email|phone|otp|select|choice|
// radio|file|dateSelect) y la forma de `FormSchema` (step, theme, components, fields, steps).
// El monto va como `text` porque NO existe un tipo `money` en la unión.
const schemaGenerico = (formId) => ({
    step: 'requestAmount',
    theme: 'default',
    // OJO: el loader de `request-amount.tsx` NO acepta cualquier schema — valida la forma y exige
    // `theme` + `components.logo.boxs.image` + `components.logo.boxs.userName`. Si falta alguno tira
    // 502 con `errorStage: 'invalid_schema_shape'` (y en pantalla se ve "Formulario no encontrado",
    // igual que si el servicio estuviera caído: el síntoma NO distingue ambos casos).
    components: {
        logo: {
            boxs: {
                image: { type: 'image', src: 'https://creditop.com/logo.png' },
                userName: { type: 'text', text: 'MOCK · schema genérico del harness' },
            },
            grid: [['image', 'userName']],
        },
    },
    // OJO: `PersonalInfoForm` es el único paso DATA-DRIVEN de verdad — lee las opciones de
    // `fields.cityOfResidence.options` y `fields.documentType.options`. Si falta `cityOfResidence`
    // el desplegable de ciudad queda VACÍO y el formulario no deja continuar
    // ("Selecciona tu ciudad para continuar"). Los demás pasos (Amount/Phone/Otp/Financial) no leen
    // `fields`, así que su contenido no depende del schema.
    fields: {
        amount: { type: 'text', label: 'Monto a solicitar', required: true, placeholder: '0', allowed: '0123456789' },
        phone: { type: 'phone', label: 'Celular', required: true, country: 'DO' },
        email: { type: 'email', label: 'Correo electrónico', required: true },
        // ⚠ El flujo DINÁMICO usa OTRA taxonomía de documentos que el clásico: NO acepta CC/CE/PEP.
        // `dynamic-step-one.ts::isSupportedDocumentType` solo admite estos cuatro, cada uno con su patrón:
        //   CED    cédula dominicana  → exactamente 11 dígitos
        //   CI_VE  cédula venezolana  → 6 a 11 dígitos
        //   PAS / PAS_VE  pasaporte   → 6 a 9 alfanuméricos
        // Con un tipo fuera de esa lista el form muestra "Selecciona un tipo de documento válido"
        // debajo del NÚMERO (no del selector), lo que hace parecer que el número está mal.
        documentType: { type: 'select', label: 'Tipo de documento', required: true, options: ['CED', 'CI_VE', 'PAS', 'PAS_VE'], horizontal: true },
        document: { type: 'text', label: 'Número de identidad', required: true, allowed: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
        // Ciudades de RD (el canal es dominicano). Sustituilas por las reales dejando el schema
        // verdadero en mock-forms/schemas/<hash>.json.
        cityOfResidence: {
            type: 'select', label: 'Ciudad donde resides', required: true,
            options: ['Santo Domingo', 'Santiago de los Caballeros', 'La Romana', 'San Pedro de Macorís', 'Puerto Plata', 'San Cristóbal'],
        },
    },
    steps: {
        requestAmount: {
            title: 'MOCK · ¿Cuánto necesitás?',
            paragraph: `Schema GENÉRICO del harness (no es el real de ${formId}). Dejá el real en mock-forms/schemas/${formId}.json`,
            sections: [{ grid: [['amount']] }],
            next: { label: 'Continuar', step: 'phoneNumber' },
        },
        phoneNumber: {
            title: 'MOCK · Tu celular',
            sections: [{ grid: [['phone'], ['email']] }],
            next: { label: 'Continuar', step: 'personalInformation', post: 'send-otp' },
        },
        personalInformation: {
            title: 'MOCK · Tus datos',
            sections: [{ grid: [['documentType', 'document']] }],
            next: { label: 'Continuar', post: 'submit' },
        },
    },
});

function schemaFor(formId) {
    const f = join(HERE, 'schemas', `${formId}.json`);
    if (existsSync(f)) {
        try { return { body: JSON.parse(readFileSync(f, 'utf8')), real: true }; }
        catch (e) { log(`⚠ ${formId}.json existe pero NO parsea: ${e.message}`); }
    }
    return { body: schemaGenerico(formId), real: false };
}

const server = http.createServer((req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/health')) {
        return json(res, 200, { mock: 'onboarding-forms-service', port: PORT });
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        // GET /v1/dynamic/{form_id}/schema     · también /v1/dynamic/full/{form_id}/schema
        const mSchema = /^\/v1\/dynamic\/(?:full\/)?([^/]+)\/schema$/.exec(p);
        if (req.method === 'GET' && mSchema) {
            const { body: sch, real } = schemaFor(mSchema[1]);
            log(`schema form_id=${mSchema[1]} → ${real ? 'REAL (schemas/*.json)' : 'genérico del mock'}`);
            return json(res, 200, sch);
        }

        const mAccion = /^\/v1\/dynamic\/(?:full\/)?([^/]+)\/(send-otp|validate-otp|submit|upload)$/.exec(p);
        if (req.method === 'POST' && mAccion) {
            const [, formId, accion] = mAccion;
            log(`${accion} form_id=${formId} step=${url.searchParams.get('step') ?? '-'} body=${body.slice(0, 120)}`);
            if (accion === 'send-otp') return json(res, 200, { success: true, message: 'OTP enviado (mock)' });
            if (accion === 'validate-otp') return json(res, 200, { success: true, valid: true, message: 'OTP válido (mock)' });
            if (accion === 'upload') return json(res, 200, { success: true, url: 'https://mock-forms.local/upload/demo.png' });
            return json(res, 200, { success: true, message: 'submit recibido (mock)' });
        }

        // Verificación de correo / documento. EL VEREDICTO VA EN `code`, NO en el HTTP status: el wizard
        // compara contra constantes de `request-personal-info.shared.ts` y con cualquier otra cosa muestra
        // "No pudimos validar tu correo. Inténtalo de nuevo." aunque la respuesta sea 200.
        //   OFS6001 correo disponible · OFS6000 correo tomado
        //   OFS7001 documento disponible · OFS7000 documento tomado
        // Con `?taken=1` (o MOCK_FORMS_TAKEN=1) se devuelve el veredicto de "ya registrado", para probar
        // ese camino sin ensuciar datos.
        const mFind = /^\/v1\/dynamic\/full\/find-user-by-(email|document-number)$/.exec(p);
        if (req.method === 'POST' && mFind) {
            const taken = url.searchParams.get('taken') === '1' || process.env.MOCK_FORMS_TAKEN === '1';
            const esEmail = mFind[1] === 'email';
            const code = esEmail ? (taken ? 'OFS6000' : 'OFS6001') : (taken ? 'OFS7000' : 'OFS7001');
            log(`${mFind[1]} body=${body.slice(0, 90)} → code ${code} (${taken ? 'TOMADO' : 'disponible'})`);
            return json(res, 200, { code, success: true, found: taken, user: null });
        }

        log(`⚠ RUTA NO MAPEADA ← ${req.method} ${p}${url.search}${body ? ' body=' + body.slice(0, 200) : ''}`);
        json(res, 404, { success: false, error: 'ruta no mockeada', path: p });
    });
});

server.listen(PORT, () => log(`mock-forms escuchando en :${PORT} (schemas reales en mock-forms/schemas/<hash>.json)`));

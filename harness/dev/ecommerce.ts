// ecommerce.ts — EL CANAL ECOMMERCE de punta a punta, declarado en JSON y sin navegador.
//
//   node dev/ecommerce.ts --suite suites/ecommerce.json
//   node dev/ecommerce.ts --comercio amoblar            (un caso suelto, sin suite)
//
// LA PREGUNTA QUE CONTESTA, y que ninguna otra herramienta del harness contesta hoy: cuando una
// solicitud entra DESDE UNA TIENDA, ¿el contrato del carrito se decodifica, el comercio queda
// vinculado al crédito, y lo que el comercio ya sabía del comprador llega al formulario?
//
// `dev/case.ts` empieza DESPUÉS: recibe el comercio y la entidad como entrada y no sabe nada de
// canales — `grep -c ecommerce dev/case.ts` da 0. Por eso esto es un runner aparte y no una suite
// más de aquél.
//
// ⚠ LO QUE ESTE PROGRAMA **NO** HACE: pintar pantallas. Valida el CONTRATO entre el front y legacy,
// que es donde viven los defectos que el build y los tipos no ven. Lo visual se mira corriendo el
// wizard.
//
// GOTCHAS que ya costaron tiempo y que acá aplican igual:
//   · `E2E_TARGET` por defecto es **dev** → se fuerza `local` salvo override explícito.
//   · el OTP se valida por el MISMO camino que el front (`kyc-flow` → v1 o v2), con la forma del campo
//     que lee ESE endpoint. Pegar a uno fijo dio verde con el navegador roto (2026-09-14).
//   · UA de **iPhone** siempre: con UA de escritorio `onlyMobileValidation` responde 403 en las
//     rutas que lo llevan. (El endpoint de la sala de espera está a propósito en un grupo que lo
//     excluye, y este runner lo comprueba.)
//   · celular, documento y correo ÚNICOS por corrida: son UNIQUE en `users` y reusarlos hace fallar
//     el registro con un 4xx que parece del producto.

import { readFileSync } from 'node:fs';

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

/* ⚠ IMPORTS DINÁMICOS, y no es estilo: `pkg/db.ts` resuelve `TARGET` al evaluar el módulo, y los
   imports estáticos corren ANTES de la primera sentencia de este archivo. Con `import … from`, las
   dos líneas de arriba llegan tarde y el runner lee y escribe contra el RDS COMPARTIDO de dev
   creyendo que está en local. Es **F-187**, medido el 2026-09-09 en `sweep.ts` y `listing.ts`. */
const { buildEcommerceUrl } = await import('../pkg/ecommerce.ts');
const { one, close } = await import('../pkg/db.ts');
const { config: e2eConfig } = await import('../pkg/config.ts');
const { createCustomer } = await import('../pkg/http.ts');

const API = e2eConfig.mockUrl;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

interface Case {
    nombre?: string;
    comercio: string;
    amount?: number;
    /** Qué tiene que ser cierto. Lo que no se declara, no se comprueba. */
    espera?: {
        /** Los campos del `prefill` que el comercio DEBE entregar (los seis del contrato). */
        prefill?: string[];
        /** La solicitud queda atada al pedido (`ecommerce_requests.user_request_id` + el puente). */
        vinculada?: boolean;
        /** Cuántas entidades como mínimo salen en el listado. */
        entidadesMin?: number;
        /** El endpoint de la sala de espera responde, y lo hace con UA de ESCRITORIO. */
        salaDeEspera?: boolean;
        /** La sala de espera devuelve el «volver al comercio» de esta tienda. */
        returnUrl?: boolean;
    };
}

interface Suite { nombre?: string; porDefecto?: Partial<Case>; casos: Case[] }

// ── salida ─────────────────────────────────────────────────────────────────────────────────────
const V = '\x1b[32m', R = '\x1b[31m', N = '\x1b[0m', B = '\x1b[1m';
let failures = 0;
const ok = (t: string, d = '') => console.log(`    ${V}✓${N} ${t}${d ? ` · ${d}` : ''}`);
const bad = (t: string, d = '') => { failures++; console.log(`    ${R}✗${N} ${t}${d ? ` · ${d}` : ''}`); };

/**
 * El porqué de un fallo HTTP, no sólo el número.
 *
 * ⚠ «HTTP 422» a secas cuesta una vuelta entera de diagnóstico: hay que salir a reproducir el endpoint
 * con curl para ver qué campo se quejó. Laravel devuelve el motivo en el cuerpo —`message` y `errors`
 * de la validación— y el runner lo tenía en la mano y lo tiraba. Es la misma línea que se le agregó al
 * caminador del wizard.
 */
function why(r: { status: number; json?: any; error?: string }): string {
    const j = r.json;
    const parts: string[] = [`HTTP ${r.status}`];
    const msg = j?.message ?? j?.errorMessage ?? j?.error;
    if (msg && typeof msg === 'string') parts.push(msg.slice(0, 140));
    if (j?.errorCode) parts.push(`code ${j.errorCode}`);
    // `errors` de la validación de Laravel: {campo: ["motivo"]}. El CAMPO es el dato que falta.
    if (j?.errors && typeof j.errors === 'object') {
        const fields = Object.entries(j.errors as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? String(v[0]) : String(v)}`)
            .slice(0, 4);
        if (fields.length) parts.push(fields.join(' · '));
    }
    if (!msg && r.error) parts.push(r.error.slice(0, 140));
    return parts.join(' · ');
}

// El cliente vive en `pkg/http.ts` — ver ahí las cinco copias que esto reemplaza. El `user-agent`
// sigue siendo por llamada porque cada caso de la suite simula una tienda distinta.
const customer = createCustomer({ base: API, headers: { 'user-agent': UA }, timeoutMs: 90_000, recorte: 160 });
const http = (method: string, path: string, body?: unknown, ua = UA) =>
    customer.llamar(method, path, body, ua === UA ? {} : { 'user-agent': ua });

/** Los seis campos que el contrato base64 puede traer del billing del pedido. */
const MERCHANT_FIELDS = ['email', 'phone', 'firstName', 'lastName', 'documentNumber', 'documentType'];

async function runCase(c: Case, i: number): Promise<void> {
    const title = c.nombre ?? `${c.comercio} · ${(c.amount ?? 2_000_000).toLocaleString('es-CO')}`;
    console.log(`\n  ${B}${i + 1}. ${title}${N}`);

    // ── 1 · el contrato del carrito, igual que lo emite el plugin ───────────────────────────────
    const r = Math.floor(Math.random() * 9_000_000);
    process.env.E2E_DOC = String(1_000_000_000 + r);
    // Sin destinos externos: es una prueba local y el contrato no tiene por qué apuntar a internet.
    process.env.E2E_WEBHOOK_URL = 'http://localhost:9/notificacion/';
    process.env.E2E_RETURN_URL = 'http://localhost:9/volver-al-comercio';
    // El telefono se DERIVA (aleatorio) porque en local el driver de OTP no lo mira. Contra un
    // ambiente desplegado eso no alcanza: el OTP solo es predecible si el telefono esta en la lista
    // `qa_otp_bypass_phones`, y un derivado no esta. Sin `--tel`, `otp-validate` responde 200 sin
    // `user_request_id` y el caso muere ahi — pasa las cinco comprobaciones previas y falla la sexta,
    // que es exactamente lo que se vio al correr esto contra `qa` el 2026-09-15.
    //
    // ⚠ Con `--tel` se reusa un telefono YA registrado, o sea un usuario que ya existe en ese
    // ambiente: el vinculo comercio-credito se sigue midiendo igual (es por pedido), pero el prefill
    // puede traer los datos de ese usuario y no los del contrato. Es el mismo trato que hace
    // `bcp-return.ts` contra qa.
    // ⚠ `||`, NO `??`: `arg()` devuelve CADENA VACÍA cuando el flag no está, y `'' ?? x` es `''` —
    // `??` sólo cae con null/undefined. Con `??` el teléfono derivado no se usaba NUNCA y el registro
    // moría con 422 «phone number is required», que se lee como un problema del backend. Entró al
    // agregar `--tel` para poder correr contra un ambiente desplegado, y no se vio porque esa
    // corrida SIEMPRE pasa el flag: se probó el camino nuevo y quedó roto el de siempre.
    const tel = arg('tel') || String(3_130_000_000 + r);

    let checkout: { hash: string; merchant: string; checkout_path: string; amount: number };
    try {
        checkout = await buildEcommerceUrl(c.comercio, tel, c.amount ?? 2_000_000);
    } catch (e) {
        bad('contrato', String((e as Error).message).slice(0, 120));
        return;
    }
    const q = new URLSearchParams(checkout.checkout_path.split('?')[1]);
    ok('contrato armado', `${checkout.merchant} · sucursal ${checkout.hash}`);

    // ── 2 · la entrada: lo que el front postea al abrir /ecommerce/{hash}/checkout ──────────────
    // Se llama al MISMO endpoint que llama `checkout.tsx`, con los nombres LARGOS del body (el
    // contrato viaja en la URL con nombres cortos: o/p/t/u/ps). Confundirlos es el primer error.
    const creates = await http('POST', `/api/onboarding/ecommerce-request/create/${checkout.hash}`, {
        order: q.get('o'), products: q.get('p'), token: q.get('t'),
        returnUrl: q.get('u'), processUrl: q.get('ps'), config: q.get('config'),
    });
    const data = creates.json?.data;
    const erId = data?.ecommerceRequestId;
    if (!erId) { bad('checkout', `HTTP ${creates.status} · ${creates.error ?? JSON.stringify(creates.json).slice(0, 140)}`); return; }
    ok('checkout aceptado', `ecommerce_request ${erId} · monto ${data.amount}`);

    // ── 3 · lo que el comercio ya sabía del comprador ───────────────────────────────────────────
    if (c.espera?.prefill) {
        const brings = Object.entries(data.prefill ?? {})
            .filter(([, v]) => typeof v === 'string' && v.trim() !== '' && !/^-+$/.test(v.trim()))
            .map(([k]) => k);
        const missing = c.espera.prefill.filter((k) => !brings.includes(k));
        if (missing.length) bad('prefill del comercio', `faltan: ${missing.join(', ')}`);
        else ok('prefill del comercio', `${brings.length}/${MERCHANT_FIELDS.length} campos: ${brings.join(', ')}`);
    }

    // ── 4 · el contexto por erId: lo que relee CADA pantalla, sin cookie ────────────────────────
    const ctx = await http('GET', `/api/onboarding/ecommerce-request/detail/${erId}`);
    if (ctx.json?.data?.ecommerceRequestData?.id !== erId) bad('contexto por erId', `HTTP ${ctx.status}`);
    else ok('contexto por erId', 'el front puede rehidratar sin cookie');

    // ── 5 · registro + OTP → nace la solicitud, atada al pedido ─────────────────────────────────
    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: tel, terms: true, policies: true, otp_length: 4,
        partner_branch_hash: checkout.hash, onboarding_channel: 'ecommerce',
    });
    if (reg.status < 200 || reg.status >= 300) { bad('registro', why(reg)); return; }

    /* ── EL OTP VA POR EL MISMO CAMINO QUE EL FRONT, no por uno fijo ─────────────────────────────
       `otp-verification.tsx` elige el repositorio con `kyc-flow/{hash}`: v2 si `usesPipeline`, v1 —el
       legacy del monolito— si no. Y cada endpoint lee el anclaje al pedido con SU PROPIA forma:
         v2  `ecommerceRequestId`    (ValidateOtpAuthRequest → FindOrCreateService)
         v1  `ecommerce_request_id`  (OnboardingController::validateOtpCodeAndRedirect → UserRequestService)
       Mandar la del otro equivale a no mandar nada: el backend la ignora sin un solo error.

       ⚠ Hasta el 2026-09-14 este runner pegaba SIEMPRE al v2 y daba verde («vínculo · fila y puente»)
       mientras el navegador —que en qa va por v1 para TODOS los comercios consultados— nacía sin
       vincular. Pasar por API no es pasar por el front: un runner que no recorre el camino del front no
       prueba el front. Por eso acá se resuelve el camino igual que él, y se dice cuál se tomó. */
    const kycData = await http('GET', `/api/v2/onboarding/kyc-flow/${checkout.hash}`);
    const usesPipeline = kycData.status === 200 && kycData.json?.data?.payload?.usesPipeline === true;
    const otpPath = usesPipeline ? 'v2 (pipeline) · ecommerceRequestId' : 'v1 (legacy) · ecommerce_request_id';
    ok('camino del OTP', kycData.status === 200
        ? `${otpPath} — lo dijo kyc-flow (${kycData.json?.code})`
        : `${otpPath} — kyc-flow respondió HTTP ${kycData.status} y el front cae al v1 sin avisar; acá igual (¿falta \`make harness-kyc-flow\`?)`);
    const otp = usesPipeline
        ? await http('POST', `/api/v2/onboarding/otp-auth/validate/${checkout.hash}`, {
            cellPhone: tel, otpCode: tel.slice(-4),
            originalAmount: checkout.amount, amount: checkout.amount,
            partner_branch_hash: checkout.hash,
            ecommerceRequestId: Number(erId),
        })
        : await http('POST', `/api/onboarding/loan-application/otp-validate/${checkout.hash}`, {
            cell_phone: tel, otp_code: tel.slice(-4),
            original_amount: String(checkout.amount), amount: String(checkout.amount),
            partner_branch_hash: checkout.hash,
            ecommerce_request_id: Number(erId),
        });
    // En v1 el uReq viene en TRES lugares según cómo terminó la validación (la misma trampa que anota
    // `case.ts`): usuario temporal → error ONB002 con `errors.payload`; ya válido → `data.payload`; y
    // `payload` suelto. Mirar sólo uno da «HTTP 200 y sin uReq», que se contradice solo.
    const ur = usesPipeline
        ? otp.json?.data?.payload?.userRequestId
        : (otp.json?.errors?.payload?.user_request_id ?? otp.json?.data?.payload?.user_request_id ?? otp.json?.payload?.user_request_id);
    if (!ur) { bad('otp-validate', `HTTP ${otp.status} · code ${otp.json?.code ?? otp.json?.error_code ?? '?'} · ${otpPath}`); return; }
    ok('solicitud creada', `uReq ${ur} · ${otp.json?.code ? `code ${otp.json.code}` : `HTTP ${otp.status}`} · OTP por ${usesPipeline ? 'v2' : 'v1'}`);

    if (c.espera?.vinculada) {
        const inRow = await one<{ n: number }>(
            'SELECT COUNT(*) AS n FROM ecommerce_requests WHERE id=? AND user_request_id=?', [erId, ur]);
        const inBridge = await one<{ n: number }>(
            'SELECT COUNT(*) AS n FROM user_requests_by_ecommerce_request WHERE ecommerce_request_id=? AND user_request_id=?', [erId, ur]);
        if ((inRow?.n ?? 0) > 0 && (inBridge?.n ?? 0) > 0) {
            ok('vínculo comercio ↔ crédito', 'fila y puente');
        } else {
            bad('vínculo comercio ↔ crédito',
                `fila=${inRow?.n ?? 0} puente=${inBridge?.n ?? 0} — el comercio NO recibiría el veredicto`);
        }
    }

    // ── 6 · el listado ─────────────────────────────────────────────────────────────────────────
    if (c.espera?.entidadesMin !== undefined) {
        const lis = await http('GET', `/api/onboarding/loan-application/lenders-v2/${ur}?amount=${checkout.amount}`);
        const raw = lis.json?.data ?? lis.json;
        const xs: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.lenders) ? raw.lenders : [];
        if (xs.length >= c.espera.entidadesMin) ok('listado', `${xs.length} entidad(es)`);
        else bad('listado', `${xs.length} entidad(es), se esperaban ≥ ${c.espera.entidadesMin}`);
    }

    // ── 7 · la sala de espera, con user-agent de ESCRITORIO ─────────────────────────────────────
    // Se pide con UA de escritorio A PROPÓSITO: el comprador de una tienda compra desde un
    // computador, y este endpoint vive en el grupo que excluye `onlyMobileValidation` justamente por
    // eso. Si alguien lo mueve al grupo padre, esta comprobación pasa a 403 y falla acá.
    if (c.espera?.salaDeEspera) {
        const room = await http('GET', `/api/loans/requests/device/ecommerce-status/${ur}`, undefined, UA_DESKTOP);
        if (room.status === 404) {
            bad('sala de espera', 'la ruta no existe en este ambiente (¿falta legacy-backend#1392?)');
        } else if (room.status !== 200) {
            bad('sala de espera', `HTTP ${room.status} con user-agent de escritorio`);
        } else {
            ok('sala de espera', `HTTP 200 desde escritorio · estado ${room.json?.data?.status_id}`);
            if (c.espera.returnUrl) {
                const u = room.json?.data?.ecommerce_return_url;
                if (typeof u === 'string' && u.includes('orderId=')) ok('volver al comercio', u.slice(0, 64));
                else bad('volver al comercio', `no llegó la return_url del pedido (${u ?? 'null'})`);
            }
        }
    }
}

// ── principal ──────────────────────────────────────────────────────────────────────────────────
console.log(`\n  ${B}EL CANAL ECOMMERCE${N} · ${API} · target ${process.env.E2E_TARGET}`);

const suitePath = arg('suite');
let suite: Suite;
if (suitePath) {
    suite = JSON.parse(readFileSync(new URL(`../${suitePath}`, import.meta.url), 'utf8'));
    if (suite.nombre) console.log(`  ${suite.nombre}`);
} else {
    suite = { casos: [{ comercio: arg('comercio', 'amoblar'), espera: { prefill: MERCHANT_FIELDS, vinculada: true, entidadesMin: 1 } }] };
}

const base = suite.porDefecto ?? {};
for (const [i, c] of suite.casos.entries()) {
    await runCase({ ...base, ...c, espera: { ...base.espera, ...c.espera } } as Case, i);
}

console.log(failures === 0
    ? `\n  ${V}${B}todo lo declarado se cumple${N}\n`
    : `\n  ${R}${B}${failures} comprobación(es) no se cumplieron${N}\n`);
await close();
process.exit(failures === 0 ? 0 : 1);

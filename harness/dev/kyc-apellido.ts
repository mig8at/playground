// kyc-apellido — ¿el flujo ACEPTA un segundo apellido que la central reporta como INCORRECTO?
//
//   node dev/kyc-apellido.ts
//
// Exit code = veredicto (misma convención que sweep / experian-check):
//   0 → lo RECHAZA y sigue aceptando al cliente de un solo apellido  (conducta correcta)
//   1 → lo ACEPTA: el defecto está vivo                              (lo que pasó en prod)
//   2 → no concluyente (algo se cayó antes de poder decidir)
//
// El caso: uReq 523201 (2026-08-08, Sonría PLAZA IMPERIAL). TusDatos respondió
// `second_surname: match_code = 0` («no coincide») y la solicitud avanzó igual: se guardó
// `MUSUSU NEMPEGIE` (Mareigua devolvía `NEMPEQUE`), se firmaron los documentos con ese
// nombre y se radicó así ante Credifamilia, que contestó 200. Causa:
// `TusDatosService.php:189` usaba `$matchCode == null` para tolerar los campos NO ENVIADOS,
// y en PHP `0 == null` es true — o sea que «está mal» se descartaba igual que «no lo mandé».
//
// Por qué por API y no por el wizard: es el carril rápido (segundos, sin navegador) y el
// defecto vive ENTERO en el paso `personal-info`, antes de /lenders. El camino visual es el
// del panel y lo corre Miguel.
//
// Requisitos (los verifica y los dice si faltan):
//   · stack local arriba y los drivers de KYC en fake → `cd legacy-backend && make mock-all && make drivers`
//   · `ONBOARDING_FAKES_ALLOW_HEADER=true` en el .env del backend (si no, todo cae al escenario default)
//
// ⚠ NO usa el teléfono de bypass ni llama a `scrubphone`: cada corrida genera su propio
// teléfono y su propio documento, así que no destruye la corrida anterior (ver §«Cada corrida
// destruye la anterior» del CLAUDE.md — acá no aplica a propósito).
//
// ⚠ En local NO se puede leer `kyc_name_checks`: la tabla es de 2026-07-23 y el dump es
// anterior, así que el recorder falla en silencio (está en try/catch). Lo que sí se puede
// afirmar acá es lo que quedó en `users`, que es justamente el daño.

export {}; // sin imports ni exports, TypeScript lo trata como script y prohíbe el `await` de arriba

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { config } = await import('../pkg/config.ts');
const { one, close } = await import('../pkg/db.ts');

const API = config.mockUrl;
const PARTNER = config.partnerHash;
// UA de iPhone SIEMPRE: `onlyMobileValidation` responde 403 a un UA de escritorio.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

/** Los nombres del caso real: UN nombre de pila y DOS apellidos, el segundo mal escrito. */
const NOMBRE = 'ANDREA';
const APELLIDOS = 'MUSUSU NEMPEGIE';

/** Lo que devuelve `AgildataHttpFake::employeeSuccess()`. Para probar la ADOPCIÓN hay que teclear
 *  un nombre parecido a ése: la regla corrige la ortografía, no inventa el nombre. */
const AGIL_NOMBRE = 'FAKE';
const AGIL_APELLIDOS_BIEN = 'EMPLOYEE NAME';
const AGIL_APELLIDOS_MAL = 'EMPLOYEE NAMES';   // una letra de más, dentro del umbral de 3

type Resp = { status: number; json: any };

async function http(method: string, path: string, body?: unknown, scenario?: string): Promise<Resp> {
    const r = await fetch(`${API}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': UA,
            ...(scenario ? { 'x-fake-scenario': scenario } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 160) } };
    const text = await r.text();
    try { return { status: r.status, json: JSON.parse(text) }; }
    catch { return { status: r.status, json: { raw: text.slice(0, 200) } }; }
}

function unico(): { phone: string; doc: string; email: string } {
    const n = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    return {
        phone: `31${n.toString().padStart(8, '0')}`.slice(0, 10),
        // El FE y el backend exigen 10000 < doc < 3_000_000_000.
        doc: (Math.floor(Math.random() * 2_800_000_000) + 100_000_000).toString(),
        // El dominio pasa por `checkdnsrr(..., 'MX')` DE VERDAD: un `@example.com` es rechazado.
        email: `kyc.apellido.${n}@gmail.com`,
    };
}

/** register + otp-validate → devuelve el uReq recién creado (el OTP va por el driver fake). */
async function sembrar(phone: string): Promise<number | null> {
    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: phone, phoneNumber: phone, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: PARTNER, partnerBranchHash: PARTNER,
    });
    if (reg.status >= 400) {
        console.log(`    ✘ register HTTP ${reg.status}: ${JSON.stringify(reg.json).slice(0, 200)}`);
        return null;
    }
    const otp = await http('POST', `/api/onboarding/loan-application/otp-validate/${PARTNER}`, {
        cell_phone: phone, otp_code: '1234', original_amount: 1_500_000, amount: 1_500_000,
    });
    // ⚠ El camino NORMAL de un usuario nuevo responde `success:false` + `error_code: ONB002`
    // («temporal user found»), que NO es un fallo: es «andá a /personal-info» — y ahí el id viene
    // anidado en `errors.payload`, no en `payload`. Es el mismo detalle que anota
    // `pkg/composer.ts:100` y el que hace que el HttpClient del FE se coma el payload.
    const id = otp.json?.payload?.user_request_id
        ?? otp.json?.errors?.payload?.user_request_id
        ?? otp.json?.data?.user_request_id;
    if (typeof id !== 'number') {
        console.log(`    ✘ otp-validate HTTP ${otp.status}: ${JSON.stringify(otp.json).slice(0, 200)}`);
        return null;
    }
    return id;
}

type Desenlace = { aceptado: boolean; status: number; subcode: string; mensaje: string; guardado: string };

async function correr(scenario: string, nombre = NOMBRE, apellidos = APELLIDOS): Promise<Desenlace | null> {
    const { phone, doc, email } = unico();
    const ureq = await sembrar(phone);
    if (ureq === null) return null;

    const r = await http('POST', `/api/onboarding/loan-application/personal-info/${PARTNER}/${ureq}`, {
        document_type: 'CC', document_number: doc,
        name: nombre, surname: apellidos, email,
        expedition_day: 27, expedition_month: 3, expedition_year: 2013,
        // ⚠ La fecha de NACIMIENTO figura `nullable|sometimes` en `PersonalInfoRequest`, pero el
        // servicio la valida aparte y sin ella responde ONB005 / `BIRTH_DATE_INVALID`. Son las
        // fechas reales del caso (nacimiento 1995-03-22, expedición 2013-03-27).
        birth_day: 22, birth_month: 3, birth_year: 1995,
        original_amount: 1_500_000, amount: 1_500_000,
    }, scenario);

    // `KYC_DEBUG=1` vuelca el cuerpo entero: el mensaje de arriba es genérico
    // («personal info validation failed») y la causa real viaja en `errors`/`payload`.
    if (process.env.KYC_DEBUG) {
        console.log(`    [debug ${scenario}] ${JSON.stringify(r.json).slice(0, 700)}`);
    }

    const fila = await one<{ first_name: string; surname: string }>(
        'SELECT first_name, surname FROM users WHERE document_number=? LIMIT 1', [doc],
    ).catch(() => null);

    // ⚠ `success:false` NO significa rechazo: el backend lo usa también para señalar el paso
    // siguiente. `ONB004` = «datos guardados, ahora hace falta la info laboral» y es un ÉXITO
    // (la fila queda escrita en `users`). El rechazo real es `ONB005`. Leerlo por `success`
    // pelado daba «regresión» donde había un guardado correcto.
    const code = r.json?.errors?.error_code ?? r.json?.error_code ?? r.json?.data?.error_code ?? null;
    const aceptado = r.status < 400 && code !== 'ONB005';

    return {
        aceptado,
        status: r.status,
        subcode: `${code ?? '—'}${r.json?.errors?.error_subcode ? ' / ' + r.json.errors.error_subcode : ''}`,
        // El mensaje POR CAMPO es lo que ve el cliente; el `message` de arriba es genérico.
        mensaje: r.json?.errors?.payload?.surname ?? r.json?.errors?.payload?.name ?? r.json?.message ?? '—',
        guardado: fila ? `${fila.first_name} / ${fila.surname}` : '(no quedó fila en users)',
    };
}

function imprimir(titulo: string, esperado: string, d: Desenlace | null): void {
    console.log(`\n  ${titulo}`);
    console.log(`    esperado    ${esperado}`);
    if (!d) { console.log('    ✘ no se pudo sembrar la solicitud'); return; }
    console.log(`    HTTP        ${d.status}${d.aceptado ? '  → ACEPTADO' : '  → RECHAZADO'}`);
    console.log(`    subcode     ${d.subcode}`);
    console.log(`    mensaje     ${String(d.mensaje).slice(0, 90)}`);
    console.log(`    en users    ${d.guardado}`);
}

console.log('\n  ── ¿se acepta un segundo apellido que la central reporta como incorrecto? ──');
console.log(`     target local · API ${API} · comercio ${PARTNER}`);
console.log(`     nombre de prueba: «${NOMBRE} ${APELLIDOS}» (el segundo apellido es el que la central rechaza)`);

const malo = await correr('second-surname-mismatch');
imprimir('escenario  second-surname-mismatch', 'RECHAZADO, con el error en el campo apellido', malo);

const bueno = await correr('single-name-and-surname');
imprimir('escenario  single-name-and-surname', 'ACEPTADO (no tener segundo apellido es legítimo)', bueno);

// La regla de adopción: con el escenario `success` Ágil Data resuelve y devuelve su nombre, así que lo
// que quede en `users` tiene que ser el de la CENTRAL y no el que se tecleó. Se prueba acá y no sólo en
// un test porque es el único lugar donde se ve el recorrido entero: la cascada elige la central, el
// servicio decide, y `OnboardingService` escribe.
//
// ⚠ El bypass de `verifyCoincidence` en local NO estorba: la adopción decide por `NameSimilarity`, que
// no pasa por ahí. Por eso este chequeo sí discrimina en local.
const adopcion = await correr('success', AGIL_NOMBRE, AGIL_APELLIDOS_MAL);
imprimir(
    'regla de adopción (Ágil Data resuelve)',
    `ACEPTADO y guardado como «${AGIL_NOMBRE} / ${AGIL_APELLIDOS_BIEN}», corrigiendo lo tecleado`,
    adopcion,
);

await close();

const adopto = adopcion?.guardado === `${AGIL_NOMBRE} / ${AGIL_APELLIDOS_BIEN}`;

if (!malo || !bueno || !adopcion) {
    console.log('\n  ⇒ NO CONCLUYENTE: no se pudo completar el recorrido.\n');
    process.exit(2);
}

if (malo.aceptado) {
    console.log('\n  ⇒ EL DEFECTO ESTÁ VIVO: la central dijo que el segundo apellido no coincide');
    console.log(`     y la solicitud avanzó igual, guardando «${malo.guardado}».`);
    console.log('     Arreglo: `=== null` en Modules/Identity/App/Services/TusDatosService.php:189.\n');
    process.exit(1);
}

if (!bueno.aceptado) {
    console.log('\n  ⇒ REGRESIÓN: se rechaza al cliente que legítimamente NO tiene segundo apellido.');
    console.log('     La tolerancia sólo debe aplicar al campo AUSENTE (null), no a un 0.\n');
    process.exit(1);
}

if (!adopto) {
    console.log('\n  ⇒ LA ADOPCIÓN NO ESTÁ ACTUANDO: quedó guardado «' + adopcion.guardado + '»');
    console.log(`     y se esperaba «${AGIL_NOMBRE} / ${AGIL_APELLIDOS_BIEN}» (el nombre de la central).`);
    console.log('     El nombre de la central debe ganar sobre el tecleado.\n');
    process.exit(1);
}

console.log('\n  ⇒ CORRECTO: rechaza el apellido que no coincide, acepta al de un solo apellido,');
console.log('     y adopta la ortografía de la central por encima de la del asesor.\n');
process.exit(0);

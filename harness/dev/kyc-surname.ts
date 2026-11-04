// kyc-apellido — ¿el flujo ACEPTA un segundo apellido que la central reporta como INCORRECTO?
//
//   node dev/kyc-surname.ts
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
// LAS CENTRALES SE DICTAN AL SIMULADOR (F-139). Hasta el 2026-11-03 este script pedía cada veredicto con el
// encabezado `X-Fake-Scenario` a los drivers «fake» del backend; el backend local ya consulta el simulador de
// centrales (`*_MOCK_HOST`), así que el encabezado no hacía nada y los tres casos corrían con la misma respuesta.
// Ahora cada caso dicta lo suyo para SU cédula y comprueba en el log que contestó el simulador y no la respuesta
// fija de respaldo del backend: sin esa marca, el veredicto no prueba nada.
//
// Requisitos (los dice si faltan):
//   · backend local arriba, con el simulador de centrales (`mock-bureaus`, :8105)
//   · Loki local (`make harness-obs-up`): el origen de cada respuesta se lee del log
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
const { createCustomer } = await import('../pkg/http.ts');
const { dictate, agildataAnswer, dictateBureauMode } = await import('../pkg/risk-lambda.ts');
const { bureauSources, bureauSourceProblem } = await import('../pkg/loki.ts');

const API = config.mockUrl;
// Un comercio estándar, sin Experian forzado: Quanto pisaría el nombre y la cascada de identidad no se vería sola.
const PARTNER = process.env.E2E_KYC_STANDARD_HASH || '802df3ce';   // Tu Colchón (112) en la base local
void config.partnerHash;
// UA de iPhone SIEMPRE: `onlyMobileValidation` responde 403 a un UA de escritorio.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

/** Los nombres del caso real: UN nombre de pila y DOS apellidos, el segundo mal escrito. */
const NAME = 'ANDREA';
const SURNAMES = 'MUSUSU NEMPEGIE';

/** La adopción, con el caso real: Ágil Data conoce a la persona como «ANDREA MUSUSU NEMPEQUE» y se teclea con una
 *  letra cambiada. La regla corrige la ortografía, no inventa el nombre: lo tecleado tiene que parecerse. */
const AGIL_NAME = 'ANDREA';
const AGIL_SURNAMES_OK = 'MUSUSU NEMPEQUE';
const AGIL_SURNAMES_BAD = 'MUSUSU NEMPEGIE';   // dos letras de diferencia, dentro del umbral de 3

type Resp = { status: number; json: any };

// El cliente vive en `pkg/http.ts`.
const customer = createCustomer({ base: API, headers: { 'user-agent': UA }, timeoutMs: 60_000, recorte: 200 });
const http = (method: string, path: string, body?: unknown): Promise<Resp> => customer.llamar(method, path, body, {});

/** Lo que contesta TusDatos para cada caso: las formas de `TusdatosHttpFake` del backend. Primer nombre, primer
 *  apellido y fecha van SIEMPRE: un `match_code` ausente en ellos se lee como «no coincide». */
const TUSDATOS = {
    'second-surname-mismatch': { status: 'success', data: { findings: {
        first_name: { match_code: 1 }, first_surname: { match_code: 1 }, second_surname: { match_code: 0 },
        issue_date: { match_code: 1 } } } },
    'single-name-and-surname': { status: 'success', data: { findings: {
        first_name: { match_code: 1 }, first_surname: { match_code: 1 }, issue_date: { match_code: 1 } } } },
};
type Scenario = keyof typeof TUSDATOS | 'agildata-resolves';

/** Dicta las centrales de identidad para la cédula y dice cuál tiene que contestar. Con TusDatos, Ágil Data y
 *  Mareigua van «sin información» para que la cascada llegue hasta ella. */
async function dictateScenario(doc: string, scenario: Scenario): Promise<'agildata' | 'tusdatos' | null> {
    if (scenario === 'agildata-resolves') {
        const ok = await dictate(doc, 'agildata', agildataAnswer(doc, 2_500_000, 'Empleado', 13, `${AGIL_NAME} ${AGIL_SURNAMES_OK}`));
        return ok ? 'agildata' : null;
    }
    const ok = (await dictateBureauMode(doc, 'agildata', 'empty')).ok
        && (await dictateBureauMode(doc, 'mareigua', 'empty')).ok
        && await dictate(doc, 'tusdatos', TUSDATOS[scenario]);
    return ok ? 'tusdatos' : null;
}

function unique(): { phone: string; doc: string; email: string } {
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
async function seed(phone: string): Promise<number | null> {
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

type Outcome = { aceptado: boolean; status: number; subcode: string; mensaje: string; guardado: string; origen: string | null };

async function correr(scenario: Scenario, name = NAME, surnames = SURNAMES): Promise<Outcome | null> {
    const { phone, doc, email } = unique();
    const central = await dictateScenario(doc, scenario);
    if (!central) { console.log(`    ✘ el simulador de centrales no tomó el dictado de «${scenario}»`); return null; }
    const ureq = await seed(phone);
    if (ureq === null) return null;

    const from = Date.now();
    const r = await http('POST', `/api/onboarding/loan-application/personal-info/${PARTNER}/${ureq}`, {
        document_type: 'CC', document_number: doc,
        name: name, surname: surnames, email,
        expedition_day: 27, expedition_month: 3, expedition_year: 2013,
        // ⚠ La fecha de NACIMIENTO figura `nullable|sometimes` en `PersonalInfoRequest`, pero el
        // servicio la valida aparte y sin ella responde ONB005 / `BIRTH_DATE_INVALID`. Son las
        // fechas reales del caso (nacimiento 1995-03-22, expedición 2013-03-27).
        birth_day: 22, birth_month: 3, birth_year: 1995,
        original_amount: 1_500_000, amount: 1_500_000,
    });

    // `KYC_DEBUG=1` vuelca el cuerpo entero: el mensaje de arriba es genérico
    // («personal info validation failed») y la causa real viaja en `errors`/`payload`.
    if (process.env.KYC_DEBUG) {
        console.log(`    [debug ${scenario}] ${JSON.stringify(r.json).slice(0, 700)}`);
    }

    const row = await one<{ first_name: string; surname: string }>(
        'SELECT first_name, surname FROM users WHERE document_number=? LIMIT 1', [doc],
    ).catch(() => null);

    // ⚠ `success:false` NO significa rechazo: el backend lo usa también para señalar el paso
    // siguiente. `ONB004` = «datos guardados, ahora hace falta la info laboral» y es un ÉXITO
    // (la fila queda escrita en `users`). El rechazo real es `ONB005`. Leerlo por `success`
    // pelado daba «regresión» donde había un guardado correcto.
    const code = r.json?.errors?.error_code ?? r.json?.error_code ?? r.json?.data?.error_code ?? null;
    const accepted = r.status < 400 && code !== 'ONB005';

    // De dónde salió la respuesta de identidad: si cayó al respaldo del backend, el caso no se ejercitó.
    await new Promise((res) => setTimeout(res, 4_000));
    let origen: string | null;
    try {
        origen = bureauSourceProblem(await bureauSources(from - 1_000, Date.now() + 1_000), [central]);
    } catch (e) {
        origen = `no se pudo leer el log: ${(e as Error).message}`;
    }

    return {
        origen,
        aceptado: accepted,
        status: r.status,
        subcode: `${code ?? '—'}${r.json?.errors?.error_subcode ? ' / ' + r.json.errors.error_subcode : ''}`,
        // El mensaje POR CAMPO es lo que ve el cliente; el `message` de arriba es genérico.
        mensaje: r.json?.errors?.payload?.surname ?? r.json?.errors?.payload?.name ?? r.json?.message ?? '—',
        guardado: row ? `${row.first_name} / ${row.surname}` : '(no quedó fila en users)',
    };
}

function print(title: string, expected: string, d: Outcome | null): void {
    console.log(`\n  ${title}`);
    console.log(`    esperado    ${expected}`);
    if (!d) { console.log('    ✘ no se pudo preparar el caso'); return; }
    console.log(`    contestó    ${d.origen ? '✘ ' + d.origen : 'el simulador ✓'}`);
    console.log(`    HTTP        ${d.status}${d.aceptado ? '  → ACEPTADO' : '  → RECHAZADO'}`);
    console.log(`    subcode     ${d.subcode}`);
    console.log(`    mensaje     ${String(d.mensaje).slice(0, 90)}`);
    console.log(`    en users    ${d.guardado}`);
}

console.log('\n  ── ¿se acepta un segundo apellido que la central reporta como incorrecto? ──');
console.log(`     target local · API ${API} · comercio ${PARTNER}`);
console.log(`     nombre de prueba: «${NAME} ${SURNAMES}» (el segundo apellido es el que la central rechaza)`);

const badOne = await correr('second-surname-mismatch');
print('TusDatos: el segundo apellido no coincide', 'RECHAZADO, con el error en el campo apellido', badOne);

const good = await correr('single-name-and-surname');
print('TusDatos: un nombre y un apellido, todo coincide', 'ACEPTADO (no tener segundo apellido es legítimo)', good);

// La regla de adopción: Ágil Data resuelve y devuelve su nombre, así que lo
// que quede en `users` tiene que ser el de la CENTRAL y no el que se tecleó. Se prueba acá y no sólo en
// un test porque es el único lugar donde se ve el recorrido entero: la cascada elige la central, el
// servicio decide, y `OnboardingService` escribe.
//
// ⚠ El bypass de `verifyCoincidence` en local NO estorba: la adopción decide por `NameSimilarity`, que
// no pasa por ahí. Por eso este chequeo sí discrimina en local.
const adoption = await correr('agildata-resolves', AGIL_NAME, AGIL_SURNAMES_BAD);
print(
    'regla de adopción (Ágil Data resuelve)',
    `ACEPTADO y guardado como «${AGIL_NAME} / ${AGIL_SURNAMES_OK}», corrigiendo lo tecleado`,
    adoption,
);

await close();

const adopted = adoption?.guardado === `${AGIL_NAME} / ${AGIL_SURNAMES_OK}`;

if (!badOne || !good || !adoption) {
    console.log('\n  ⇒ NO CONCLUYENTE: no se pudo completar el recorrido.\n');
    process.exit(2);
}

const notExercised = [badOne, good, adoption].filter((d) => d.origen);
if (notExercised.length) {
    console.log('\n  ⇒ NO CONCLUYENTE: alguna central no contestó desde el simulador, así que ese caso no se probó.');
    for (const d of notExercised) console.log(`     ${d.origen}`);
    console.log('');
    process.exit(2);
}

if (badOne.aceptado) {
    console.log('\n  ⇒ EL DEFECTO ESTÁ VIVO: la central dijo que el segundo apellido no coincide');
    console.log(`     y la solicitud avanzó igual, guardando «${badOne.guardado}».`);
    console.log('     Arreglo: `=== null` en Modules/Identity/App/Services/TusDatosService.php:189.\n');
    process.exit(1);
}

if (!good.aceptado) {
    console.log('\n  ⇒ REGRESIÓN: se rechaza al cliente que legítimamente NO tiene segundo apellido.');
    console.log('     La tolerancia sólo debe aplicar al campo AUSENTE (null), no a un 0.\n');
    process.exit(1);
}

if (!adopted) {
    console.log('\n  ⇒ LA ADOPCIÓN NO ESTÁ ACTUANDO: quedó guardado «' + adoption.guardado + '»');
    console.log(`     y se esperaba «${AGIL_NAME} / ${AGIL_SURNAMES_OK}» (el nombre de la central).`);
    console.log('     El nombre de la central debe ganar sobre el tecleado.\n');
    process.exit(1);
}

console.log('\n  ⇒ CORRECTO: rechaza el apellido que no coincide, acepta al de un solo apellido,');
console.log('     y adopta la ortografía de la central por encima de la del asesor.\n');
process.exit(0);

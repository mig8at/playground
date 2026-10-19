// dev/prod-run.ts — una solicitud en PRODUCCIÓN por el camino PÚBLICO de la app, hasta la validación de identidad.
//
//   E2E_TARGET=prod node dev/prod-run.ts [--apply]
//   E2E_TARGET=prod node dev/prod-run.ts --doc <cédula> --phone <celular> --name "MIGUEL" --surname "OCHOA" \
//       --birth 1995-05-10 --expedition 2013-05-10 --email <correo> [--branch 1a675cc3] [--apply]
//
// Lo que no se pasa sale de `harness/.env.prod` (fuera de git): PROD_RUN_DOC, PROD_RUN_PHONE, PROD_RUN_NAME, PROD_RUN_SURNAME,
// PROD_RUN_BIRTH, PROD_RUN_EXPEDITION y PROD_RUN_EMAIL. Son datos de una persona: no van al repo.
//
// PARA QUÉ: ver qué guarda prod de verdad (centrales consultadas, nombre adoptado o completado) sin esperar a que pase con
// un cliente real. Es lo mismo que hace una persona en el wizard: registrar el celular, validar el OTP que le llega por SMS y
// mandar sus datos personales. Nada más.
//
// LO QUE NO HACE, a propósito:
//   · no escribe en la base (no importa `pkg/db.ts`): ni siembra, ni bypass de OTP, ni scrub, ni dictado de centrales;
//   · no sigue al listado de entidades: ahí los datos salen a terceros (las entidades de pre-aprobación);
//   · no corre si la cédula no está en PROD_ALLOWED_DOCS (harness/.env.prod, fuera de git): sólo personas que aceptaron;
//   · no corre si la sucursal tiene entidades o si consulta Experian (lo pregunta al conector, sólo lectura);
//   · no corre si la cédula ya tiene un cliente ACTIVO en prod: el registro lo reusaría y no consultaría nada. La baja en
//     prod es a mano en el admin (Usuarios → papelera), no desde acá.
// Sin --apply sólo hace esas comprobaciones y muestra el plan. El OTP llega por SMS real y se tipea: lo corre una persona.
//
// LO QUE SÍ CREA en prod, y queda: el usuario, la solicitud y su historial, y las consultas a las centrales (que se cobran).
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientState, requestTimeline, experianCheck } from '../pkg/backend-reads.ts';

const API = process.env.PROD_API_URL || 'http://legacy-backend.inertia-production';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

/** Lo de `harness/.env.prod` (gitignoreado): la lista de cédulas permitidas no vive en el repo. */
function envProd(key: string): string {
    if (process.env[key]) return process.env[key]!;
    try {
        const line = readFileSync(join(import.meta.dirname, '..', '.env.prod'), 'utf8').split('\n').find((l) => l.startsWith(key + '='));
        return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
    } catch { return ''; }
}

function fail(msg: string): never { console.error('  ✗ ' + msg); process.exit(1); }
const ymd = (s: string | undefined, what: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
    if (!m) fail(`--${what} va como AAAA-MM-DD`);
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
        body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
}

if ((process.env.E2E_TARGET ?? '').toLowerCase() !== 'prod') fail('exportá E2E_TARGET=prod explícito: esto crea una solicitud real en producción');

const pick = (flagName: string, key: string) => arg(flagName) ?? envProd(key);
const doc = pick('--doc', 'PROD_RUN_DOC');
const phone = pick('--phone', 'PROD_RUN_PHONE').replace(/^\+?57/, '');
const name = pick('--name', 'PROD_RUN_NAME').toUpperCase().trim();
const surname = pick('--surname', 'PROD_RUN_SURNAME').toUpperCase().trim();
const email = pick('--email', 'PROD_RUN_EMAIL');
const branch = (arg('--branch') ?? '1a675cc3').toLowerCase();
if (!/^\d{5,15}$/.test(doc)) fail('--doc va sólo con dígitos');
if (!/^3\d{9}$/.test(phone)) fail('--phone: un celular colombiano de 10 dígitos (el tuyo: ahí llega el SMS)');
if (!name || !surname) fail('--name y --surname son obligatorios (los que escribiría el asesor)');
if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail('--email es obligatorio');
const birth = ymd(pick('--birth', 'PROD_RUN_BIRTH'), 'birth');
const expedition = ymd(pick('--expedition', 'PROD_RUN_EXPEDITION'), 'expedition');

// ── Las comprobaciones, todas de lectura ─────────────────────────────────────────────────────────
const allowed = envProd('PROD_ALLOWED_DOCS').split(',').map((s) => s.trim()).filter(Boolean);
if (!allowed.includes(doc)) fail(`la cédula ${doc} no está en PROD_ALLOWED_DOCS (harness/.env.prod): sólo personas que aceptaron que se use la suya`);

const ex = experianCheck('prod', branch);
const b = ex.branch as Record<string, unknown>;
if (ex.lenders.length > 0) fail(`la sucursal ${branch} («${b.name}») tiene ${ex.lenders.length} entidades: tus datos podrían salir a terceros. Usá una sucursal de prueba sin entidades`);
if (ex.verdict !== 'NO' && ex.verdict !== 'NUNCA') fail(`la sucursal ${branch} consulta Experian (${ex.verdict}: ${ex.why})`);

// El backend de prod sólo se alcanza con la VPN de prod: las lecturas de arriba van por Redash y pasan sin ella, así que sin
// esta comprobación la vista previa decía «todo bien» y la corrida moría en el primer paso (`ENOTFOUND`, 2026-10-19).
const reachable = await fetch(API + '/api/onboarding/phone/register', { method: 'OPTIONS', signal: AbortSignal.timeout(8_000) })
    .then(() => true).catch(() => false);
if (!reachable) fail(`el backend de prod (${API}) no responde: prendé la VPN de PROD (con la de dev sola no resuelve) y volvé a correr`);

const st = clientState('prod', doc);
if (st.active) fail(`la cédula ${doc} ya tiene un cliente ACTIVO en prod (id ${(st.active as Record<string, unknown>).id}): el registro lo reusaría y no consultaría las centrales. Dalo de baja a mano en el admin de prod (Usuarios → papelera) y volvé a correr`);

console.log(`  PRODUCCIÓN · ${API}
  sucursal  ${b.id} «${b.name}» (${branch}) · comercio ${b.allied_id} «${b.allied}» · sin entidades · Experian ${ex.verdict}
  persona   cédula ${doc} · ${name} / ${surname} · celular …${phone.slice(-4)}
  pasos     registrar celular → OTP por SMS (lo tipeás) → datos personales → leer lo que guardó prod. NO sigue al listado.
  crea      usuario, solicitud e historial en prod, y consultas reales a las centrales`);
if (!apply) { console.log('\n  (vista previa: las comprobaciones pasaron; repetí con --apply para hacerlo)'); process.exit(0); }

// ── El camino público ────────────────────────────────────────────────────────────────────────────
const reg = await post('/api/onboarding/phone/register', { phone_number: phone, phoneNumber: phone, terms: true, policies: true,
    otp_length: 4, otpLength: 4, partner_branch_hash: branch, partnerBranchHash: branch });
if (!reg.json?.data?.user?.id) fail(`registrar el celular devolvió HTTP ${reg.status}: ${JSON.stringify(reg.json).slice(0, 200)}`);
console.log('\n  ✓ celular registrado: te llega un SMS con el código');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('  código del SMS: ')).trim();
rl.close();
if (!/^\d{4,6}$/.test(code)) fail('el código son dígitos');

const otp = await post(`/api/onboarding/loan-application/otp-validate/${branch}`, { cell_phone: phone, otp_code: code, original_amount: 2_000_000, amount: 2_000_000 });
const ur = otp.json?.errors?.payload?.user_request_id ?? otp.json?.data?.payload?.user_request_id ?? otp.json?.payload?.user_request_id;
if (!ur) fail(`validar el OTP devolvió HTTP ${otp.status} sin solicitud: ${JSON.stringify(otp.json).slice(0, 200)}`);
console.log(`  ✓ OTP validado · solicitud ${ur}`);

const pi = await post(`/api/onboarding/loan-application/personal-info/${branch}/${ur}`, {
    document_type: 'CC', document_number: doc, name, surname, email,
    expedition_day: expedition.day, expedition_month: expedition.month, expedition_year: expedition.year,
    birth_day: birth.day, birth_month: birth.month, birth_year: birth.year, stratum: 3 });
const code2 = pi.json?.errors?.error_code ?? pi.json?.error_code;
console.log(`  ${pi.json?.success === true || code2 === 'ONB004' ? '✓' : '✗'} datos personales: HTTP ${pi.status}${code2 ? ` · ${code2}${code2 === 'ONB004' ? ' (pide datos laborales: la identidad ya pasó)' : ''}` : ''}`);

// ── Lo que quedó, leído (sólo lectura) ───────────────────────────────────────────────────────────
const after = clientState('prod', doc);
const tl = requestTimeline('prod', Number(ur));
const a = after.active as Record<string, unknown> | undefined;
console.log(`\n  quedó en prod: ${a ? `cliente ${a.id} · ${a.first_name} / ${a.surname}` : 'sin cliente activo'} · solicitud ${ur} en estado ${(tl.request as Record<string, unknown>).user_request_status_id}`);
for (const c of after.centrals ?? []) console.log(`    central   ${c.central} · ${c.updated_at}${c.agildata_code ? ` · codRespuesta ${c.agildata_code}` : ''}`);
for (const n of after.nameChecks ?? []) console.log(`    nombre    ${n.central} · ${n.reason}`);
console.log(`\n  para repetir: dar de baja al cliente en el admin de prod y volver a correr`);

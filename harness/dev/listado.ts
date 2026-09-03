// listado.ts — DE UN COMERCIO AL LISTADO DE ENTIDADES, por API y sin navegador.
//
//   node dev/listado.ts [--branch e9409aff] [--amount 2000000] [--income 2500000] [--score 700] [--v2]
//   node dev/listado.ts --comercio pullman
//
// LA PREGUNTA QUE CONTESTA, y que ninguna otra herramienta contesta hoy: de las entidades que un
// comercio TIENE CABLEADAS, ¿cuáles le aparecen de verdad a un cliente — y **por qué no** las otras?
// `sweep.ts matrix` empieza DESPUÉS del listado (recibe la entidad como entrada); esto termina ahí, y
// el listado es la SALIDA.
//
// POR QUÉ IMPORTA EL DIFF Y NO LA LISTA. Una lista de las que salieron no dice nada: la pregunta de
// soporte siempre es «¿por qué este cliente no vio la entidad X?». Eso hoy se contesta leyendo
// `LenderRetrievalService.php`, y la respuesta depende de datos del cliente que en el código no se ven.
// Acá se corre de verdad y se compara contra el universo cableado.
//
// ⚠ LO QUE ESTE PROGRAMA **NO** HACE: adivinar la causa. Para cada entidad que no salió, chequea las
// condiciones que puede verificar en la BD y las reporta; si ninguna explica la ausencia, dice
// **«sin causa verificable»** en vez de inventar una. Una causa inventada se copia a un ticket.
//
// GOTCHAS que ya costaron tiempo en este repo y que acá aplican igual:
//   · `E2E_TARGET` por defecto es **dev** → se fuerza `local` salvo override explícito.
//   · UA de **iPhone** siempre: con UA de escritorio `onlyMobileValidation` responde 403.
//   · el teléfono de prueba se **scrubbea** antes de cada register.
//   · en `main`, sin `H2O_API_HOST` el listado da 500 — en el `.env` local apunta a un puerto cerrado
//     a propósito, que es lo que lo mantiene andando.

import { spawnSync } from 'node:child_process';
import { telefonoDeLaSucursal } from '../pkg/merchants.ts';

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { one, query, exec, close } = await import('../pkg/db.ts');
const { synthFill } = await import('../pkg/inject.ts');
const { config: e2eConfig } = await import('../pkg/config.ts');

const API = e2eConfig.mockUrl;
let PHONE = '3131010101';   // se ajusta al largo que declara el país del comercio (ver telefonoDeLaSucursal)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const ASESOR_SUB = process.env.E2E_ASESOR_SUB ?? '';
const HDRS: Record<string, string> = {
    'content-type': 'application/json', accept: 'application/json', 'user-agent': UA,
    ...(ASESOR_SUB ? { 'x-cognito-identity-id': ASESOR_SUB } : {}),
};

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

const AMOUNT = Number(arg('amount', '2000000'));
const INCOME = Number(arg('income', '2500000'));
const SCORE = Number(arg('score', '700'));
const V2 = flag('v2');

async function http(method: string, path: string, body?: unknown) {
    const r = await fetch(`${API}${path}`, {
        method, headers: HDRS, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 140) } };
    const text = await r.text();
    try { return { status: r.status, json: JSON.parse(text) }; }
    catch { return { status: r.status, json: { raw: text.slice(0, 200) } }; }
}

let paso = 0;
const ok = (t: string, d = '') => console.log(`  ${String(++paso).padStart(2)}. ✓ ${t}${d ? ` · ${d}` : ''}`);
const mal = (t: string, d = '') => console.log(`  ${String(++paso).padStart(2)}. ✗ ${t}${d ? ` · ${d}` : ''}`);

type Fila = { id: number; nombre: string; rt: number; lstatus: number; astatus: number };

async function main(): Promise<number> {
    console.log(`\n  DEL COMERCIO AL LISTADO · ${API} · target ${process.env.E2E_TARGET}\n`);

    // ── 0 · la sucursal ────────────────────────────────────────────────────────────────────────
    let hash = arg('branch');
    const comercio = arg('comercio');
    if (!hash) {
        // Se elige la sucursal con MÁS entidades cableadas: una sucursal con 1 sola no prueba una
        // cascada, y elegir «la primera» daría corridas que pasan sin haber ejercitado nada.
        const b = await one<{ hash: string; n: number; com: string }>(
            `SELECT b.hash, a.name AS com, COUNT(l.lender_id) AS n
               FROM allied_branches b JOIN allieds a ON a.id=b.allied_id
               LEFT JOIN lenders_by_allied_branches l ON l.allied_branch_id=b.id
              WHERE a.name LIKE ? GROUP BY b.hash, a.name ORDER BY n DESC LIMIT 1`,
            [`%${comercio || 'ullman'}%`]).catch(() => null);
        if (!b?.hash) { mal('no encontré una sucursal', comercio || 'pullman'); return 2; }
        hash = b.hash;
        ok('sucursal elegida', `${b.com} · hash ${hash} · ${b.n} entidades cableadas`);
    } else {
        ok('sucursal', `hash ${hash}`);
    }

    const br = await one<{ b: number; a: number; com: string }>(
        `SELECT b.id AS b, b.allied_id AS a, x.name AS com FROM allied_branches b
           JOIN allieds x ON x.id=b.allied_id WHERE b.hash=?`, [hash]).catch(() => null);
    if (!br) { mal('la sucursal no existe en esta BD', hash); return 2; }

    // ── 1 · el UNIVERSO: lo que el comercio tiene cableado ─────────────────────────────────────
    const universo = await query<Fila>(
        `SELECT l.lender_id AS id, e.name AS nombre, e.response_type AS rt,
                e.status AS lstatus, l.status AS astatus
           FROM lenders_by_allied_branches l JOIN lenders e ON e.id=l.lender_id
          WHERE l.allied_branch_id=? ORDER BY l.lender_id`, [br.b]);
    ok('universo cableado', `${universo.length} entidades en ${br.com}`);

    // ── 2 · sembrar la solicitud ───────────────────────────────────────────────────────────────
    /* El largo del móvil lo valida el país del COMERCIO, no el nuestro: contra el comercio de Perú un
       número colombiano se cae con un 422 antes de llegar al listado, que es lo que se venía a medir. */
    PHONE = await telefonoDeLaSucursal(hash, Number(PHONE));
    spawnSync('node', ['bin/dbops.ts', 'scrubphone', PHONE], { cwd: new URL('..', import.meta.url).pathname });
    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: PHONE, phoneNumber: PHONE, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: hash, partnerBranchHash: hash,
    });
    const uid = reg.json?.data?.user?.id;
    if (!uid) { mal('register', `HTTP ${reg.status} · ${JSON.stringify(reg.json).slice(0, 120)}`); return 1; }
    ok('register', `user ${uid}`);

    const asesor = (await one<{ id: number }>(
        'SELECT id FROM users WHERE allied_branch_id=? AND cognito_id IS NOT NULL LIMIT 1', [br.b])
        .catch(() => null))?.id ?? null;
    const ins = await exec(
        `INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount,
            original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number,
            fee_value, rate, created_at, updated_at)
         VALUES (?,?,?,NULL,?,?,1,?,1,0,0,0,NOW(),NOW())`,
        [uid, br.a, br.b, AMOUNT, AMOUNT, asesor]).catch((e) => { mal('INSERT uReq', String(e).slice(0, 120)); return null; });
    if (!ins?.insertId) return 1;
    const ur = ins.insertId;
    ok('solicitud creada', `uReq ${ur} · monto ${AMOUNT.toLocaleString('es-CO')}`);

    await synthFill(ur, { income: INCOME, score: SCORE });
    ok('datos de riesgo sintéticos', `ingreso ${INCOME.toLocaleString('es-CO')} · score ${SCORE}`);

    // ── 3 · EL LISTADO ─────────────────────────────────────────────────────────────────────────
    const ruta = V2 ? 'lenders-v2' : 'lenders';
    const res = await http('GET', `/api/onboarding/loan-application/${ruta}/${ur}`);
    if (res.status !== 200) {
        mal(`GET ${ruta}`, `HTTP ${res.status} · ${JSON.stringify(res.json).slice(0, 160)}`);
        return 1;
    }
    const crudo = res.json?.data ?? res.json;
    const lista: any[] = Array.isArray(crudo) ? crudo
        : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    ok(`GET ${ruta}`, `HTTP 200 · ${lista.length} entidades devueltas`);

    // ── 4 · EL DIFF, que es el punto ───────────────────────────────────────────────────────────
    //
    // ⚠ UNA CONDICIÓN QUE CUMPLEN TODAS NO EXPLICA NADA, y la primera versión de esto lo aprendió a
    // la mala: reportó «Meddipay no tiene ciudades de cobertura» como causa, y resultó que las SIETE
    // entidades tenían cero ciudades — seis salieron igual. La causa era cierta como dato y falsa
    // como explicación, y es justo el tipo de frase que se copia a un ticket.
    //
    // Por eso cada chequeo se evalúa sobre TODO el universo y sólo se reporta si **discrimina**: se
    // cumple en la que faltó y NO en las que salieron. Lo que no discrimina se calla.
    const salieron = new Set(lista.map((x) => Number(x.id ?? x.lender_id ?? x.lenderId)).filter(Boolean));
    const faltan = universo.filter((l) => !salieron.has(l.id));

    type Chequeo = { nombre: string; se_cumple: (l: Fila) => Promise<boolean> };
    const CHEQUEOS: Chequeo[] = [
        { nombre: 'la entidad está inactiva', se_cumple: async (l) => l.lstatus !== 1 },
        { nombre: 'la arista comercio-entidad está apagada', se_cumple: async (l) => l.astatus !== 1 },
        { nombre: 'no tiene ciudades de cobertura', se_cumple: async (l) =>
            ((await one<{ n: number }>('SELECT COUNT(*) AS n FROM cities_by_lender WHERE lender_id=?', [l.id])
                .catch(() => null))?.n ?? 0) === 0 },
        { nombre: 'no tiene reglas de datacrédito', se_cumple: async (l) =>
            ((await one<{ n: number }>('SELECT COUNT(*) AS n FROM lender_datacredito_rules WHERE lender_id=?', [l.id])
                .catch(() => null))?.n ?? 0) === 0 },
        { nombre: 'no tiene condiciones por monto', se_cumple: async (l) =>
            ((await one<{ n: number }>('SELECT COUNT(*) AS n FROM creditop_x_conditions_by_amount_by_lender WHERE lender_id=?', [l.id])
                .catch(() => null))?.n ?? 0) === 0 },
    ];

    const causas = new Map<number, string[]>();
    for (const ch of CHEQUEOS) {
        const cumple = new Map<number, boolean>();
        for (const l of universo) cumple.set(l.id, await ch.se_cumple(l));
        // discrimina sólo si NINGUNA de las que salió lo cumple
        const contamina = universo.some((l) => salieron.has(l.id) && cumple.get(l.id));
        if (contamina) continue;
        for (const l of faltan) if (cumple.get(l.id)) {
            causas.set(l.id, [...(causas.get(l.id) ?? []), ch.nombre]);
        }
    }

    console.log(`\n  EL LISTADO — ${salieron.size} de ${universo.length} cableadas\n`);
    for (const l of universo) {
        const vino = salieron.has(l.id);
        const c = causas.get(l.id) ?? [];
        console.log(`    ${vino ? '●' : '○'} ${String(l.id).padStart(4)}  `
            + `${l.nombre.padEnd(38).slice(0, 38)} rt=${l.rt}`
            + (vino ? '' : `   ${c.length ? c.join(' · ') : 'SIN CAUSA VERIFICABLE acá — hay que leer el servicio'}`));
    }
    console.log(`\n    ● salió en el listado   ○ no salió\n`);
    console.log(`  la solicitud queda viva: uReq ${ur}  ·  seguila con`);
    console.log(`      make trazador-ureq UREQ=${ur} TARGET=local\n`);
    return 0;
}

const code = await main().catch((e) => { console.error('\n  ✗', e); return 1; });
await close().catch(() => {});
process.exit(code);

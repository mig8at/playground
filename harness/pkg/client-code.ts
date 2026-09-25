// El código de preaprobado que el cliente trae de la app, generado como lo haría la app.
//
// Lo usan dos lados, y por eso vive acá y no en cada uno:
//   · `bin/client-code.ts`, que `bin/advisor` corre al lanzar para que el autorrelleno lo ponga en la
//     pantalla `/merchant/<hash>/codigo` y el panel lo muestre para copiar;
//   · `dev/codigo-qa.ts` (`make harness-codigo-qa`), que usa `requestServiceCode` para el lote de QA.
//
// Qué resuelve, SÓLO LEYENDO la base del target:
//   · el comercio: el `merchant_id` del servicio es el `allied_id` de la sucursal, no la sucursal —el
//     canje consulta con ése—; y sólo Colombia, porque fuera de ahí el wizard no ofrece la opción;
//   · la entidad: la pedida si está habilitada en ESA sucursal, o la primera habilitada;
//   · el cliente: un sintético («SYNTH PRUEBA», correo @creditop.com). En local, si no hay, el último
//     usuario con celular y correo: el canje verifica que exista y tenga los dos.
//
// Dónde se genera, según el target:
//   · local → se SIEMBRA en el mock de códigos (`make harness-codes`, :8111): el servicio real no existe
//     en local. El código se inventa con el formato vigente (`AA0000`);
//   · dev · qa · staging → se le PIDE al servicio de dev (self-manager-api), que es el que usan los tres
//     backends. Devuelve el código vigente si ya había uno activo para ese cliente, comercio y entidad,
//     así que relanzar no llena el servicio de códigos sueltos.
//
// ⚠ Quien importe esto fija `E2E_TARGET` ANTES: `pkg/db.ts` resuelve el target al cargarse (F-187).
import { existsSync, readFileSync } from 'node:fs';
import { query } from './db.ts';
import { COGNITO_STATE_PATH } from './cognito.ts';

export const CODE_SERVICE_URL = process.env.CODE_SERVICE_URL || 'http://self-manager-api.inertia-develop:8082';
export const MOCK_CODES_URL = process.env.MOCK_CODES_URL || 'http://127.0.0.1:8111';
const COLOMBIA = 47;
/** El formato vigente. Los de 4 dígitos siguen siendo válidos, pero son de antes del cambio. */
export const CURRENT_FORMAT = /^[A-Z]{2}\d{4}$/;

export interface ClientCode {
    code: string;
    expiredAt: string | null;
    alliedId: number;
    merchant: string;
    branchId: number;
    lenderId: number;
    lender: string;
    userId: number;
    /** Si la sesión de asesor está en otra sucursal que la pedida, por qué se generó para ésa. */
    branchNote?: string;
}

/** Un motivo para NO generar: se imprime y la corrida sigue sin código, nunca se cae por esto. */
export class ClientCodeSkip extends Error {}

/** Le pide un código al servicio real, como la app. Lanza `ClientCodeSkip` si no llega o rechaza. */
export async function requestServiceCode(userId: number, merchantId: number, lenderId: number): Promise<{ code: string; expired_at: string }> {
    let res: Response;
    try {
        res = await fetch(`${CODE_SERVICE_URL}/api/v1/generate/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': String(userId) },
            body: JSON.stringify({ merchant_id: merchantId, lender_id: lenderId }),
            signal: AbortSignal.timeout(15_000),
        });
    } catch (e: any) {
        throw new ClientCodeSkip(`no llegué al servicio de códigos (${CODE_SERVICE_URL}): ${e.cause?.code || e.message} — ¿VPN de desarrollo?`);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.code) throw new ClientCodeSkip(`el servicio de códigos respondió HTTP ${res.status}: ${JSON.stringify(body)}`);
    return body;
}

/**
 * La sucursal donde va a aterrizar el wizard: la del asesor DUEÑO DE LA SESIÓN guardada, no la del
 * asesor que dice la configuración. El wizard redirige a la sucursal de quien está logueado, y si el
 * código es de otra sucursal la entidad puede no estar habilitada ahí. Medido el 2026-09-24 en qa: la
 * sesión era de MIGUEL TEST (`ec977139`), el lanzador verificaba la asignación de OTRO asesor y el
 * código salió para `13874eb6`, con Meddipay, que en `ec977139` no está. El usuario sale de la cookie
 * `_session` del wizard (base64 con `user.id` = el sub de Cognito). Sin sesión o sin match: null.
 */
async function sessionBranchHash(): Promise<string | null> {
    try {
        if (!existsSync(COGNITO_STATE_PATH)) return null;
        const state = JSON.parse(readFileSync(COGNITO_STATE_PATH, 'utf8'));
        const cookie = (state.cookies ?? []).find((c: any) => c.name === '_session');
        if (!cookie) return null;
        const payload = JSON.parse(Buffer.from(decodeURIComponent(cookie.value).split('.')[0], 'base64').toString());
        const sub = payload?.user?.id;
        if (!sub) return null;
        const [row] = await query(
            `SELECT ab.hash FROM users u JOIN allied_branches ab ON ab.id = u.allied_branch_id
              WHERE u.cognito_id = ? LIMIT 1`, [sub]);
        return row?.hash ?? null;
    } catch { return null; }
}

function randomCode(): string {
    const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    return letter() + letter() + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

async function seedMock(code: string, userId: number, merchantId: number, lenderId: number): Promise<void> {
    let res: Response;
    try {
        res = await fetch(`${MOCK_CODES_URL}/_control/sembrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, user_id: userId, lender_id: lenderId, merchant_id: merchantId }),
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        throw new ClientCodeSkip(`el mock de códigos no responde en ${MOCK_CODES_URL} — levantalo con \`make harness-codes\``);
    }
    if (!res.ok) throw new ClientCodeSkip(`el mock de códigos rechazó la siembra (HTTP ${res.status})`);
}

/** `code` sólo vale en local, donde el código se siembra: si no se pasa, se inventa uno del formato vigente. */
export async function generateClientCode(opts: { target: string; hash: string; lenderId?: number; code?: string }): Promise<ClientCode> {
    let branchNote: string | undefined;
    const landing = await sessionBranchHash();
    if (landing && landing !== opts.hash) {
        branchNote = `la sesión de asesor está en ${landing}, no en ${opts.hash}: el wizard va a entrar ahí, así que el código es de esa sucursal`;
        opts = { ...opts, hash: landing };
    }
    const [branch] = await query(
        `SELECT ab.id, ab.allied_id, a.name AS merchant, a.country_id
           FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`, [opts.hash]);
    if (!branch) throw new ClientCodeSkip(`no hay sucursal con hash '${opts.hash}' en ${opts.target}`);
    if (Number(branch.country_id) !== COLOMBIA) throw new ClientCodeSkip(`${branch.merchant} no es de Colombia: ahí no se ofrece el código de la app`);

    const lenders = await query(
        `SELECT l.id, l.name, l.status FROM lenders_by_allied_branches lab JOIN lenders l ON l.id = lab.lender_id
          WHERE lab.allied_branch_id = ? AND lab.status = 1 ORDER BY l.id`, [branch.id]);
    if (!lenders.length) throw new ClientCodeSkip(`la sucursal ${branch.id} no tiene entidades habilitadas`);
    // Sin entidad pedida, la primera ENCENDIDA también a nivel global (`lenders.status`): habilitada en la
    // sucursal no alcanza, el listado filtra por las dos. La primera corrida desde el panel (qa, Pullman)
    // eligió Sistecrédito, apagado globalmente, y el código llevaba a un listado donde no podía salir.
    const lender = opts.lenderId ? lenders.find((l: any) => Number(l.id) === opts.lenderId)
                                 : lenders.find((l: any) => Number(l.status) === 1);
    if (!lender) throw new ClientCodeSkip(opts.lenderId ? `la entidad ${opts.lenderId} no está habilitada en la sucursal ${opts.hash}`
                                                        : `la sucursal ${opts.hash} no tiene entidades encendidas`);
    if (Number(lender.status) !== 1) throw new ClientCodeSkip(`la entidad ${lender.id} (${lender.name}) está apagada globalmente: no va a listar`);

    let customers = await query(
        `SELECT id FROM users WHERE full_name = 'SYNTH PRUEBA' AND email LIKE '%@creditop.com'
           AND cell_phone <> '' AND cognito_id IS NULL ORDER BY id DESC LIMIT 5`);
    if (!customers.length && opts.target === 'local')
        customers = await query(`SELECT id FROM users WHERE cell_phone <> '' AND email <> '' AND cognito_id IS NULL ORDER BY id DESC LIMIT 1`);
    if (!customers.length) throw new ClientCodeSkip(`no hay clientes de prueba en ${opts.target}`);

    const base = { alliedId: Number(branch.allied_id), merchant: branch.merchant, branchId: Number(branch.id),
                   lenderId: Number(lender.id), lender: lender.name, ...(branchNote ? { branchNote } : {}) };

    if (opts.target === 'local') {
        const code = opts.code || randomCode(), userId = Number(customers[0].id);
        await seedMock(code, userId, base.alliedId, base.lenderId);
        return { ...base, code, expiredAt: null, userId };
    }

    // Se prueba de a un cliente hasta dar con un código del formato vigente: uno de 4 dígitos es un
    // código viejo que sigue activo para esa combinación, y el servicio lo devolvería hasta fin de mes.
    let last: ClientCode | null = null;
    for (const c of customers) {
        const r = await requestServiceCode(Number(c.id), base.alliedId, base.lenderId);
        last = { ...base, code: r.code, expiredAt: r.expired_at, userId: Number(c.id) };
        if (CURRENT_FORMAT.test(r.code)) break;
    }
    return last!;
}

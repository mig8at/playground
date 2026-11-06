// auto-onboarding-link.ts — ¿un pedido por la API de payment-link con todos los datos SALTA el SMS y el formulario?
//
//   make harness-auto-onboarding TARGET=qa|local [BRANCH=<hash>] [AMOUNT=500000] [CASES=con,sin]
//
// Lo que haría una tienda (VTEX, Shopify) que manda el pedido completo: crea el pedido en `POST /api/ecommerce/payment-link`
// con el token de la sucursal, abre la URL que devuelve en un navegador (como teléfono) y mira por qué pantallas pasa.
//   · `con`: celular, documento, nombres, correo, fecha de expedición y de nacimiento, `termAccepted` y `policyAccepted`.
//     Con la sucursal en `auto_onboarding_allied_branches`, tiene que ir a «validando» y al listado SIN pedir celular,
//     código ni el formulario de datos, y sin que se genere ningún OTP para ese celular.
//   · `sin`: el mismo pedido sin las aceptaciones. Tiene que pedir el celular (el SMS de siempre): es la otra mitad de la
//     regla, y la que confirma que el salto lo decide el pedido y no la sucursal.
// Medido el 2026-11-06 con la copia de Mario Hernández en qa (sucursal 1126106a): `con` fue directo al listado.
//
// La identidad es nueva en cada caso y se le dicta a las centrales del ambiente (`bin/bureaus-profile.ts`) con el
// MISMO nombre que lleva el pedido: si no, la validación de identidad compara contra otra persona.
// El token sale de `PAYMENT_LINK_TOKEN` o de `COPY_<comercio>_PAYMENT_LINK_TOKEN` en harness/.env.<target>, la línea que
// deja `dev/copy-creditopx.ts` junto a `COPY_<comercio>_BRANCH_HASH`. Fotos de cada pantalla en .runs/auto-onboarding-…/.
// ESCRIBE: un pedido, un cliente y una solicitud en el ambiente, como una compra de verdad.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { env, TARGET } from '../pkg/env.ts';
import { IPHONE_UA } from '../pkg/windows.ts';

const arg = (n: string, d = '') => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
if (!process.env.E2E_TARGET || TARGET === 'prod') { console.error('✗ E2E_TARGET explícito (local, qa…) y nunca prod: este comando crea pedidos'); process.exit(2); }

/** Sin --branch, la sucursal de la última copia de comercio de ese ambiente (`COPY_<comercio>_BRANCH_HASH`): el hash
 *  cambia entre ambientes (la copia de Mario es 1126106a en qa y 69364350 en local). */
function defaultBranch(): string {
    try {
        const text = readFileSync(join(import.meta.dirname, '..', `.env.${TARGET}`), 'utf8');
        const all = [...text.matchAll(/^COPY_\d+_BRANCH_HASH=(\w+)$/gm)].map((m) => m[1]);
        if (all.length) return all[all.length - 1];
    } catch { /* sin archivo */ }
    throw new Error(`no sé qué sucursal usar en ${TARGET}: pasá BRANCH=<hash> o copiá un comercio con dev/copy-creditopx.ts`);
}
const BRANCH = arg('branch') || defaultBranch();
const AMOUNT = Number(arg('amount', '500000'));
const CASES = arg('cases', 'con,sin').split(',').map((s) => s.trim()).filter(Boolean) as Array<'con' | 'sin'>;
const API = env('E2E_API_BASE_URL').replace(/\/$/, '');
const FRONT = env('E2E_BASE_URL').replace(/\/$/, '');
const PG = join(import.meta.dirname, '..', '..', 'bin', 'pg');
const NAME = 'LAURA', SURNAME = 'AUTO PRUEBA';

/** El token de la sucursal: el de la variable, o el que dejó la copia del comercio para ese hash. */
function branchToken(): string {
    if (process.env.PAYMENT_LINK_TOKEN) return process.env.PAYMENT_LINK_TOKEN;
    let text = '';
    try { text = readFileSync(join(import.meta.dirname, '..', `.env.${TARGET}`), 'utf8'); } catch { /* sin archivo */ }
    const allied = text.match(new RegExp(`^COPY_(\\d+)_BRANCH_HASH=${BRANCH}$`, 'm'))?.[1];
    const token = allied ? text.match(new RegExp(`^COPY_${allied}_PAYMENT_LINK_TOKEN=(.+)$`, 'm'))?.[1] : undefined;
    if (!token) throw new Error(`no hay token de payment-link para la sucursal ${BRANCH} en harness/.env.${TARGET}: PAYMENT_LINK_TOKEN=… o copiá el comercio con dev/copy-creditopx.ts`);
    return token.trim();
}

function pg(args: string[]): string {
    return execFileSync(PG, args, { encoding: 'utf8', maxBuffer: 16 << 20 });
}

/** La lista de auto-onboarding tiene que tener la sucursal: si no, `con` no puede saltar nada y el resultado no dice nada. */
function branchInAutoOnboarding(): boolean {
    const out = pg(['sql', '--target', TARGET, '--json', '--query', "SELECT value FROM settings WHERE `key` = 'auto_onboarding_allied_branches'"]);
    const value = JSON.parse(out).rows?.[0]?.value ?? '{}';
    return (JSON.parse(value).hashes ?? []).includes(BRANCH);
}

function newIdentity(i: number) {
    const base = String(Date.now()).slice(-7);
    return { doc: `109${base}`.slice(0, 10), tel: `31${base}${i}`.slice(0, 10) };
}

type Outcome = { caso: string; ok: boolean; paths: string[]; ur: string | null; otp: boolean | null; notes: string[]; dir: string };

async function runCase(kind: 'con' | 'sin', i: number, token: string): Promise<Outcome> {
    const id = newIdentity(i);
    const dir = join(import.meta.dirname, '..', '.runs', `auto-onboarding-${TARGET}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}-${kind}`);
    mkdirSync(dir, { recursive: true });
    const o: Outcome = { caso: kind, ok: false, paths: [], ur: null, otp: null, notes: [], dir };

    // 1 · la identidad en las centrales del ambiente, con el nombre del pedido
    try {
        execFileSync(process.execPath, ['bin/bureaus-profile.ts', TARGET, id.doc, '--name', `${NAME} ${SURNAME}`, '--income', '3500000',
            '--occupation', 'Empleado', '--months', '24', '--score', '720'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', env: process.env });
    } catch (e: any) { o.notes.push(`no se pudo dictar la identidad: ${String(e.stdout ?? e.message).trim().split('\n').pop()}`); return o; }

    // 2 · el pedido, como lo mandaría la tienda
    const now = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
    const key = `auto-onb-${kind}-${Date.now()}`;
    const body: Record<string, unknown> = {
        hash: BRANCH, order_key: key, id: key, total: AMOUNT,
        billing: { email: `auto-${id.doc}@creditop.com`, phone: id.tel, first_name: NAME, last_name: SURNAME, document_type: 'CC',
            document_number: id.doc, document_expedition_date: '2010-01-01', birth_date: '1990-01-01' },
        products: [{ name: 'Producto de prueba', quantity: 1, price: AMOUNT }],
        return_url: 'https://example.com/volver', webhook_url: 'https://example.com/webhook',
    };
    if (kind === 'con') { body.termAccepted = now; body.policyAccepted = now; }
    const r = await fetch(`${API}/ecommerce/payment-link`, { method: 'POST', body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
    const json: any = await r.json().catch(() => ({}));
    if (!r.ok || !json.redirect_url) { o.notes.push(`payment-link dio ${r.status}: ${JSON.stringify(json).slice(0, 200)}`); return o; }
    // En local la API devuelve la URL del front configurado en el backend: se lleva al front del ambiente.
    const url = new URL(json.redirect_url);
    const start = `${FRONT}${url.pathname}${url.search}`;

    // 3 · el comprador abre el enlace en el teléfono, y se anota cada pantalla con su foto
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await (await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 420, height: 900 }, isMobile: true })).newPage();
        await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const until = Date.now() + 120_000;
        let last = '';
        while (Date.now() < until) {
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            const p = new URL(page.url());
            const path = p.pathname + (p.searchParams.get('step') ? `?step=${p.searchParams.get('step')}` : '');
            if (path !== last) {
                last = path;
                o.paths.push(path);
                await page.waitForTimeout(1_500);
                await page.screenshot({ path: join(dir, `${String(o.paths.length).padStart(2, '0')}-${path.split('/').filter(Boolean).pop()?.replace(/\W+/g, '-') || 'inicio'}.png`), fullPage: true }).catch(() => {});
            }
            // Se para donde la persona tendría que hacer algo: el celular, el código, el formulario o el listado.
            if (/\/lenders$|step=phoneNumber|\/otp$|personal-info/.test(path)) break;
            await page.waitForTimeout(1_000);
        }
        // La solicitud es el segmento que sigue a la sucursal (`/auto/<hash>/<solicitud>/validando`), salvo en la pantalla
        // del código, donde va el celular (`/auto/<hash>/<celular>/otp`). El hash puede ser sólo dígitos: no se busca «un
        // número largo» en la ruta, que lo confundía con la solicitud.
        o.ur = o.paths.map((p) => { const s = p.split('?')[0].split('/'); return s[4] && s[4] !== 'otp' && /^\d+$/.test(s[3] ?? '') ? s[3] : null; })
            .find(Boolean) ?? null;
    } finally {
        await browser.close();
    }

    // 4 · ¿se generó un OTP para ese celular?
    try { o.otp = !/ningún OTP/.test(pg(['otp', 'last', '--target', TARGET, '--phone', id.tel])); } catch { o.otp = null; }

    const askedPhone = o.paths.some((p) => /step=phoneNumber|\/otp$/.test(p));
    const askedForm = o.paths.some((p) => /personal-info/.test(p));
    const reachedList = o.paths.some((p) => /\/lenders$/.test(p));
    if (kind === 'con') {
        o.ok = !askedPhone && !askedForm && reachedList && o.otp === false;
        if (askedPhone) o.notes.push('pidió el celular: no saltó el SMS');
        if (askedForm) o.notes.push('pidió el formulario de datos');
        if (!reachedList) o.notes.push('no llegó al listado');
        if (o.otp) o.notes.push('se generó un OTP para ese celular');
    } else {
        o.ok = askedPhone;
        if (!askedPhone) o.notes.push('NO pidió el celular sin las aceptaciones: el salto no lo está decidiendo el pedido');
    }
    o.notes.push(`documento ${id.doc} · celular ${id.tel}`);
    return o;
}

try {
    const token = branchToken();
    const inList = branchInAutoOnboarding();
    console.log(`\n  AUTO-ONBOARDING por payment-link · ${TARGET} · sucursal ${BRANCH} ${inList ? '(en la lista de auto-onboarding)' : '⚠ NO está en auto_onboarding_allied_branches: «con» no puede saltar nada'} · $${AMOUNT}\n`);
    const results: Outcome[] = [];
    for (const [i, kind] of CASES.entries()) results.push(await runCase(kind, i, token));
    for (const o of results) {
        console.log(`  ${o.ok ? '✓' : '✗'} ${o.caso === 'con' ? 'con aceptaciones' : 'sin aceptaciones'} · uReq ${o.ur ?? '—'} · OTP ${o.otp === null ? '?' : o.otp ? 'sí' : 'no'}`);
        console.log(`      ${o.paths.join(' → ') || '(no abrió el wizard)'}`);
        for (const n of o.notes) console.log(`      ${n}`);
        console.log(`      fotos: harness/${o.dir.split('/harness/')[1]}`);
    }
    const ok = results.every((o) => o.ok);
    console.log(`\n  ${results.filter((o) => o.ok).length}/${results.length} bien`);
    process.exit(ok ? 0 : 1);
} catch (e) {
    console.error(`  ✗ ${(e as Error).message}`);
    process.exit(2);
}

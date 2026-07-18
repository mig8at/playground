import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { config, cognitoCreds } from '../pkg/config';
import { cognitoLogin, cognitoStorageState } from '../pkg/cognito';
import { synthFill, requestEstado11 } from '../pkg/inject';
import { closeCreditopX, resolveRequestStatus } from '../pkg/close';
import { one, exec } from '../pkg/db';
import { close } from '../pkg/db';
import { PREVIEW, IPHONE_UA, openA, openB } from '../pkg/windows';

/**
 * GUIADO (semiautomático) — el demo SIEMBRA cada pantalla por detrás y VOS das "Continuar" para avanzar,
 * así navegás el flujo pantalla por pantalla sin trabarte en captura de datos / KYC real.
 *
 *   monto      → (prellenado) vos das Continuar
 *   teléfono   → (prellenado, qa bypass) vos das Continuar
 *   OTP        → (prellenado, bypass) vos das Continuar
 *   personal-info → BYPASS invisible (synthFill: KYC + datacrédito forjado) → auto-avanza a /lenders
 *                   (esta pantalla NO puede ser click real: su submit dispara agildata/maregua/Experian)
 *   lenders    → VOS elegís el lender → el demo DETECTA (rt) y continúa en AUTO:
 *                  rt=2 CreditopX → handoff "continuá tu solicitud" (continue); A se queda, B (celular) completa
 *                  rt=0/1 modal (WhatsApp) → webhook → Estado 11 (sin retorno de browser)
 *                  rt=1 redirect → portal del banco → la ENTIDAD devuelve al COMERCIO (return_url)
 *
 * Lo orquesta `bin/asesor <m> auto` / `bin/ecommerce <m> auto`. Es INTERACTIVO (necesita tus clicks) → no CI.
 */

const HASH = process.env.E2E_ASESOR_HASH ?? config.partnerHash;
const PHONE = process.env.E2E_OTP_BYPASS_PHONE ?? '3131010101'; // qa_otp_bypass_phones → OTP = últimos 4
const OTP = PHONE.slice(-4);
const AMOUNT = process.env.E2E_AMOUNT ?? '600000';
const RESULT = process.env.E2E_RESULT ?? 'success';                    // cómo resuelve el crédito (auto): success | rejected | pending
const RESULT_STATUS: Record<string, number> = { success: 11, rejected: 6, pending: 10 }; // user_request_status_id (11=Autorizada, 6=Negada, 10=Pendiente)
const ENTRY = process.env.E2E_ENTRY ?? 'cognito';               // 'cognito' (asesor) | 'ecommerce' (checkout base64)
const CHECKOUT_URL = process.env.E2E_CHECKOUT_URL ?? '';
const STORE = process.env.E2E_STORE === '1';
const AUTH = join(process.cwd(), '.auth');
const MOCK_STORE = pathToFileURL(join(process.cwd(), 'mock-store', 'index.html')).href;
const MOCK_BANK = pathToFileURL(join(process.cwd(), 'mock-bank', 'index.html')).href;
// return_url del COMERCIO (lenders por redirect: la entidad devuelve ahí, no a CrediOp). E2E_RETURN_URL lo
// setea bin/asesor con --via-redirect (/return del shim); fallback a la tienda mock.
const RETURN_URL = process.env.E2E_RETURN_URL ?? MOCK_STORE;
const PICK_TIMEOUT = Number(process.env.E2E_PICK_TIMEOUT_MS ?? 300_000); // cuánto esperamos TU acción por pantalla
const STEP_LINGER = Number(process.env.E2E_STEP_MS ?? 800);
const LINGER = Number(process.env.E2E_LINGER_MS ?? 5_000);

// 1 ventana = A vía openA (browser.newContext); NO el fixture `page` + PREVIEW_VP (choca con deviceScaleFactor
// del device 'Desktop Chrome' del config: undefined no lo desova). slowMo es browser-level → va en test.use.
test.use({ launchOptions: { slowMo: PREVIEW ? Number(process.env.E2E_PREVIEW_SLOWMO ?? 150) : 0 } });
test.skip(ENTRY === 'cognito' && (!cognitoCreds.user || !cognitoCreds.pass), 'guided cognito: requiere .cognito.json');
test.afterAll(async () => { await close(); });

let SHOT = 0;
async function shot(page: Page, label: string) {
    if (process.env.E2E_SHOTS === '0') return;   // fotos ON por defecto (trazo del flujo); apagar con E2E_SHOTS=0
    const name = `guided-${String(++SHOT).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: join(AUTH, name), fullPage: true }).catch(() => {});
    console.log(`  📸 ${name}`);
}
const log = (s: string) => console.log(`  ▸ ${s}`);
const hereOf = (page: Page) => { try { return new URL(page.url()).pathname; } catch { return page.url(); } };

// Foto de ERROR: se dispara SOLA cuando la app muestra su banner de error en CUALQUIER pantalla (lo detecta el
// MutationObserver inyectado más abajo) o ante un pageerror. Va aparte del trazo normal (nombre guided-ERROR-NN)
// para que salte a la vista y sepas EN QUÉ pantalla se rompió. Best-effort: nunca tumba el flujo.
let ERR_SHOT = 0;
async function errorShot(page: Page, detail: string) {
    const name = `guided-ERROR-${String(++ERR_SHOT).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(AUTH, name), fullPage: true }).catch(() => {});
    console.log(`  ⚠ FALLO EN PANTALLA (${hereOf(page)}): ${detail} → .auth/${name}`);
}

// fill robusto contra hidratación: el MoneyInput/SSR pierde fill() si React no ató el onChange → reintenta
// tecla por tecla hasta que el valor quede. Best-effort (no rompe si el campo es raro).
async function seedField(field: ReturnType<Page['locator']>, value: string) {
    for (let i = 0; i < 5; i++) {
        const cur = (await field.inputValue().catch(() => '')).replace(/\D/g, '');
        if (cur && cur === value.replace(/\D/g, '')) return;
        await field.click().catch(() => {});
        await field.fill('').catch(() => {});
        await field.fill(value).catch(() => {});
        if ((await field.inputValue().catch(() => '')).replace(/\D/g, '') === value.replace(/\D/g, '')) return;
        await field.fill('').catch(() => {});
        await field.pressSequentially(value, { delay: 40 }).catch(() => {});
    }
}

test('guided (semiautomático)', async ({ browser }) => {
    test.setTimeout(900_000); // interactivo: esperamos TUS clicks (PICK_TIMEOUT por pantalla)
    mkdirSync(AUTH, { recursive: true });

    // Cache de sesión Cognito: si hay .auth/cognito-state.json lo inyectamos → el Hosted UI no aparece y
    // cognitoLogin es no-op. Si la sesión murió, el form reaparece y cognitoLogin re-loguea + re-guarda.
    const { page } = await openA(browser, { baseURL: config.feBaseUrl, userAgent: IPHONE_UA, storageState: ENTRY === 'cognito' ? cognitoStorageState() : undefined }); // A = mitad izquierda (comercio/asesor)
    // React Scan (overlay FPS/inspección del wizard en dev): se bloquea acá — cortamos su script — SIN tocar
    // el frontend. Para verlo igual: E2E_REACT_SCAN=1.
    if (process.env.E2E_REACT_SCAN !== '1') await page.route(/react-scan|react-grab/, (r) => r.abort()).catch(() => {});
    // Watcher del banner de error: un MutationObserver (inyectado ANTES de cada navegación) vigila el texto de
    // error de la app en cualquier pantalla y emite un console.log marcado; del lado del test lo detectamos y
    // sacamos la foto (ver page.on('console')). Vive durante TODA la interacción —incluida la pausa manual—
    // porque los eventos de consola siguen fluyendo por CDP aunque el runner esté pausado.
    await page.addInitScript(() => {
        const RE = /ocurrió un error|inténtalo de nuevo|algo salió mal|error inesperado|no fue posible|intenta de nuevo/i;
        // El handoff de self-management (agregadores tipo Sistecrédito/Meddipay) es un MODAL: aparece en el DOM
        // SIN navegar, así que el watcher de navegaciones no lo ve. Lo marcamos acá para que la ventana B pueda
        // reaccionar (el cliente sigue en SU celular por el link de WhatsApp).
        const MODAL_RE = /informaci[óo]n importante|en (tu|su) celular|whats?app|link para continuar|enviado.*enlace|mensaje de whats/i;
        let last = '';
        let modalSent = false;
        let scheduled = false;
        const scan = () => {
            scheduled = false;
            const txt = document.body ? document.body.innerText || '' : '';
            if (!modalSent && MODAL_RE.test(txt)) { modalSent = true; console.log('__E2E_HANDOFF_MODAL__'); }
            const m = txt.match(RE);
            const hit = m ? txt.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 100).replace(/\s+/g, ' ').trim() : '';
            if (hit && hit !== last) { last = hit; console.log('__E2E_ERROR_BANNER__ ' + hit); }
            if (!hit) last = '';
        };
        const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(scan, 200); } };
        const start = () => { try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true }); } catch { /* */ } schedule(); };
        if (document.body) start(); else addEventListener('DOMContentLoaded', start);
    }).catch(() => {});
    // log de navegaciones (revela a dónde manda el wizard tras cada Continuar / la selección) + captura de
    // redirect EXTERNO (portal del lender fuera de localhost, same-tab o popup). La continuación detecta por
    // CONDUCTA (modal / nav in-platform / redirect externo), NO por rt.
    let externalUrl = '';
    const isExternal = (u: string) => /^https?:\/\//.test(u) && !/localhost:5174|127\.0\.0\.1/.test(u);
    page.on('framenavigated', (f) => {
        if (f !== page.mainFrame()) return;
        const u = f.url();
        let p = u; try { p = new URL(u).pathname; } catch { /* about:blank / data: */ }
        log(`nav → ${p}`);
        if (isExternal(u)) externalUrl = u;
    });
    page.context().on('page', async (pp) => { const u = pp.url(); if (isExternal(u)) { externalUrl = u; log(`popup externo → ${u}`); } await pp.close().catch(() => {}); });

    // ─────────────────── VENTANA B (el celular del cliente) — abierta DESDE EL ARRANQUE ───────────────────
    // Antes B nacía recién en el handoff rt=2 (más abajo), así que en modo MANUAL —el que usa el panel— NO
    // aparecía NUNCA: el branch manual termina en page.pause() mucho antes. Ahora las dos ventanas están
    // abiertas desde el principio (A izquierda = comercio/asesor · B derecha = celular del cliente) y B espera.
    //
    // B NO hereda la sesión de A, a propósito: `/self-service/*` matchea `route(":flow", public-layout.tsx)`
    // en el wizard → layout PÚBLICO, sin `requireUserWithSession` (eso solo lo exige `/merchant/*` vía
    // default-layout). Es el celular del CLIENTE: en la vida real abre el link sin la sesión del asesor.
    const { page: B } = await openB(browser, { baseURL: config.feBaseUrl, userAgent: IPHONE_UA }); // B mitad DERECHA
    // El polling de validación (captura ADO por foto) NO es automatizable → lo mockeamos como validado. Va acá,
    // en la creación, para que esté activo ANTES de cualquier navegación de B (venga del watcher o del guiado).
    await B.route('**/validation-status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ validationStatus: { data: { all_completed: true, ado: { validated: true, completed: true, state_id: 2, state_name: 'Validado' }, tusdatos_aml: { has_findings: false, completed: true } } }, validationStatusAbaco: null, errorType: null, errorMessage: null }) }).catch(() => {}));
    // Tarjeta de estado de B (mientras no haya una pantalla real que mostrar).
    const bCard = (kicker: string, title: string, body: string, dots = true) => B.setContent(
        `<!doctype html><meta charset="utf-8"><title>B · celular del cliente</title>
      <style>html,body{height:100%;margin:0}body{background:#0f1115;color:#e7eaf0;display:grid;place-items:center;
      font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:24px}
      .k{font-size:12px;letter-spacing:.9px;text-transform:uppercase;color:#22c55e;font-weight:800}
      h1{font-size:19px;margin:10px 0 6px} p{color:#9aa4b2;font-size:13.5px;margin:0;max-width:36ch}
      .d{margin-top:20px;color:#2a2f3a;font-size:26px;letter-spacing:6px}</style>
      <div><div class="k">${kicker}</div><h1>${title}</h1><p>${body}</p>
      ${dots ? '<div class="d">•••</div>' : ''}</div>`).catch(() => {});
    await bCard('Ventana B · celular del cliente', 'Esperando…',
        'Elegí el lender en la ventana A (izquierda). Según la rama que tome el flujo, esta ventana abre lo que le toca al cliente.');

    // De la URL de A (/merchant|/ecommerce/{hash}/{ur}/…) al link del CLIENTE (/self-service/{hash}/{ur}/confirmation).
    const selfServiceLinkFrom = (u: string): string => {
        const m = u.match(/^(https?:\/\/[^/]+)\/(?:merchant|ecommerce)\/([^/]+)\/(\d+)\//);
        return m ? `${m[1]}/self-service/${m[2]}/${m[3]}/confirmation` : '';
    };

    // ── ENRUTADOR DE B: una vez que A resuelve, B abre lo que le corresponde al CLIENTE en esa rama. ──
    //  · 'creditopx'  (rt=2 in-platform) → el link del cliente, journey real in-platform.
    //  · 'agregador'  (modal self-management, ej. Sistecrédito/Meddipay) → portal del lender (mock-bank). En la
    //    vida real el cliente sigue por el link de WhatsApp EN SU CELULAR: eso ES un 2º dispositivo, y hasta
    //    ahora quedaba invisible (el demo se frenaba en el modal).
    //  · 'redirect'   (rt=1, ej. Bancolombia) → B solo EXPLICA: ese redirect ocurre de verdad en la MISMA
    //    ventana A (el navegador del comercio se va al portal). Mandarlo a B enseñaría un modelo equivocado.
    let bWoke = false;
    // Guarda anti-falso-positivo: NO hay handoff antes de elegir lender. Sirve para las dos señales ruidosas —
    // el Hosted UI de Cognito (navegación externa al arrancar) y el copy "en tu celular" del OTP (matchea el
    // regex del modal). Se prende al pasar por /lenders.
    let seenLenders = false;
    const wakeB = async (kind: 'creditopx' | 'agregador' | 'redirect', aUrl: string, lender = ''): Promise<void> => {
        if (bWoke) return;
        bWoke = true;
        if (kind === 'creditopx') {
            const link = selfServiceLinkFrom(aUrl);
            if (!link) { bWoke = false; return; }
            log(`B (celular): handoff CreditopX en A → abro ${new URL(link).pathname}`);
            await B.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
            return;
        }
        if (kind === 'agregador') {
            const url = `${MOCK_BANK}?lender=${encodeURIComponent(lender)}&monto=${AMOUNT}&volver=${encodeURIComponent(RETURN_URL)}`;
            log(`B (celular): self-management en A → el cliente abre el link (portal ${lender || 'del lender'}, mock)`);
            await B.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
            return;
        }
        log('B: rama de REDIRECT → se resuelve en A (misma ventana); B queda explicando.');
        await bCard('Ventana B · sin uso en esta rama', 'Esta rama usa una sola ventana',
            'El lender por redirect (rt=1) se abre en la MISMA ventana A: el navegador del comercio se va al portal de la entidad y vuelve al comercio. No hay 2º dispositivo.', false);
    };

    // MANUAL (el panel): nadie automatiza el flujo, así que B se despierta SOLA mirando lo que hace A. Por
    // EVENTOS (no polling): siguen llegando por CDP durante el page.pause() en el que queda el modo manual.
    //   · navegación a /continue|/confirmation → CreditopX · navegación externa → redirect
    //   · marcador __E2E_HANDOFF_MODAL__ (lo emite el MutationObserver inyectado más arriba) → self-management
    // En GUIADO no hace falta el watcher: el guion llama a wakeB() donde corresponde.
    //
    // OJO con "externa": el Hosted UI de Cognito (login.creditop.com) TAMBIÉN es una navegación externa, y
    // ocurre al ARRANQUE. Sin guarda, el login dispararía la rama de redirect antes de que exista un lender.
    // Por eso el redirect solo cuenta DESPUÉS de haber pasado por /lenders (no hay handoff antes de elegir).
    if (process.env.E2E_GUIDED === '0') {
        page.on('framenavigated', (f) => {
            if (f !== page.mainFrame()) return;
            const u = f.url();
            if (/\/lenders(\?|$)/.test(u)) seenLenders = true;
            if (bWoke) return;
            if (/\/(continue|confirmation)(\?|$)/.test(u)) void wakeB('creditopx', u);
            else if (seenLenders && isExternal(u)) void wakeB('redirect', u);
        });
    }
    // Traza de redirects del SERVIDOR → caza el rebote a /solicitar y muestra QUÉ request lo devuelve.
    // Captura: 302 clásicos (Location), single-fetch de React Router (*.data) y headers de redirect (x-remix-redirect).
    // Si el rebote NO aparece acá pero sí en el log de nav, es un navigate() CLIENT-side (no un redirect de loader).
    page.on('response', (resp) => {
        const s = resp.status();
        let from = resp.url(); try { const x = new URL(resp.url()); from = x.pathname + x.search; } catch { /* */ }
        const h = resp.headers();
        const loc = h['location'] || h['x-remix-redirect'] || h['x-router-redirect'] || '';
        const is3xx = s >= 300 && s < 400;
        const isData = /\.data(\?|$)/.test(from);
        const relevant = /solicitar|continue|lenders|modes/.test(from) || /solicitar|continue|modes/.test(loc);
        if ((is3xx || isData || loc) && relevant) log(`  ↪ ${s} ${from}${loc ? ` → ${loc}` : ''}`);
        // un 5xx del backend/loader es un fallo duro → foto (el backend caído era justo esto)
        if (s >= 500) void errorShot(page, `HTTP ${s} ${from}`);
    });
    // errores/warnings del BROWSER (client-side) → si el rebote viene de un error boundary o un warning de RR.
    // Además: el marcador __E2E_ERROR_BANNER__ (del MutationObserver) → foto de la pantalla con el error.
    page.on('console', (m) => {
        const s = m.text();
        if (s.startsWith('__E2E_ERROR_BANNER__')) { void errorShot(page, `banner: "${s.replace('__E2E_ERROR_BANNER__ ', '').slice(0, 120)}"`); return; }
        // handoff de self-management (modal "seguí en tu celular"): en MANUAL despierta a B con el portal del
        // lender. En GUIADO lo hace el guion (con el nombre del lender ya conocido) → acá no tocamos nada.
        // seenLenders: el copy "en tu celular" también aparece en el OTP → sin la guarda, B abriría el portal
        // del lender a mitad del alta, antes de que exista una selección.
        if (s.startsWith('__E2E_HANDOFF_MODAL__')) { if (process.env.E2E_GUIDED === '0' && seenLenders) void wakeB('agregador', page.url()); return; }
        const t = m.type();
        if (t !== 'error' && t !== 'warning') return;
        const ss = s.slice(0, 200);
        // ruido conocido de LOCAL (no son fallos del flujo): Echo/Pusher a ws.credito, react-scan bloqueado, hydration/nonce.
        if (!/Download the React DevTools|PostHog|Lit is in dev|ws\.credito|WebSocket connection|ERR_NAME_NOT_RESOLVED|react-scan|react-grab|ERR_FAILED|hydrat|nonce/i.test(ss)) log(`  ⚠ console.${t}: ${ss}`);
    });
    page.on('pageerror', (e) => { log(`  ⚠ pageerror: ${String(e.message).slice(0, 200)}`); void errorShot(page, `pageerror: ${String(e.message).slice(0, 80)}`); });
    const tip = (s: string) => console.log(`\n  👉 ${s}\n`);

    // ───────────────────────── ENTRADA ─────────────────────────
    if (ENTRY === 'ecommerce') {
        expect(CHECKOUT_URL, 'E2E_CHECKOUT_URL lo arma bin/asesor (--ecommerce)').toBeTruthy();
        if (STORE) {
            await page.goto(`${MOCK_STORE}?to=${encodeURIComponent(CHECKOUT_URL)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
            await page.getByRole('button', { name: /pagar con creditop/i }).waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
            await shot(page, 'tienda');
            tip('Dale "Pagar con Creditop" en la tienda.');
            await page.waitForURL(/\/(solicitar|checkout|otp|personal-info|lenders)/, { timeout: PICK_TIMEOUT });
        } else {
            await page.goto(CHECKOUT_URL, { waitUntil: 'domcontentloaded' });
            await page.waitForURL(/\/(solicitar|otp|personal-info|lenders)/, { timeout: 40_000 });
        }
    } else {
        await page.goto(`/merchant/${HASH}/solicitar`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
        await cognitoLogin(page);
        await page.waitForURL(/\/merchant\/.+\/(solicitar|request-amount)/, { timeout: 90_000 });
    }
    log(`entrada OK → ${hereOf(page)}`);

    // perfil del usuario sintético desde el panel (bin/panel) vía env. Sin env → {} (comportamiento previo).
    const synthOptsFromEnv = () => ({
        income: Number(process.env.E2E_SYNTH_INCOME) || undefined,
        score: Number(process.env.E2E_SYNTH_SCORE) || undefined,
        name: process.env.E2E_SYNTH_NAME || undefined,
        documentType: process.env.E2E_SYNTH_DOCTYPE || undefined,
        document: process.env.E2E_SYNTH_DOC || undefined,
        gender: process.env.E2E_SYNTH_GENDER || undefined,
        age: Number(process.env.E2E_SYNTH_AGE) || undefined,
        negatives: process.env.E2E_SYNTH_NEG ? Number(process.env.E2E_SYNTH_NEG) : undefined,
        consulted: process.env.E2E_SYNTH_CONS ? Number(process.env.E2E_SYNTH_CONS) : undefined,
        occupation: process.env.E2E_SYNTH_OCC || undefined,
        dob: process.env.E2E_SYNTH_DOB || undefined,
        expeditionDate: process.env.E2E_SYNTH_EXP || undefined,
        email: process.env.E2E_SYNTH_EMAIL || undefined,
    });

    // ── MODO MANUAL (bin/asesor <m> SIN `auto`): el browser queda en monto y VOS manejás TODO a mano. ──
    //    Con E2E_INJECT=1: igual manual (nada de auto-relleno), pero al llegar a personal-info inyecto el buró
    //    (invisible) para que listen los rt=2. Sin E2E_INJECT: manual puro (buró real / sin inyección). ──
    if (process.env.E2E_GUIDED === '0') {
        if (process.env.E2E_INJECT === '1') {
            // STEP a dónde SALTAR: monto (default, vos manejás) | phone | personal-info | lenders.
            // Para phone/personal-info/lenders: relleno + clickeo "Continuar" por vos hasta ese paso.
            const STEP = (process.env.E2E_STEP_TARGET || 'monto').toLowerCase();
            const clickContinue = () =>
                page.getByRole('button', { name: /continuar|continue|siguiente/i }).first().click({ timeout: 8_000 }).catch(() => {});
            const uReqOf = () => page.url().match(/\/(?:merchant|ecommerce)\/[^/]+\/(\d+)\//)?.[1] ?? '';

            // ── STEP = monto (default): comportamiento de siempre. Vos manejás; inyecto el buró al llegar a personal-info. ──
            if (STEP === 'monto') {
                tip('MANUAL: manejá desde monto. Al llegar a personal-info inyecto el buró (invisible); después seguí a /lenders.');
                await shot(page, 'manual-entrada');
                await page.waitForURL(/\/(personal-info|employment-info)(\?|$)/, { timeout: PICK_TIMEOUT }).catch(() => {});
                const ur = uReqOf();
                if (ur) {
                    const r = await synthFill(Number(ur), { ...synthOptsFromEnv(), skipIdentity: true });
                    log(`buró inyectado para uReq ${ur} (Experian ${r.datacredito_forged}) — identidad la ponés vos; seguí a /lenders`);
                    tip('Buró inyectado (invisible). Seguí el wizard hasta /lenders. (Resume ▶ para terminar.)');
                } else {
                    log('no pude leer el uReq en personal-info — seguí igual (sin buró inyectado)');
                }
                await shot(page, 'manual-personal-info');
                await page.pause().catch(() => {});
                return;
            }

            // ── STEP = lenders: HEADLESS (sin llenado visual). register (crea el user) + INSERT del uReq +
            //    inyecto el sintético + goto /lenders. Rápido: no pasa por monto/teléfono/OTP. ──
            if (STEP === 'lenders') {
                log('salto HEADLESS a /lenders (sin llenado visual): register + uReq + buró inyectado');
                // register del teléfono (scrubphone ya lo dejó fresco). Endpoint sin auth, backend local.
                const reg = await fetch(`${config.mockUrl}/api/onboarding/phone/register`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', accept: 'application/json' },
                    body: JSON.stringify({ phone_number: PHONE, phoneNumber: PHONE, terms: true, policies: true, otp_length: 4, otpLength: 4, partner_branch_hash: HASH, partnerBranchHash: HASH }),
                }).then((r) => r.json()).catch(() => null);
                const userId = reg?.data?.user?.id ?? null;
                const br = userId ? await one<{ branch_id: number; allied_id: number }>('SELECT id AS branch_id, allied_id FROM allied_branches WHERE hash=? LIMIT 1', [HASH]).catch(() => null) : null;
                // asesor → corporate_user_id (como el flujo real, para que /lenders lo autorice). bin/asesor exporta E2E_ASESOR_SUB.
                const asesorSub = process.env.E2E_ASESOR_SUB || '';
                const asesorId = asesorSub ? ((await one<{ id: number }>('SELECT id FROM users WHERE cognito_id=? LIMIT 1', [asesorSub]).catch(() => null))?.id ?? null) : null;
                let ur = '';
                if (userId && br) {
                    const ins = await exec(
                        'INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount, original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number, fee_value, rate, created_at, updated_at) VALUES (?,?,?,NULL,?,?,1,?,1,0,0,0,NOW(),NOW())',
                        [userId, br.allied_id, br.branch_id, Number(AMOUNT), Number(AMOUNT), asesorId],
                    ).catch(() => null);
                    ur = ins?.insertId ? String(ins.insertId) : '';
                }
                if (ur) {
                    const r = await synthFill(Number(ur), synthOptsFromEnv());
                    log(`uReq ${ur} sembrado headless (user ${userId} · asesor ${asesorId ?? '-'} · Experian ${r.datacredito_forged}) → /lenders?amount=${AMOUNT}`);
                    await page.goto(`/merchant/${HASH}/${ur}/lenders?amount=${AMOUNT}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
                } else {
                    log(`✗ no pude sembrar el uReq headless (user=${userId ?? '?'} · branch=${br ? 'ok' : 'no'}) — probá STEP=personal-info (visual)`);
                }
                await page.waitForURL(/\/lenders/, { timeout: 60_000 }).catch(() => {});
                await page.getByText(/cargando las opciones/i).waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {});
                await shot(page, 'headless-lenders');
                tip('Salto HEADLESS a /lenders (sin llenado visual, con el sintético inyectado). Explorá las cards. (Resume ▶ para terminar.)');
                await page.pause().catch(() => {});
                return;
            }

            // ── STEP = phone | personal-info: SALTO automático VISUAL hasta ese paso ──
            log(`salto automático hasta "${STEP}" (relleno monto/teléfono/OTP por vos)`);
            // MONTO → Continuar
            const amountInput = page.getByTestId('amount-input').or(page.getByRole('textbox', { name: /monto/i }));
            if (await amountInput.isVisible({ timeout: 20_000 }).catch(() => false)) {
                await seedField(amountInput, AMOUNT);
                await clickContinue();
            }
            const phoneInput = page.getByTestId('phone-input').or(page.getByRole('textbox', { name: /celular|tel[ée]fono|n[úu]mero/i }));
            await phoneInput.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
            if (STEP === 'phone') {
                await shot(page, 'auto-phone');
                tip('Salté a Teléfono con el monto ya puesto. Seguí vos desde acá. (Resume ▶ para terminar.)');
                await page.pause().catch(() => {});
                return;
            }

            // TELÉFONO → Continuar → OTP (bypass QA) → Continuar
            if (await phoneInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
                await seedField(phoneInput, PHONE);
                await clickContinue();
                await page.waitForURL(/\/otp(\?|$)/, { timeout: 30_000 }).catch(() => {});
            }
            const otp = page.getByTestId('otp-input').or(page.locator('input:not([type="hidden"])').first());
            await otp.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
            await otp.click().catch(() => {});
            await page.keyboard.type(OTP, { delay: 80 }).catch(() => {});
            await clickContinue();
            await page.waitForURL(/\/(personal-info|employment-info|lenders)(\?|$)/, { timeout: 40_000 }).catch(() => {});

            // PERSONAL-INFO
            const ur = uReqOf();
            if (STEP === 'personal-info') {
                if (ur && /personal-info|employment-info/.test(page.url())) {
                    const r = await synthFill(Number(ur), { ...synthOptsFromEnv(), skipIdentity: true });
                    log(`salté a personal-info · buró inyectado uReq ${ur} (Experian ${r.datacredito_forged})`);
                }
                await shot(page, 'auto-personal-info');
                tip('Salté a personal-info con el buró inyectado. Completá/seguí a /lenders. (Resume ▶ para terminar.)');
                await page.pause().catch(() => {});
                return;
            }

            // LENDERS: inyecto identidad+buró completos y navego directo (salta el submit de personal-info)
            if (ur && /personal-info|employment-info/.test(page.url())) {
                const r = await synthFill(Number(ur), synthOptsFromEnv());
                const baseUrl = page.url().replace(/\/(personal-info|employment-info|lenders).*$/, '');
                const reqAmt = (await one<{ amount: number | string }>('SELECT amount FROM user_requests WHERE id=? LIMIT 1', [Number(ur)]).catch(() => null))?.amount;
                const amt = reqAmt != null && Number(reqAmt) > 0 ? Math.round(Number(reqAmt)) : Number(AMOUNT);
                log(`uReq ${ur} armado (Experian ${r.datacredito_forged}) → /lenders?amount=${amt}`);
                await page.goto(`${baseUrl}/lenders?amount=${amt}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
            }
            await page.waitForURL(/\/lenders/, { timeout: 60_000 }).catch(() => {});
            await page.getByText(/cargando las opciones/i).waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {});
            await shot(page, 'auto-lenders');
            tip('Salté directo a /lenders con el usuario sintético inyectado. Explorá las cards. (Resume ▶ para terminar.)');
            await page.pause().catch(() => {});
            return;
        }
        tip('MANUAL: el browser quedó en monto. Manejá vos todo el flujo a mano. (Resume ▶ en el Inspector para terminar.)');
        await shot(page, 'manual-monto');
        await page.pause().catch(() => {});
        return;
    }

    // ───────────────────────── MONTO (siembro + vos das Continuar) ─────────────────────────
    const amount = page.getByTestId('amount-input').or(page.getByRole('textbox', { name: /monto/i }));
    if (await amount.isVisible({ timeout: 20_000 }).catch(() => false)) {
        await seedField(amount, AMOUNT);
        await shot(page, 'monto');
        tip(`Monto prellenado ($${AMOUNT}). Dale "Continuar".`);
        // el teléfono aparece (mismo screen revela el campo, o navega) → señal de que avanzaste
        await page.getByTestId('phone-input').or(page.getByRole('textbox', { name: /celular|tel[ée]fono|n[úu]mero/i }))
            .first().waitFor({ state: 'visible', timeout: PICK_TIMEOUT });
    }

    // ───────────────────────── TELÉFONO (siembro + vos das Continuar) ─────────────────────────
    const phone = page.getByTestId('phone-input').or(page.getByRole('textbox', { name: /celular|tel[ée]fono|n[úu]mero/i }));
    if (await phone.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await seedField(phone, PHONE);
        await shot(page, 'telefono');
        tip(`Teléfono prellenado (${PHONE}). Dale "Continuar".`);
        await page.waitForURL(/\/otp(\?|$)/, { timeout: PICK_TIMEOUT });
    }

    // ───────────────────────── OTP (siembro + vos das Continuar) ─────────────────────────
    const otp = page.getByTestId('otp-input').or(page.locator('input:not([type="hidden"])').first());
    await otp.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await otp.click().catch(() => {});
    await page.keyboard.type(OTP, { delay: 80 }).catch(() => {});
    await shot(page, 'otp');
    tip(`OTP prellenado (${OTP}, bypass de QA). Dale "Continuar".`);
    await page.waitForURL(/\/(personal-info|employment-info|lenders)(\?|$)/, { timeout: PICK_TIMEOUT });

    // ───────────────────────── PERSONAL-INFO (BYPASS invisible, auto) ─────────────────────────
    let url = page.url();
    const uReqID = url.match(/\/(?:merchant|ecommerce)\/[^/]+\/(\d+)\//)?.[1] ?? '';
    const base = url.replace(/\/(personal-info|employment-info|lenders).*$/, '');
    if (/personal-info|employment-info/.test(url) && uReqID) {
        log(`personal-info: BYPASS datacrédito (synthFill: KYC + Experian forjado) — invisible, no toques nada acá`);
        const r = await synthFill(Number(uReqID), synthOptsFromEnv());
        // el monto a /lenders = el que VOS ingresaste en /solicitar (guardado en user_requests.amount al darle
        // Continuar), NO el AMOUNT sembrado por defecto. Si no se pudo leer, cae al default.
        const reqAmt = (await one<{ amount: number | string }>('SELECT amount FROM user_requests WHERE id=? LIMIT 1', [Number(uReqID)]).catch(() => null))?.amount;
        const amt = reqAmt != null && Number(reqAmt) > 0 ? Math.round(Number(reqAmt)) : AMOUNT;
        log(`uReq ${uReqID} armado (perfil default · Experian ${r.datacredito_forged}) → /lenders?amount=${amt}`);
        await page.goto(`${base}/lenders?amount=${amt}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    }

    // ───────────────────────── LENDERS (VOS elegís) ─────────────────────────
    await page.waitForURL(/\/lenders/, { timeout: 60_000 }).catch(() => {});
    await page.getByText(/cargando las opciones/i).waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {});
    await page.getByText(/opci[óo]n|disponible|financ/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    await shot(page, 'lenders');
    tip('Elegí un lender en el marketplace (click en su tarjeta + su botón). El demo detecta tu selección y sigue solo.');

    // detectar TU selección: o navega fuera de /lenders (CreditopX in-platform / redirect), o aparece un modal
    // (self-management WhatsApp). Carrera con timeout largo (esperamos tu acción).
    const lendersPath = hereOf(page);
    await Promise.race([
        page.waitForURL((u) => !u.pathname.includes('/lenders'), { timeout: PICK_TIMEOUT }).catch(() => {}),
        page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: PICK_TIMEOUT }).catch(() => {}),
        page.getByText(/informaci[óo]n importante|whats?app|link para continuar/i).first().waitFor({ state: 'visible', timeout: PICK_TIMEOUT }).catch(() => {}),
    ]);
    // ───────────────────────── DETECCIÓN + CONTINUACIÓN ─────────────────────────
    // rt del lender, APENAS detectamos la selección (sin esperar): para CreditopX (rt=2) decidimos YA y vamos a
    // `continue` directo (abajo), SIN pausa de vista ni poll de modal — así A NO queda viendo el confirmation/
    // monto que el wizard muestra de paso. rt es solo informativo: rt=1 puede ser MODAL (self-management) o REDIRECT.
    const lenderRow = uReqID ? await one<{ rt: number; name: string }>(
        'SELECT l.response_type AS rt, l.name FROM user_requests ur JOIN lenders l ON l.id=ur.lender_id WHERE ur.id=? LIMIT 1', [Number(uReqID)],
    ).catch(() => null) : null;
    const rt = lenderRow?.rt ?? null;
    const lenderName = lenderRow?.name ?? '?';
    // SOLO rt≠2: pausa de vista + poll del modal (self-management puede aparecer tras una nav). rt=2 lo salta (va directo).
    let modalVisible = false;
    if (rt !== 2) {
        await page.waitForTimeout(STEP_LINGER).catch(() => {});
        const modalRx = /informaci[óo]n importante|en (tu|su) celular|whats?app|link para continuar|enviado.*enlace|mensaje de whats/i;
        for (let i = 0; i < 6 && !externalUrl; i++) {
            modalVisible = await page.getByText(modalRx).first().isVisible().catch(() => false);
            if (modalVisible) break;
            await page.waitForTimeout(500).catch(() => {});
        }
    }
    const after = hereOf(page);
    log(`selección → lender="${lenderName}" rt=${rt ?? '?'} · url=${after} · modal=${modalVisible} · externalUrl=${externalUrl ? 'sí' : 'no'}`);
    if (rt !== 2) await shot(page, 'seleccion'); // rt=2 va directo a continue: sin shot intermedio = sin ventana para divagar a monto

    if (/confirmation|continue|identity|initial-fee|down-payment/.test(after) || rt === 2) {
        // ── CreditopX (rt=2): A SE QUEDA en el handoff `continue` (autogestión "Escanea el QR" / asesor "link
        //    por WhatsApp", lo elige el wizard por flujo) ⟷ B = el celular del cliente, que continúa por el link
        //    en /self-service/.../confirmation. Abrimos B como 2ª ventana VISUAL y caminamos su journey. ──
        log(`CreditopX → A: handoff \`continue\` natural (variant por flujo) · ${after}`);
        if (!/continue/.test(hereOf(page))) {
            await page.goto(`${base}/continue`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        }
        await page.getByText(/Solicitud en validación|Escanea este código|Usa tu celular|Continuá/i).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        await shot(page, 'A-handoff');

        // ── B = OTRA ventana (el celular del cliente): abre el link en /self-service/.../confirmation y VOS dale
        //    "Continuar" en B para avanzar (igual que A). Lo NO automatizable (captura de identidad por foto, firma
        //    del pagaré por OTP-Twilio) lo completa el sistema; las pantallas con botón las clickeás vos. ──
        const selfServiceBase = base.replace(/\/(merchant|ecommerce)\//, '/self-service/');
        // B ya está abierta desde el arranque (mitad derecha, con el mock de validation-status montado y
        // esperando en su placeholder) — acá solo la llevamos al link del cliente.
        log(`B (celular del cliente): abre el link → ${new URL(`${selfServiceBase}/confirmation`).pathname}`);
        await B.goto(`${selfServiceBase}/confirmation`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await B.waitForTimeout(STEP_LINGER).catch(() => {});
        await shot(B, 'B-confirmation');
        if (RESULT === 'success') {  // success = journey real (firma → loan-approved); rejected/pending = resultado directo (else, abajo)
        // identidad (ADO, por foto) NO automatizable → el sistema la da por validada y B llega al plan de cuotas.
        await B.goto(`${selfServiceBase}/first-payment-date`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await B.waitForURL(/first-payment-date|payment-schedule/, { timeout: 20_000 }).catch(() => {});

        // B-plazos: INTERACTIVO — vos dale "Continuar" en B (celular).
        await B.getByText(/fecha de pago|primera cuota|primer pago|plazo/i).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        log(`B (celular): plazos · ${hereOf(B)}`);
        await shot(B, 'B-plazos');
        tip('En la ventana B (celular): dale "Continuar" para avanzar al plan de cuotas.');
        await B.waitForURL(/payment-schedule/, { timeout: PICK_TIMEOUT }).catch(() => {});

        // B-cronograma: INTERACTIVO — vos dale "Continuar"/"Confirmar" en B.
        await B.getByText(/confirma tu plazo|n[úu]mero de cuotas|plan de pagos|cronograma|cuotas/i).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        log(`B (celular): cronograma · ${hereOf(B)}`);
        await shot(B, 'B-cronograma');
        tip('En B: revisá el plan y dale "Continuar"/"Confirmar" para ir a la firma.');
        await B.waitForURL(/otp-validation|sign-documents/, { timeout: PICK_TIMEOUT }).catch(() => {});

        // ── B-firma: INTERACTIVO. La firma del pagaré es por OTP. El teléfono es qa-bypass → el código es conocido
        //    (PHONE.slice(-6), los últimos 6) → lo sembramos (como el OTP de A) y VOS dale el botón para FIRMAR. ──
        await B.waitForURL(/otp-validation/, { timeout: 15_000 }).catch(() => {}); // sign-documents → redirige a la firma OTP
        const firmaOtp = B.getByTestId('otp-input').or(B.locator('input:not([type="hidden"])').first());
        await firmaOtp.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        await firmaOtp.click().catch(() => {});
        await B.keyboard.type(PHONE.slice(-6), { delay: 80 }).catch(() => {});
        log(`B (celular): firma (OTP del pagaré sembrado: ${PHONE.slice(-6)}) · ${hereOf(B)}`);
        await shot(B, 'B-firma');
        tip('En B (celular): el código del pagaré ya está (qa-bypass) → dale el botón para FIRMAR.');
        await B.waitForURL(/loan-approved|approved/, { timeout: PICK_TIMEOUT }).catch(() => {});

        // la firma por UI cierra el crédito (Estado 11). Verificamos; safety net por backend si la UI no cerró.
        const st = await requestEstado11(Number(uReqID));
        if (!st.sealed11) { await closeCreditopX(Number(uReqID), {}); }
        log(`  estado: ${st.sealed11 ? 'Estado 11 ✓ (firmado en B)' : 'sellado por backend (safety net)'}`);

        // B: crédito COMPLETADO (loan-approved). A: sigue en el handoff (no cambia).
        if (!/loan-approved/.test(hereOf(B))) {
            await B.goto(`${selfServiceBase}/loan-approved`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        }
        await B.getByText(/felicidades|desembolsad|monto utilizado|aprobad/i).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        await shot(B, 'B-final');
        log('B (celular): crédito COMPLETADO (loan-approved)');
        } else {
            // ── rejected / pending: el crédito NO se aprueba → seteamos el estado por backend (resolveRequestStatus:
            //    simulador si hay ecommerce_request, si no UPDATE directo — en asesor no hay link) y B muestra el
            //    resultado en lender-result?status=… . Sin journey ni firma. ──
            const statusId = RESULT_STATUS[RESULT] ?? 6;
            const r = await resolveRequestStatus(Number(uReqID), statusId).catch((e) => ({ via: 'err', httpStatus: null, statusId, note: String(e) } as const));
            const stR = await requestEstado11(Number(uReqID));
            const viaLabel = r.via === 'db' ? (r.httpStatus ? `UPDATE directo (simulador ${r.httpStatus}, sin ecommerce_request en asesor)` : 'UPDATE directo') : `simulador HTTP ${r.httpStatus}`;
            log(`B: resultado=${RESULT} → estado ${stR.statusId ?? statusId} (${RESULT === 'rejected' ? 'Negada' : 'Pendiente'}) · ${viaLabel}`);
            const lr = RESULT === 'rejected' ? 'rechazado' : 'en-proceso';
            await B.goto(`${selfServiceBase}/lender-result?status=${lr}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
            await B.getByText(/no fue aprobada|no aprobad|rechaz|procesando|en validaci|en proceso|solicitud/i).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
            await shot(B, RESULT === 'rejected' ? 'B-rechazado' : 'B-pendiente');
            log(`B (celular): crédito ${RESULT === 'rejected' ? 'RECHAZADO' : 'PENDIENTE'} (lender-result)`);
        }

        // ── ecommerce: el wizard ahora muestra el botón NATIVO "Volver al comercio" (cuando la solicitud tiene
        //    return_url en BD) → vos lo clickeás en B y vuelve al comercio (return_url). En asesor/cognito el botón
        //    sigue siendo "Ver mi perfil" (sin return_url) y no hay retorno. ──
        if (ENTRY === 'ecommerce') {
            const volver = B.getByRole('button', { name: /volver al comercio|ir al comercio/i })
                .or(B.getByText(/volver al comercio|ir al comercio/i));
            if (await volver.first().isVisible({ timeout: 10_000 }).catch(() => false)) {
                await shot(B, 'B-volver-comercio');
                tip('En B (celular): dale "Volver al comercio" para cerrar el flujo (te lleva al return_url del comercio).');
                await B.waitForURL((u) => !u.pathname.includes('loan-approved') && !u.pathname.includes('lender-result'), { timeout: PICK_TIMEOUT }).catch(() => {});
                await shot(B, 'B-en-comercio');
                log('B (celular): volvió al comercio (return_url) — fin del flujo ecommerce CreditopX');
            } else {
                log('B: el botón nativo quedó "Ver mi perfil" → la solicitud no tiene return_url en BD (el checkout no lo sembró). Reviso el checkout si lo necesitás.');
            }
        }
        await page.bringToFront().catch(() => {});
        log('A (originador): sigue en el handoff');
    } else if (modalVisible) {
        // ── self-management (MODAL "continuá en tu celular", ej. Meddipay/Sistecrédito): el modal ES el final
        //    PARA A, que se queda ahí (handoff real). Pero el cliente NO desaparece: sigue por el link de
        //    WhatsApp EN SU CELULAR → eso es la ventana B. Antes esa continuación quedaba invisible (el demo
        //    se frenaba en el modal); ahora B abre el portal del lender (mock) y la podés recorrer.
        //    El resultado igual llega por WEBHOOK, no por el browser — el recorrido de B es ilustrativo.
        log('Self-management (modal) → A queda en el modal (handoff real); el cliente sigue en B (su celular).');
        await wakeB('agregador', page.url(), lenderName);
        await shot(B, 'B-portal-lender');
        tip('En B (celular del cliente): recorré el portal del lender. El resultado real llega por webhook.');
        const r = await resolveRequestStatus(Number(uReqID), RESULT_STATUS[RESULT] ?? 11);
        const st = await requestEstado11(Number(uReqID));
        log(`  resultado → vía ${r.via}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''} · estado ${st.sealed11 ? 'Estado 11 ✓' : st.statusId ?? '?'}`);
    } else if (externalUrl) {
        // ── REDIRECT externo REAL (rt=1 que redirige, ej. Bancolombia): para el demo mostramos el portal mock;
        //    la ENTIDAD devuelve al COMERCIO (return_url), no a CrediOp. Resultado por webhook. ──
        let host = externalUrl; try { host = new URL(externalUrl).host; } catch { /* */ }
        log(`Redirect externo (${host}) → portal del banco (mock); la entidad devuelve al COMERCIO (return_url)`);
        await wakeB('redirect', externalUrl);   // B explica que esta rama se resuelve en A (no queda en "Esperando…")
        const volver = encodeURIComponent(RETURN_URL);
        await page.goto(`${MOCK_BANK}?lender=${encodeURIComponent(lenderName)}&monto=${AMOUNT}&volver=${volver}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        await page.getByText(/continuá tu compra/i).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        await shot(page, 'banco-bienvenida');
        tip('Recorré el portal del banco (Continuar → Aprobar → Volver al comercio).');
        await resolveRequestStatus(Number(uReqID), RESULT_STATUS[RESULT] ?? 11);
        await page.getByRole('button', { name: /volver al comercio/i }).first().waitFor({ state: 'visible', timeout: PICK_TIMEOUT }).catch(() => {});
        await shot(page, 'vuelta-al-comercio');
    } else {
        // ── handoff NO estándar (el wizard quedó en otra pantalla, ej. volvió a monto): NO forzamos nada.
        //    Sellamos por webhook (best-effort) y dejamos A donde quedó, para verlo (ver el log de nav arriba). ──
        log(`handoff no estándar → el wizard quedó en "${after}". Sello el estado (best-effort), SIN forzar navegación.`);
        const r = await resolveRequestStatus(Number(uReqID), RESULT_STATUS[RESULT] ?? 11);
        const st = await requestEstado11(Number(uReqID));
        log(`  resultado → vía ${r.via}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''} · estado ${st.sealed11 ? 'Estado 11 ✓' : st.statusId ?? '?'}`);
    }

    console.log(`GUIDED uReq=${uReqID} entry=${ENTRY} lender=${lenderName} rt=${rt ?? '?'}`);
    expect(uReqID, 'el flujo no generó user_request').toBeTruthy();
    if (PREVIEW) { console.log(`  👀 fin — ventana abierta ${Math.round(LINGER / 1000)}s (Ctrl-C corta)`); await page.waitForTimeout(LINGER).catch(() => {}); }
});

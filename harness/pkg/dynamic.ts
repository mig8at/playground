// dynamic.ts — driver del flujo DINÁMICO (form-engine / onboarding-forms-service) que usan comercios tipo
// Smartpay/IMEI (ej. CeluRD). El wizard redirige /merchant/{hash}/solicitar → /request-amount y arma un
// formulario multipaso definido por backend:
//   request-amount (celular + monto) → request-phone (→ send-otp) → request-otp (→ validate-otp)
//   → [request-personal-info → request-financial-info] → /merchant/{hash}/{uReqID}/lenders
// El user_request lo crea el forms-service (el uReqID aparece en la URL de /lenders). OJO: el OTP lo valida
// el forms-service (no la tabla otps del legacy) y NO se ve bypass en el front — es el muro probable.
// INCREMENTO 1: maneja amount→phone→otp, best-effort + instrumentado (screenshot por paso), nunca lanza.
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export interface DynResult { steps: string[]; landing: string; uReqID: number | null; note: string; }

const uReqFromUrl = (u: string): number | null => { const m = u.match(/\/merchant\/[^/]+\/(\d+)\/lenders/); return m ? Number(m[1]) : null; };

export async function driveDynamicForm(page: Page, opts: { phone: string; otp: string; amount?: number; shotDir?: string }): Promise<DynResult> {
    const steps: string[] = [];
    const log = (m: string) => { steps.push(m); console.log(`      · ${m}`); };
    const shot = async (n: string) => { if (opts.shotDir) await page.screenshot({ path: join(opts.shotDir, n), fullPage: true }).catch(() => {}); };
    const amount = String(opts.amount ?? 15000); // los devices tienen max_amount ~5k–19k RD$; 15k cae en el rango
    const at = () => new URL(page.url()).pathname;

    // ── PASO 1: request-amount (celular + monto) ──
    await shot('dyn-01-amount.png');
    // celular: el SearchableSelect (@creditop/ui) abre al clickear el input; las opciones son <button type="button">
    // dentro de div.absolute.z-50 (no [role=option]). Elegimos la 1ª y verificamos el hidden #productId.
    const combo = page.getByPlaceholder(/buscar celular/i).first();
    const pidVal = () => page.locator('#productId, input[name="productId"]').first().inputValue().catch(() => '');
    if (await combo.isVisible({ timeout: 8000 }).catch(() => false)) {
        await combo.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot('dyn-01b-celular-abierto.png');
        // elegir la 1ª opción: probamos por contenedor (panel) y por texto de marca; force + verificamos #productId.
        const byPanel = page.locator('div.absolute.z-50 button[type="button"], div[class*="absolute"] button[type="button"]').first();
        const byBrand = page.getByRole('button', { name: /honor|infinix|samsung|xiaomi|realme|motorola|apple|iphone|tecno|oppo|vivo|nokia|zte/i }).first();
        let pid = '';
        for (const [how, loc] of [['panel', byPanel], ['marca', byBrand]] as const) {
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                await loc.click({ timeout: 3000, force: true }).catch(() => {});
                await page.waitForTimeout(400);
                pid = await pidVal();
                log(`celular: click vía ${how} → productId="${pid}"`);
                if (/\d/.test(pid)) break;
            }
        }
        await shot('dyn-01c-celular-elegido.png');
        if (!/\d/.test(pid)) log('celular: ⚠ NO quedó seleccionado (productId vacío)');
    } else log('celular: no encontré el input "Buscar celular…"');
    const amt = page.locator('#amount, input[name="amount"]').first();
    if (await amt.isVisible({ timeout: 3000 }).catch(() => false)) { await amt.fill(amount).catch(() => {}); log(`monto: ${amount}`); }
    else { const ph = page.getByPlaceholder(/RD\$/).first(); if (await ph.isVisible({ timeout: 1500 }).catch(() => false)) { await ph.fill(amount).catch(() => {}); log(`monto: ${amount} (por placeholder)`); } else log('monto: no encontré el input'); }
    await shot('dyn-02-amount-filled.png');
    await page.getByRole('button', { name: /activar mi cr[ée]dito|iniciar solicitud|continuar/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForURL((u) => /request-phone|request-otp|\/\d+\/lenders/.test(u.pathname + u.search), { timeout: 15000 }).catch(() => {});
    log(`tras "Iniciar solicitud" → ${at()}`);

    // ── PASO 2: request-phone (país +57 → teléfono → Continuar → dispara el OTP) ──
    if (/request-phone/.test(page.url())) {
        await shot('dyn-03-phone.png');
        // el form arranca en +1 pero CeluRD opera con +57 (Colombia) → seleccionar +57 ANTES del número,
        // o "Continuar" rechaza el teléfono. Probamos <select> nativo y, si no, dropdown custom (+1 → +57).
        const sel = page.locator('select').first();
        if (await sel.isVisible({ timeout: 1500 }).catch(() => false)) {
            for (const opt of [{ label: 'Colombia' }, { label: '+57' }, { value: '57' }, { value: '+57' }, { value: 'CO' }]) {
                if (await sel.selectOption(opt as any).then(() => true).catch(() => false)) break;
            }
            log('país: +57 (select)');
        } else {
            await page.getByText(/^\s*\+1\s*$/).first().click({ timeout: 2000 }).catch(() => {});
            await page.getByText(/\+57|colombia/i).first().click({ timeout: 2000 }).catch(() => {});
            log('país: +57 (dropdown)');
        }
        const phoneDigits = (opts.phone || '').replace(/\D/g, '').slice(-10) || '3131010101';
        const phoneInput = page.getByPlaceholder(/\d{7,}/).or(page.locator('input[type="tel"], input:not([type="hidden"])')).first();
        if (await phoneInput.isVisible({ timeout: 5000 }).catch(() => false)) { await phoneInput.fill(phoneDigits).catch(() => {}); log(`teléfono: +57 ${phoneDigits}`); }
        await page.getByRole('button', { name: /continuar|siguiente|enviar/i }).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForURL(/request-otp/, { timeout: 15000 }).catch(() => {});
        log(`tras teléfono → ${at()}`);
    }

    // ── PASO 3: request-otp — TIPEAMOS el código para el VISUAL. NO valida (el otp-service es externo, sin
    // bypass). El AVANCE real lo da la DB: el user_request YA existe (lo creó request-amount) → el caller hace
    // synthFill (KYC) + navega a /lenders, igual que ecommerce. El OTP queda "de adorno" visual.
    if (/request-otp/.test(page.url())) {
        const code = ((opts.otp || '000000').replace(/\D/g, '')) || '000000';
        const boxes = page.locator('input:not([type="hidden"])');
        const n = await boxes.count().catch(() => 0);
        if (n > 1) { await boxes.first().click().catch(() => {}); await page.keyboard.type((code + '000000').slice(0, n), { delay: 70 }); }
        else if (n === 1) { await boxes.first().fill(code).catch(() => {}); }
        log(`OTP tipeado (${code}) — visual, sin validar (el avance lo da la DB)`);
        await shot('dyn-04-otp.png');
    }

    await shot('dyn-05-fin.png');
    return { steps, landing: at(), uReqID: uReqFromUrl(page.url()), note: `recorrido visual del form dinámico hasta ${at()}` };
}

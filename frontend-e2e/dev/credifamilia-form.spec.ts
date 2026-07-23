// Captura VISUAL del formulario dinámico G2 de Credifamilia (form_type 6) — la pantalla `additional-info`.
//
// No pasa por el flujo real (KYC Evidente/CrossCore está antes y es externo): siembra un user_request de
// Mediarte a nombre del asesor (estado 9) y salta DIRECTO a `/merchant/{hash}/{ur}/additional-info/6` con la
// sesión Cognito cacheada. El loader (SSR) fetchea el schema del form-service real de dev + el country-tree,
// así que renderiza la cascada Departamento→Ciudad de nacimiento (incluye el field 233 que agregamos).
//
// Requiere: wizard :5174 arriba y apuntado a dev con VITE_FORM_SERVICE_BASE_URL=form-service.inertia-develop.
// Correr: I_KNOW_THIS_TOUCHES_SHARED_DEV=1 E2E_TARGET=dev npx playwright test dev/credifamilia-form.spec.ts --reporter=line
import { test } from '@playwright/test';
import { config } from '../pkg/config';
import { cognitoStorageState } from '../pkg/cognito';
import { exec, close } from '../pkg/db';
import { IPHONE_UA } from '../pkg/windows';

// Sonría (allied 26, sucursal 3, hash 76db47f5): es el comercio al que está asociada la sesión cacheada de
// a.arismendy. El form 6 se sirve por URL, así que NO importa que Sonría no tenga Credifamilia — importa que
// el ur pertenezca al comercio+asesor de la sesión, si no el layout rebota a /solicitar del comercio propio.
const HASH = '76db47f5';
const ALLIED_ID = 26;
const BRANCH_ID = 3;
const ASESOR_ID = 1827080;    // a.arismendy@uniandes.edu.co (corporate_user_id de la sesión)
const CLIENT_ID = 1827671;    // usuario cliente existente en dev (dueño del user_request)
const AMOUNT = 600000;

test.afterAll(async () => { await close(); });

test('captura additional-info Credifamilia (form 6)', async ({ browser }) => {
    // 1) Sembrar el user_request (Mediarte + asesor, estado 9 «perfil»). lender_id NULL: el form route
    //    trae el schema 6 por URL, no depende de la resolución de form-type por lender.
    const ins = await exec(
        'INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount, original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number, fee_value, rate, created_at, updated_at) VALUES (?,?,?,NULL,?,?,9,?,1,0,0,0,NOW(),NOW())',
        [CLIENT_ID, ALLIED_ID, BRANCH_ID, AMOUNT, AMOUNT, ASESOR_ID],
    );
    const ur = ins.insertId;
    console.log(`\n>>> user_request sembrado: ${ur}  (para limpiar: DELETE FROM user_requests WHERE id=${ur})\n`);

    // 2) Contexto autenticado (sesión Cognito cacheada de dev) + mobile UA (el wizard es mobile-first).
    const ctx = await browser.newContext({ baseURL: config.feBaseUrl, userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (/error|form|schema/i.test(m.text())) console.log('  [browser]', m.text().slice(0, 160)); });

    // 3) Salto directo al formulario dinámico. Flow = SELF-SERVICE (el que llena el CLIENTE): es público
    //    (public-layout solo acepta ecommerce|self-service; 'merchant' rebota a "/"). No necesita sesión.
    const url = `${config.feBaseUrl}/self-service/${HASH}/${ur}/additional-info/6`;
    console.log('>>> navegando a', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch((e) => console.log('  goto:', String(e).slice(0, 120)));
    await page.waitForTimeout(3000);

    // 4) Diagnóstico: ¿renderizó el form, o rebotó (login/otp/solicitar)?
    console.log('>>> URL final:', page.url());
    const txt = await page.locator('body').innerText().catch(() => '');
    console.log('>>> TEXTO visible (400):', txt.replace(/\s+/g, ' ').slice(0, 400));
    console.log('>>> ¿"nacimiento" en pantalla?', /nacimiento/i.test(txt));
    console.log('>>> #selects:', await page.locator('select, [role=combobox], [role=listbox]').count().catch(() => -1));

    await page.screenshot({ path: '.auth/credifamilia-form.png', fullPage: true });
    console.log('>>> screenshot: .auth/credifamilia-form.png');

    // 5) DEMO de la cascada: elegir "Departamento de nacimiento" → "Ciudad de nacimiento" se puebla con
    //    las ciudades de ESE departamento (vía related_field_id=183). Prueba que el campo 233 no es decorativo.
    const optionsOf = async (nth: number) =>
        (await page.locator('select').nth(nth).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t && !/^selecciona/i.test(t));
    console.log('>>> Ciudad de nacimiento ANTES (sin depto):', JSON.stringify((await optionsOf(1)).slice(0, 5)));
    await page.locator('select').nth(0).selectOption({ label: 'Antioquia' }).catch((e) => console.log('  selectOption depto:', String(e).slice(0, 120)));
    await page.waitForTimeout(1500);
    console.log('>>> Ciudad de nacimiento DESPUÉS (Antioquia):', JSON.stringify((await optionsOf(1)).slice(0, 8)));
    await page.locator('select').nth(1).scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: '.auth/credifamilia-cascade.png', fullPage: true });
    console.log('>>> screenshot cascada: .auth/credifamilia-cascade.png');
    await ctx.close();
});

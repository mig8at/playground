// uso: node back-link.mjs '<url de checkout>' → recorre checkout → OTP 0000 → listado y dice si sale «Volver a la tienda» y a dónde
import { createRequire } from 'node:module';
const require = createRequire('/Users/miguelochoa/Desktop/CREDITOP/playground/harness/package.json');
const { chromium } = require('@playwright/test');
const url = process.argv[2];
const { installAutofill } = await import('/Users/miguelochoa/Desktop/CREDITOP/playground/harness/pkg/autofill.ts');
const browser = await chromium.launch();
const context = await browser.newContext();
await installAutofill(context);
const page = await context.newPage();
try {
  await page.goto(url);
  // avanza pantalla por pantalla hasta el listado: el OTP con el código de prueba, la confirmación de cupo con «No»,
  // y lo demás lo llena el autorrelleno del harness
  for (let i = 0; i < 15 && !/lenders/.test(page.url()); i++) {
    await page.waitForTimeout(2000);
    if (/lenders/.test(page.url())) break;
    if (/otp/.test(page.url())) {
      const box = page.locator('input').first();
      if (await box.isVisible().catch(() => false)) await box.fill('0000').catch(() => {});
    }
    const no = page.getByRole('radio', { name: 'No' });
    if (await no.isVisible().catch(() => false) && !(await no.isChecked().catch(() => true))) await no.check().catch(() => {});
    const btn = page.getByRole('button', { name: /^(Continuar|Siguiente|Iniciar solicitud|Confirmar)$/ }).last();
    if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
  }
  await page.waitForURL(/lenders/, { timeout: 60000 });
  // el listado consulta las entidades en vivo: se espera a que deje de cargar
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const links = await page.locator('a', { hasText: 'Volver a la tienda' }).evaluateAll(as => as.map(a => a.getAttribute('href')));
  const aviso = await page.getByText('No encontramos una opción para ti').count();
  const shot = process.argv[3];
  if (shot) await page.screenshot({ path: shot, fullPage: true });
  console.log(JSON.stringify({ listado: page.url(), aviso_sin_opciones: aviso > 0, volver_a_la_tienda: links }));
} catch (e) {
  await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ error: e.message.split('\n')[0], en: page.url() }));
  process.exitCode = 1;
} finally {
  await browser.close();
}

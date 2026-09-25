import { expect, test } from "@playwright/test";
import { contractForSpec } from "../pkg/ecommerce";
import { Flow } from "../pkg/flow";
import { fillEmploymentInfo, fillExpeditionDate } from "../pkg/wizard-steps";

/**
 * DEMO VISUAL (no es validación): recorre el flujo ecommerce LENTO y headed hasta /personal-info
 * usando un contrato con billing REAL, para ver el prefill (autocompletado de facturación).
 * NO re-escribe los campos que vienen del JSON (nombre/apellido/email/documento): solo los muestra.
 */


// Headed + lento para poder observar cada acción.
test.use({ headless: false, launchOptions: { slowMo: 650 } });

function freshPhone(): string {
      const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
      return `305${suffix}`;
}

/*
 * El contrato sale de `pkg/ecommerce.ts` (del REPO). Antes lo generaba `php /tmp/gen_demo.php`: un
 * script fuera del repo, en un directorio que el sistema limpia, y que además exigía `php` instalado en
 * la máquina. El spec moría en el paso 1 con «Command failed: php /tmp/gen_demo.php» — un mensaje que
 * no dice que el problema es el generador y no el producto. Es el mismo defecto que ya se corrigió en
 * `ecommerce-notify` y `ecommerce-no-cookie`; éste quedó afuera y se arregló el 2026-09-14.
 *
 * El del repo resuelve el comercio contra la BASE (nada de hashes quemados) y usa un `order_key` ÚNICO
 * por corrida, así que cada run crea una fila fresca en vez de reusar la misma.
 */
async function buildCheckoutPath(phone?: string): Promise<string> {
      const c = await contractForSpec('amoblar', phone ? { phone } : {});
      return c.checkout_path;
}

test("DEMO prefill: checkout → amount → phone → OTP → /personal-info (muestra autocompletado)", async ({ page }) => {
      test.setTimeout(240_000);
      const phone = freshPhone();

      await new Flow("Demo prefill ecommerce (lento)", "no re-escribe los campos del JSON; pausa en personal-info").
            step("Handshake checkout", "contrato con billing real → /ecommerce/{hash}/checkout", async () => {
                  await page.goto(await buildCheckoutPath(phone));
                  // react-scan: se OBSERVA, no se exige. Esta comprobación tiraba el demo entero con
                  // «react-scan se cargó bajo automatización (debería estar desactivado)», y el wizard
                  // nunca prometió eso: la guarda es `if (import.meta.env.DEV)` en `entry.client.tsx`,
                  // sin ninguna condición sobre automatización, y `git log -S webdriver` sobre ese
                  // archivo no devuelve NADA — la guarda que el spec daba por hecha no existió nunca.
                  // Verificado el 2026-09-14. Este archivo además es un DEMO VISUAL, no una validación:
                  // abortarlo por esto es perder el demo por una expectativa inventada.
                  //
                  // Se deja el dato porque sí cuesta algo: el script viene de unpkg.com, así que cada
                  // corrida con `pnpm dev` sale a internet y repinta lo que mida el demo.
                  const scan = await page.locator('script[src*="react-scan"]').count();
                  return `${scan > 0 ? "react-scan ON (normal en `pnpm dev`)" : "react-scan OFF"} · ${new URL(page.url()).pathname}`;
            })
            .step("Monto (BLOQUEADO)", "viene del base64: prellenado y bloqueado, no se escribe", async () => {
                  // Por TESTID y no por copy: el botón se llamó «activar mi crédito» hasta la rama de
                  // junio y hoy dice «Iniciar solicitud» (medido contra qa el 2026-09-14). El rol queda
                  // de respaldo con los dos textos, porque el copy puede venir del comercio.
                  const activate = page
                        .getByTestId("amount-submit")
                        .or(page.getByRole("button", { name: /iniciar solicitud|activar mi cr[ée]dito|continuar/i }));
                  await expect(activate).toBeVisible({ timeout: 20_000 });
                  // «Confirmación de cupo» (omit-Experian) es OBLIGATORIO donde aparece: sin contestarlo
                  // el submit nace deshabilitado y el paso muere aunque el prefill esté perfecto.
                  const quota = page.getByRole("radio", { name: "No", exact: true });
                  if (await quota.isVisible().catch(() => false)) await quota.click();
                  await expect(activate).toBeEnabled({ timeout: 10_000 }); // prefill válido → botón habilitado
                  await page.waitForTimeout(2_000); // pausa para ver el monto bloqueado
                  await activate.click();
                  return "monto prellenado + bloqueado → Activar";
            })
            .step("Teléfono (BLOQUEADO)", "viene del base64: prellenado y bloqueado, no se escribe", async () => {
                  const proceed = page.getByRole("button", { name: /continuar/i });
                  await expect(proceed).toBeVisible({ timeout: 20_000 });
                  await expect(proceed).toBeEnabled({ timeout: 10_000 });
                  await page.waitForTimeout(2_000); // pausa para ver el teléfono bloqueado
                  await proceed.click();
                  await page.waitForURL(/\/otp(\?|$)/, { timeout: 20_000 });
                  return "teléfono prellenado + bloqueado → Continuar";
            })
            .step("OTP", "driver fake: cualquier código de 4 dígitos", async () => {
                  await page.waitForTimeout(1_500);
                  const otpFields = page.locator('input:not([type="hidden"])');
                  await otpFields.first().click();
                  await page.keyboard.type("1234", { delay: 250 });
                  // El OTP suele auto-enviar al completar los 4 dígitos; el click es best-effort.
                  const otpSubmit = page.getByRole("button", { name: /validar|continuar|confirmar|verificar|enviar/i });
                  await otpSubmit
                        .first()
                        .click({ timeout: 4_000 })
                        .catch(() => {});
                  return "OTP 1234";
            })
            .step("Identificación (BLOQUEADA)", "campos del comercio readOnly; no se tocan, solo Siguiente", async () => {
                  await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 25_000 });
                  await page.waitForTimeout(2_000);
                  // Reporta lo autocompletado/bloqueado (sin tocar nada).
                  const values: Record<string, string> = {};
                  for (const box of await page.locator("input:not([type=hidden])").all()) {
                        const name = (await box.getAttribute("name")) || (await box.getAttribute("id")) || "?";
                        const val = await box.inputValue().catch(() => "");
                        const ro = (await box.getAttribute("readonly")) !== null;
                        if (val) values[name] = val + (ro ? " [BLOQUEADO]" : " [editable]");
                  }
                  console.log("PREFILL_VISTO=" + JSON.stringify(values));
                  await page.waitForTimeout(3_000); // pausa para ver los campos bloqueados
                  await page.getByRole("button", { name: /siguiente/i }).click();
                  return `bloqueados: ${JSON.stringify(values)}`;
            })
            .step("Fecha de expedición (MANUAL)", "el cliente la edita a mano (no viene del comercio)", async () => {
                  // ⚠ ACÁ TERMINA LO QUE ESTE DEMO PUEDE MOSTRAR, y no es un fallo del producto: los
                  // seis testids del selector de fecha (`date-selector-*`) NO existen en ninguna rama
                  // mergeada — medido contra qa el 2026-09-14, el wizard tiene CUATRO testids en total.
                  // El demo ya cumplió su propósito en el paso anterior (se vio el prefill del comercio
                  // llegando bloqueado), así que se corta acá con el motivo a la vista en vez de morir
                  // con un `toBeVisible() failed` que parece un problema de la pantalla.
                  if (!(await page.getByTestId("date-selector-day").count())) {
                        return "hasta acá llega el demo: el selector de fecha no tiene testids en qa "
                              + "(ver la cabecera de pkg/wizard-steps.ts) · para el flujo completo: make harness-walk-wizard";
                  }
                  await fillExpeditionDate(page);
                  return "fecha de expedición ingresada manualmente";
            })
            .step("Datos laborales (MANUAL, si aplica)", "edición manual hasta lenders", async () => {
                  // Si el paso anterior se cortó, seguimos en personal-info: se dice y no se espera 30 s.
                  if (/personal-info/.test(page.url())) return "omitido: el demo se detuvo en personal-info";
                  await page.waitForURL(/\/(employment-info|lenders)(\?|$)/, { timeout: 30_000 });
                  if (!/\/employment-info/.test(page.url())) return "omitido (no aplica)";
                  await fillEmploymentInfo(page, { status: "Empleado", monthlyIncome: "2500000" });
                  return "datos laborales ingresados manualmente";
            })
            .step("/lenders", "aterriza en el marketplace", async () => {
                  if (/personal-info/.test(page.url())) return "omitido: el demo se detuvo en personal-info";
                  await page.waitForURL(/\/lenders(\?|$)/, { timeout: 30_000 });
                  await page.waitForTimeout(4_000); // pausa para ver el marketplace
                  return page.url();
            })
            .run();
});

import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Flow } from "../pkg/flow";
import { fillEmploymentInfo, fillExpeditionDate } from "../pkg/wizard-steps";

/**
 * DEMO VISUAL (no es validación): recorre el flujo ecommerce LENTO y headed hasta /personal-info
 * usando un contrato con billing REAL, para ver el prefill (autocompletado de facturación).
 * NO re-escribe los campos que vienen del JSON (nombre/apellido/email/documento): solo los muestra.
 */

const GEN = process.env.GEN_SCRIPT ?? "/tmp/gen_demo.php"; // contrato con billing real

// Headed + lento para poder observar cada acción.
test.use({ headless: false, launchOptions: { slowMo: 650 } });

function freshPhone(): string {
      const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
      return `305${suffix}`;
}

function buildCheckoutPath(): string {
      const out = execFileSync("php", [GEN], { encoding: "utf8" }).trim();
      const m = out.match(/https?:\/\/[^\s]+\/ecommerce\/[^\s]+/);
      if (!m) throw new Error(`No pude extraer la URL de checkout: ${out.slice(0, 200)}`);
      const url = new URL(m[0]);
      return url.pathname + url.search;
}

test("DEMO prefill: checkout → amount → phone → OTP → /personal-info (muestra autocompletado)", async ({ page }) => {
      test.setTimeout(240_000);
      const phone = freshPhone();

      await new Flow("Demo prefill ecommerce (lento)", "no re-escribe los campos del JSON; pausa en personal-info").
            step("Handshake checkout", "contrato con billing real → /ecommerce/{hash}/checkout", async () => {
                  await page.goto(buildCheckoutPath());
                  // react-scan no debe cargar bajo automatización.
                  const scan = await page.locator('script[src*="react-scan"]').count();
                  if (scan > 0) throw new Error("react-scan se cargó bajo automatización (debería estar desactivado)");
                  return `react-scan OFF · ${new URL(page.url()).pathname}`;
            })
            .step("Monto (BLOQUEADO)", "viene del base64: prellenado y bloqueado, no se escribe", async () => {
                  const activar = page.getByRole("button", { name: /activar mi cr[ée]dito/i });
                  await expect(activar).toBeVisible({ timeout: 20_000 });
                  await expect(activar).toBeEnabled({ timeout: 10_000 }); // prefill válido → botón habilitado
                  await page.waitForTimeout(2_000); // pausa para ver el monto bloqueado
                  await activar.click();
                  return "monto prellenado + bloqueado → Activar";
            })
            .step("Teléfono (BLOQUEADO)", "viene del base64: prellenado y bloqueado, no se escribe", async () => {
                  const continuar = page.getByRole("button", { name: /continuar/i });
                  await expect(continuar).toBeVisible({ timeout: 20_000 });
                  await expect(continuar).toBeEnabled({ timeout: 10_000 });
                  await page.waitForTimeout(2_000); // pausa para ver el teléfono bloqueado
                  await continuar.click();
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
                  await fillExpeditionDate(page);
                  return "fecha de expedición ingresada manualmente";
            })
            .step("Datos laborales (MANUAL, si aplica)", "edición manual hasta lenders", async () => {
                  await page.waitForURL(/\/(employment-info|lenders)(\?|$)/, { timeout: 30_000 });
                  if (!/\/employment-info/.test(page.url())) return "omitido (no aplica)";
                  await fillEmploymentInfo(page, { status: "Empleado", monthlyIncome: "2500000" });
                  return "datos laborales ingresados manualmente";
            })
            .step("/lenders", "aterriza en el marketplace", async () => {
                  await page.waitForURL(/\/lenders(\?|$)/, { timeout: 30_000 });
                  await page.waitForTimeout(4_000); // pausa para ver el marketplace
                  return page.url();
            })
            .run();
});

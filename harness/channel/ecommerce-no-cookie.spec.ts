import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Flow } from "../pkg/flow";

/**
 * Ecommerce STATELESS (no-cookie) — valida la mejora de la rama:
 *   feature/onboarding/ecommerce-web-origination (FE) + feat/onboarding/ecommerce-stateless-detail (BE).
 *
 * El estado de ecommerce ya NO depende del cookie SSR: la llave (ecommerce_request id) viaja en la
 * URL (?erId=) pre-OTP, y post-OTP se resuelve por loan_request_id (endpoint by-user-request).
 *
 * Este test BORRA el cookie `_session` justo tras el checkout (simula un navegador/webview que lo
 * dropea) y aseveramos que el flujo igual:
 *   1) llega a /personal-info, y
 *   2) creó el link user_request ↔ ecommerce_request (anclaje del webhook) — vía erId-en-URL, sin cookie.
 */

const GEN_SCRIPT =
      process.env.GEN_SCRIPT ?? "/Users/miguelochoa/Desktop/CREDITOP/github/generate_checkout_url.php";
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "legacy-backend-mysql-1";
const DB_NAME = process.env.E2E_DB_NAME ?? "creditop";

function freshPhone(): string {
      const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
      return `305${suffix}`;
}

function buildCheckoutPath(): string {
      const out = execFileSync("php", [GEN_SCRIPT], { encoding: "utf8" }).trim();
      const match = out.match(/https?:\/\/[^\s]+\/ecommerce\/[^\s]+/);
      if (!match) throw new Error(`No pude extraer la URL de checkout: ${out.slice(0, 200)}`);
      const url = new URL(match[0]);
      return url.pathname + url.search;
}

function queryLinkCount(userRequestId: string): number {
      const out = execFileSync(
            "docker",
            [
                  "exec", DB_CONTAINER,
                  "mysql", "-ucreditop", "-ppassword", DB_NAME, "-N", "-B",
                  "-e", `SELECT COUNT(*) FROM user_requests_by_ecommerce_request WHERE user_request_id=${Number(userRequestId)};`,
            ],
            { encoding: "utf8" },
      ).trim();
      return Number(out || "0");
}

test("Ecommerce sin cookie: /checkout → (borra _session) → phone → OTP → /personal-info + link creado", async ({ page }) => {
      test.setTimeout(120_000);
      const phone = freshPhone();

      await new Flow(
            "Ecommerce stateless (no-cookie)",
            "borra _session tras checkout; el flujo vive de erId-en-URL + by-user-request",
      )
            .step("Handshake checkout", "genera URL real → /ecommerce/{hash}/checkout?o=...", async () => {
                  const path = buildCheckoutPath();
                  await page.goto(path);
                  // El checkout ya redirigió a /solicitar?amount&erId y seteó _session. Lo BORRAMOS:
                  await page.context().clearCookies({ name: "_session" });
                  const url = new URL(page.url());
                  expect(url.searchParams.get("erId"), "erId debe viajar en la URL").toBeTruthy();
                  return `erId=${url.searchParams.get("erId")} · cookie _session borrado`;
            })
            .step("Monto", "prellenado del order + bloqueado; solo se confirma", async () => {
                  const activar = page.getByRole("button", { name: /activar mi cr[ée]dito/i });
                  await expect(activar).toBeEnabled({ timeout: 20_000 });
                  await page.context().clearCookies({ name: "_session" });
                  await activar.click();
                  return "monto prellenado + bloqueado (sin cookie)";
            })
            .step("Teléfono", "register persiste OTP; sin cookie, erId va en la URL", async () => {
                  const phoneBox = page.getByRole("textbox", { name: /celular|tel[ée]fono|n[úu]mero/i });
                  await expect(phoneBox).toBeVisible({ timeout: 20_000 });
                  await phoneBox.click();
                  await phoneBox.pressSequentially(phone, { delay: 30 });
                  await page.context().clearCookies({ name: "_session" });
                  await page.getByRole("button", { name: /continuar|siguiente|enviar|activar/i }).click();
                  await page.waitForURL(/\/otp(\?|$)/, { timeout: 20_000 });
                  const url = new URL(page.url());
                  expect(url.searchParams.get("erId"), "erId debe seguir en la URL del OTP").toBeTruthy();
                  return `teléfono ${phone} · erId en URL del OTP`;
            })
            .step("OTP", "driver fake valida cualquier código; anclaje vía erId-en-URL", async () => {
                  await page.waitForTimeout(2_000);
                  await page.context().clearCookies({ name: "_session" });
                  const otpFields = page.locator('input:not([type="hidden"])');
                  await otpFields.first().click();
                  await page.keyboard.type("1234", { delay: 60 });
                  const otpSubmit = page.getByRole("button", { name: /validar|continuar|confirmar|verificar|enviar/i });
                  if (await otpSubmit.count()) await otpSubmit.first().click();
                  return "OTP 1234 (sin cookie)";
            })
            .step("/personal-info + link", "llega sin cookie y el link del webhook quedó creado", async () => {
                  await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 25_000 });
                  const m = new URL(page.url()).pathname.match(/\/(\d+)\/personal-info/);
                  expect(m, "loan_request_id en la URL de personal-info").toBeTruthy();
                  const loanRequestId = m![1];
                  // Prueba dura: con _session borrado, el link igual se creó (anclaje por erId-en-URL).
                  await expect
                        .poll(() => queryLinkCount(loanRequestId), { timeout: 8_000 })
                        .toBeGreaterThan(0);
                  return `/personal-info (ur ${loanRequestId}) · link user_request↔ecommerce_request ✓`;
            })
            .run();
});

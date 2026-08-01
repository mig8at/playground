import type { Page, Route } from '@playwright/test';

/**
 * Helpers para inyectar escenarios fake en el backend (legacy-backend en modo mock)
 * desde un test. (El viejo mock-server :4000 de validation-driven fue eliminado.)
 *
 * Hay dos formas de driver escenarios contra el backend:
 *
 * 1. Header `X-Fake-Scenario` por request. El FE NO envía este header
 *    nativamente. Por eso usamos `page.route(...)` para interceptar las
 *    requests del FE al backend y agregarles el header on-the-fly.
 *    Cuando el contrato del backend agregue soporte server-side para esto
 *    (vía middleware, query param, etc.), podemos simplificar.
 *
 * 2. Reset de estado del mock — la BD del mock se llena entre tests. Para
 *    aislamiento usamos docs/teléfonos únicos por test. (Si el mock expone
 *    un endpoint /reset en el futuro, lo llamamos aquí.)
 */

/**
 * Hace que TODAS las requests del browser lleven el header
 * `X-Fake-Scenario: <scenario>` — tanto calls directos al backend como
 * form POSTs al FE server (react-router actions).
 *
 * Por qué intercepta `**\/*` y no solo el backend:
 *   - El wizard tiene SSR. Las acciones (`<Form method=post>`) postean al FE
 *     server (localhost:5174), que hace el fetch al backend desde Node.
 *   - Si solo interceptáramos calls al backend (`localhost/api/**`), el
 *     form POST nunca llevaría el header → el FE no lo forwardea al backend.
 *   - Con `**\/*` el header llega al FE server, que (en APP_ENV=local) lo
 *     forwardea al backend vía `buildBackendAuthHeaders`.
 *
 * @example
 *   await injectFakeScenario(page, 'expired', 'http://localhost');
 *   await page.goto('/loan-application-form/otp-verification');
 *   // todas las llamadas (FE→backend incluído) incluyen X-Fake-Scenario: expired
 */
export async function injectFakeScenario(
    page: Page,
    scenario: string,
    _mockUrl: string,
): Promise<void> {
    void _mockUrl; // legacy param, no longer needed para el matcher
    await page.route('**/*', async (route: Route) => {
        const headers = {
            ...route.request().headers(),
            'x-fake-scenario': scenario,
        };
        await route.continue({ headers });
    });
}

/**
 * Genera un identificador único para evitar colisiones de estado en el mock
 * (mismo número de documento ya registrado, mismo teléfono con OTP previo,
 * etc.). Cada test usa su propio sufijo y queda aislado.
 */
export function uniqueSuffix(): string {
    return Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
}

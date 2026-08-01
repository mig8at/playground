import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Creditop frontend E2E suite.
 *
 * Diseño:
 *   - El FE corre en localhost:5174 (Vite dev server de loan-request-wizard).
 *   - El backend corre en localhost (legacy-backend en modo mock; el viejo
 *     mock-server :4000 de validation-driven fue ELIMINADO).
 *   - Tests asumen que AMBOS están levantados antes de correr.
 *
 * Para CI: los webServers se pueden levantar automáticamente desconmentando
 * el bloque `webServer` al final del archivo.
 *
 * Variables de entorno relevantes:
 *   E2E_BASE_URL          — URL del frontend (default http://localhost:5174)
 *   E2E_MOCK_URL          — URL del backend en modo mock (default http://localhost)
 *   E2E_PARTNER_HASH      — hash del aliado para entrar al flujo (default 3e67eade)
 *
 * Estrategia de selectores: usar `getByRole`, `getByLabel`, `getByText` siempre
 * que se pueda. Evitar selectores CSS/XPath frágiles. Si el FE no tiene roles
 * accesibles, agregar `data-testid` y referenciarlo aquí.
 */
export default defineConfig({
  // Organizado por ejes en la raíz (espejo de backend-e2e): channel/ merchant/ lender/ e2e/ + pkg/ (infra).
  testDir: '.',
  // _scratch/ son specs manuales/experimentales (dev-*); node_modules/reportes no llevan specs.
  testIgnore: ['**/_scratch/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Habilitar firefox/webkit cuando el suite esté estable en chromium.
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
  ],

  // Para CI: descomentar para que Playwright levante el backend + FE automáticamente.
  // (El mock-server :4000 de validation-driven fue eliminado; el backend es el
  //  legacy-backend en modo mock, que se levanta con make — no con npm.)
  // webServer: [
  //   {
  //     command: 'cd ../../github/legacy-backend && make up && make mock-all',
  //     url: 'http://localhost',
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 120_000,
  //   },
  //   {
  //     command: 'cd ../frontend-monorepo/apps/loan-request-wizard && npm run dev',
  //     url: 'http://localhost:5174',
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 60_000,
  //   },
  // ],
});

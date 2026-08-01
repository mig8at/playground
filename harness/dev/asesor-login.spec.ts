import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, cognitoCreds } from '../pkg/config';
import { cognitoLogin } from '../pkg/cognito';
import { openA } from '../pkg/windows';

/**
 * `make auto asesor <merchant>` — login de ASESOR contra el wizard apuntando al backend de DEV.
 *
 * Orquestado por bin/asesor: arranca el wizard local (:5174) con su `.env` BASE (config dev →
 * VITE_API_URL=legacy-backend.inertia-develop, que resuelve por VPN) y CALLBACK_URL=localhost:5174.
 * Este spec entra a /merchant/{hash}/solicitar, deja que `requireUser` redirija al Hosted UI de
 * Cognito (login.creditop.com, REAL/dev), completa usuario+contraseña (.cognito.json) y verifica
 * que VOLVIMOS a la app (login OK, no seguimos en el dominio de Cognito).
 *
 * El login es independiente del backend (Cognito público + el server del propio wizard); que el
 * comercio cargue su data en dev (asociación del asesor a la sucursal) es el SIGUIENTE paso.
 *
 * Artefactos (gitignored): .auth/asesor-dev-state.json (storageState reusable) + screenshot.
 */

const HASH = process.env.E2E_ASESOR_HASH ?? config.partnerHash;
const ENTRY = `/merchant/${HASH}/solicitar`;

test.skip(!cognitoCreds.user || !cognitoCreds.pass, 'asesor login: requiere .cognito.json {user,pass}');

test('asesor login (dev)', async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await openA(browser, { baseURL: config.feBaseUrl }); // 1 ventana → A (vía openA; no fixture page+PREVIEW_VP: choca con deviceScaleFactor)

    // 1. Entrar al espacio /merchant/* (exige sesión) → requireUser redirige a Cognito.
    await page.goto(ENTRY);

    // 2. Completar el Hosted UI real (agnóstico al idioma); vuelve a localhost:5174 tras el callback.
    await cognitoLogin(page);

    // 3. Aterrizaje: capturar dónde quedamos tras el callback.
    await page.waitForLoadState('networkidle').catch(() => {});
    const url = page.url();

    const authDir = join(process.cwd(), '.auth');
    mkdirSync(authDir, { recursive: true });
    await page.context().storageState({ path: join(authDir, 'asesor-dev-state.json') });
    await page.screenshot({ path: join(authDir, 'asesor-dev-landing.png'), fullPage: true }).catch(() => {});

    // Login OK = volvimos a la app (ya NO estamos en el dominio de Cognito).
    expect(url, 'tras el login deberíamos volver al wizard, no quedar en Cognito').not.toMatch(
        /login\.creditop\.com|amazoncognito\.com/,
    );
    console.log(`ASESOR_LANDING_URL=${url}`);

    // ¿El asesor tiene comercio asignado? (el backend de dev resuelve la asociación por cognito_id).
    const noComercio = await page
        .getByText(/no tienes un comercio asignado/i)
        .isVisible()
        .catch(() => false);
    const onWizard = /\/(merchant)\/[^/]+\/(solicitar|.*)/.test(url) && !noComercio;
    if (noComercio) {
        console.log('⚠ LOGIN OK contra dev, pero el asesor NO tiene comercio asignado.');
        console.log('  → falta asociar este cognito_id a la sucursal del comercio en DEV (paso siguiente).');
    } else if (onWizard) {
        console.log('✓ login OK + comercio cargado · entró al wizard del asesor.');
    } else {
        console.log(`✓ login OK · aterrizó en ${url}`);
    }
    console.log('  estado guardado: .auth/asesor-dev-state.json (reusable) · .auth/asesor-dev-landing.png');

    // Modo MONTO manual (bin/asesor <merchant>, sin 2º posicional): dejamos el navegador ABIERTO en
    // /solicitar para que el humano escriba el monto y siga a mano. page.pause() abre el Playwright
    // Inspector y mantiene la sesión viva hasta que se le da "Resume" (▶). En headless es no-op.
    if (process.env.E2E_PAUSE === '1') {
        console.log('⏸  Listo en MONTO. Seguí a mano en el navegador; "Resume" (▶) en el Inspector para cerrar.');
        await page.pause();
    }
});

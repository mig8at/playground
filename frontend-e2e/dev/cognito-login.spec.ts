import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cognitoCreds } from '../pkg/config';

/**
 * Login por NAVEGADOR contra el Cognito Hosted UI REAL (login.creditop.com) — probe + artefacto reusable.
 *
 * Qué hace (NO requiere levantar el wizard):
 *   1. Abre el Hosted UI directo (con --headed ves el navegador real).
 *   2. Completa usuario → Siguiente → contraseña → Continuar (mismos selectores que pkg/cognito.ts).
 *   3. Intercepta el request del callback (/auth/callback?code=…) para capturar el `code`
 *      — funciona aunque :5174 NO esté arriba, porque lee el request antes de que la navegación falle.
 *   4. Intercambia el code por tokens en /oauth2/token (app client confidencial → Basic auth).
 *   5. Guarda artefactos reusables en .auth/ (gitignored):
 *        - dev-tokens.json    → { id_token, access_token, … } usable como `Authorization: Bearer` en tests BE/API.
 *        - cognito-state.json → storageState (sesión Cognito) reusable en tests de UI.
 *
 * Auto-SKIP salvo que estén las credenciales dev → NO corre en la suite normal.
 *
 * Correr (headed):
 *   set -a; source ../backend-e2e/.env.dev.local; set +a    # E2E_COGNITO_CLIENT_ID/SECRET (+ .cognito.json)
 *   npx playwright test dev/cognito-login.spec.ts --headed --project=chromium
 *
 * Config por env: E2E_COGNITO_CLIENT_ID (req), E2E_COGNITO_CLIENT_SECRET (req · client confidencial),
 *   E2E_COGNITO_DOMAIN (default login.creditop.com), E2E_COGNITO_REDIRECT (default .../auth/callback),
 *   E2E_COGNITO_SCOPE (default 'openid email'). user/pass: env o frontend-e2e/.cognito.json.
 *   Secretos NUNCA se commitean.
 */

const clientId = process.env.E2E_COGNITO_CLIENT_ID ?? '';
const clientSecret = process.env.E2E_COGNITO_CLIENT_SECRET ?? '';
const domain = process.env.E2E_COGNITO_DOMAIN ?? 'login.creditop.com';
const redirectUri = process.env.E2E_COGNITO_REDIRECT ?? 'http://localhost:5174/auth/callback';
const scope = process.env.E2E_COGNITO_SCOPE ?? 'openid email';

test.skip(
    !cognitoCreds.user || !clientId || !clientSecret,
    'login dev: requiere .cognito.json {user,pass} + E2E_COGNITO_CLIENT_ID/SECRET',
);

test('login Cognito Hosted UI (dev) → captura tokens reusables', async ({ page, request }) => {
    const authorizeUrl =
        `https://${domain}/oauth2/authorize?` +
        new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope }).toString();

    // 1-2. Abrir Hosted UI y completar credenciales (dos pasos: usuario → contraseña).
    // Botones agnósticos al idioma: este client (dev) renderiza Managed Login en INGLÉS
    // ("Next"/"Sign in"); el client merchant lo hace en español ("Siguiente"/"Continuar").
    await page.goto(authorizeUrl);
    await expect(page.locator('input[name=username]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[name=username]').fill(cognitoCreds.user!);
    await page.getByRole('button', { name: /siguiente|next/i }).click();
    await expect(page.locator('input[name=password]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[name=password]').fill(cognitoCreds.pass!);

    // 3. Capturar el `code` del redirect al callback (no depende de que :5174 responda).
    const [cbReq] = await Promise.all([
        page.waitForRequest((r) => r.url().includes('/auth/callback'), { timeout: 30_000 }),
        page.getByRole('button', { name: /continuar|continue|sign in|iniciar/i }).click(),
    ]);
    const code = new URL(cbReq.url()).searchParams.get('code');
    expect(code, 'el callback debería traer ?code=').toBeTruthy();

    // 4. Intercambiar code → tokens (client confidencial: client_id:client_secret en Basic auth).
    const tokenRes = await request.post(`https://${domain}/oauth2/token`, {
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        form: { grant_type: 'authorization_code', client_id: clientId, code: code!, redirect_uri: redirectUri },
    });
    expect(tokenRes.ok(), `token endpoint ${tokenRes.status()}: ${await tokenRes.text()}`).toBeTruthy();
    const tokens = await tokenRes.json();
    expect(tokens.id_token, 'la respuesta debería traer id_token').toBeTruthy();

    // 5. Guardar artefactos reusables (gitignored).
    const authDir = join(process.cwd(), '.auth');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, 'dev-tokens.json'), JSON.stringify(tokens, null, 2));
    await page.context().storageState({ path: join(authDir, 'cognito-state.json') });

    // 6. Mostrar las claims del IdToken (decodificadas, sin verificar firma — solo para el probe).
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
    console.log('✓ login OK · claims:', {
        sub: claims.sub,
        email: claims.email,
        username: claims['cognito:username'],
        exp: new Date(claims.exp * 1000).toISOString(),
    });
    console.log('  artefactos: .auth/dev-tokens.json (Bearer) · .auth/cognito-state.json (storageState)');
});

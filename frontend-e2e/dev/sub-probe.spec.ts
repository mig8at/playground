import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { cognitoCreds } from '../pkg/config';

/**
 * Captura el SUB REAL del login de dev (lo que el wizard manda como x-cognito-identity-id), vía OAuth
 * PKCE directo contra el Hosted UI (sin client secret). Sirve para confirmar que el cognito_id de la
 * fila users coincide con el sub del token. Creds por env o .cognito.json.
 */
const DOMAIN = process.env.E2E_COGNITO_DOMAIN ?? 'login.creditop.com';
const CLIENT_ID = process.env.E2E_COGNITO_CLIENT_ID || '14lo4ra4khrdaomd78f0sqh2l4';
const REDIRECT = process.env.E2E_COGNITO_REDIRECT ?? 'http://localhost:5174/auth/callback';
const USER = process.env.E2E_COGNITO_USER ?? cognitoCreds.user ?? '';
const PASS = process.env.E2E_COGNITO_PASS ?? cognitoCreds.pass ?? '';

test.skip(!USER || !PASS, 'sub-probe: requiere creds (.cognito.json o env)');

const b64url = (buf: Buffer) => buf.toString('base64url');

test('sub-probe: sub real del token (PKCE, sin secret)', async ({ page, request }) => {
    test.setTimeout(60_000);
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const authorizeUrl =
        `https://${DOMAIN}/oauth2/authorize?` +
        new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT,
            scope: 'openid email',
            code_challenge: challenge,
            code_challenge_method: 'S256',
        }).toString();

    await page.goto(authorizeUrl);
    await page.locator('input[name=username]').fill(USER);
    await page.getByRole('button', { name: /siguiente|next/i }).click();
    await page.locator('input[name=password]').fill(PASS);
    const [cb] = await Promise.all([
        page.waitForRequest((r) => r.url().includes('/auth/callback'), { timeout: 30_000 }),
        page.getByRole('button', { name: /continuar|continue|sign\s*in/i }).click(),
    ]);
    const code = new URL(cb.url()).searchParams.get('code');
    expect(code, 'callback debe traer ?code=').toBeTruthy();

    const res = await request.post(`https://${DOMAIN}/oauth2/token`, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        form: {
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code: code!,
            redirect_uri: REDIRECT,
            code_verifier: verifier,
        },
    });
    const body = await res.json();
    expect(body.id_token, `token endpoint ${res.status()}: ${JSON.stringify(body)}`).toBeTruthy();
    const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString());
    console.log(`REAL_SUB=${claims.sub}`);
    console.log(`CLAIMS=${JSON.stringify({ sub: claims.sub, email: claims.email, username: claims['cognito:username'] })}`);
});

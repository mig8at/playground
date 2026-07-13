import { test, expect } from '@playwright/test';
import { type Triplet, runTripletToLenders, tripletFromEnv } from '../e2e/triplet';

/**
 * Suite COMPOSABLE `canal → comercio → lender` por UI — espejo del backend-e2e.
 *
 * Dos modos (como el CLI de backend `go run . <canal> <comercio> <lender>`):
 *  1. Tripleta única por env:  E2E_CHANNEL=asesor E2E_MERCHANT=<hash> [E2E_LENDER=..] npx playwright test triplet
 *  2. Matriz por defecto:      corre las tripletas conocidas-verdes de abajo.
 *
 * Hoy valida el tramo `canal → comercio → /lenders` (entrada + marketplace). El cierre del lender por UI
 * (rt=2 Creditop X) está pendiente de testids en las pantallas de cierre; ya validado en backend-e2e.
 */

// Matriz por defecto: tripletas con hash REAL verificadas que llegan a /lenders por UI (canal asesor).
const MATRIX: Triplet[] = [
    { channel: 'asesor', merchant: '3e67eade' }, // Pullman (Quanto auto-inyecta → salta employment)
    { channel: 'asesor', merchant: 'a1c0b15d' }, // Corbeta (no-temporal → salta a /lenders)
];

const envTriplet = tripletFromEnv();
const triplets = envTriplet ? [envTriplet] : MATRIX;

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 150 } });

for (const t of triplets) {
    const label = `${t.channel} → ${t.merchant}${t.lender ? ` → ${t.lender}` : ''}`;
    test(`triplet: ${label} → /lenders`, async ({ page }) => {
        test.setTimeout(60_000);
        await runTripletToLenders(page, t);
        expect(page.url()).toMatch(/\/lenders/);
        expect(page.url()).toContain(t.merchant);
    });
}

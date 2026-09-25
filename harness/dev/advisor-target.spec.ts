import { test, expect } from '@playwright/test';
import { config } from '../pkg/config';
import { cognitoStorageState } from '../pkg/cognito';
import { IPHONE_UA, openA } from '../pkg/windows';
import { chooseEntity } from '../pkg/wizard-browser';

/**
 * asesor-destino — ¿A DÓNDE MANDA EL FRONT al elegir una entidad, en el canal del ASESOR?
 *
 * Contesta una sola pregunta y no recorre el flujo: abre `/merchant/<hash>/<ureq>/lenders` con la
 * sesión de asesor cacheada, aprieta el botón de la entidad pedida, y reporta la URL a la que la
 * aplicación llevó. Es lo que el caminador NO puede hacer cuando su siembra deja la entidad fuera
 * del listado: acá la solicitud ya viene sembrada desde afuera (`synthFill(ur, { lender })`).
 *
 * ⚠ La sesión tiene que estar viva. Si caducó:
 *   E2E_TARGET=<target> npx playwright test dev/warm-session.spec.ts --headed --project=chromium
 *
 * Correr:
 *   E2E_TARGET=qa E2E_UREQ=502397 E2E_ADVISOR_HASH=ec977139 E2E_LENDER_NAME=CrediPullman \
 *     npx playwright test dev/advisor-target.spec.ts --project=chromium
 */
const UREQ = process.env.E2E_UREQ ?? '';
const HASH = process.env.E2E_ADVISOR_HASH ?? config.partnerHash;
const NAME = process.env.E2E_LENDER_NAME ?? '';

test.skip(!UREQ || !NAME, 'asesor-destino: pide E2E_UREQ y E2E_LENDER_NAME');

test('asesor · a dónde manda el front al elegir la entidad', async ({ browser }) => {
      test.setTimeout(120_000);

      const { page } = await openA(browser, {
            baseURL: config.feBaseUrl,
            userAgent: IPHONE_UA,
            storageState: cognitoStorageState(),
      });

      const listing = `/merchant/${HASH}/${UREQ}/lenders?amount=2000000`;
      await page.goto(listing, { waitUntil: 'domcontentloaded' });

      // Si la sesión murió, el front desvía al Hosted UI y no hay nada que medir: cortar con un
      // mensaje que diga qué hacer, en vez de fallar en un selector que no existe.
      expect(page.url(), 'la sesión de asesor caducó — corré warm-session y volvé').not.toContain('/login');

      // ⚠ Se usa el helper del harness y NO un localizador propio: el primer intento con
      // `locator('div').filter(...)` clickeó un botón que no era y la selección nunca llegó a la base
      // (uReq 502397 quedó con `lender_id` NULL). `chooseEntity` ya resuelve el caso de varios
      // botones con el mismo texto, y además devuelve los que VIO, que es lo que permite explicar un
      // fallo en vez de sólo reportarlo.
      const before = page.url();
      const sel = await chooseEntity(page, NAME);
      if (!sel.ok) {
            console.log(`BOTONES VISIBLES · ${sel.visibles.join(' | ')}`);
      }
      expect(sel.ok, `no se pudo elegir ${NAME}; visibles: ${sel.visibles.join(' | ')}`).toBe(true);

      await page.waitForURL((u) => u.toString() !== before, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3_000);

      const target = new URL(page.url()).pathname + new URL(page.url()).search;
      console.log(`DESTINO · ${NAME} · uReq ${UREQ} · canal asesor → ${target}`);
});

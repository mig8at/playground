import { expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * LA PANTALLA DEL CÓDIGO DE COMPRA NO PUEDE CONTRADECIRSE A SÍ MISMA — el guardián de **F-227**.
 *
 * QUÉ PASÓ. El 2026-09-17, a las 21:43 de Bogotá, la última pantalla del canal QR —la del código que el
 * cliente presenta en caja— mostraba un contador de **22:47:15** y tres renglones abajo
 * **«(Vence hoy a las 8:30 p.m.)»**. Con 22 horas por delante no puede vencer hoy, y esa hora ya había
 * pasado. La frase era un valor POR DEFECTO de `CountdownDisplay` que ningún llamador pasaba nunca.
 *
 * POR QUÉ ESTE TEST Y NO EL UNITARIO. El arreglo trae su propio test en el monorepo, pero **ese hoy no
 * corre**: `vitest 1.6.1` es incompatible con el `vite 7/8` del lock y toda suite de esos módulos falla
 * al cargar. Este sí corre, porque mide la pantalla RENDERIZADA — que además es donde el bug vivía: el
 * backend nunca supo nada de esta frase, y por eso `qr-corbeta.ts` cerraba en verde con el recorrido
 * visual roto (es el eje de **F-88**).
 *
 * CÓMO ASEGURA SIN SABER LA REGLA DE NEGOCIO. No conoce «las 20:30 de Bogotá» ni el corrimiento al día
 * siguiente, a propósito: eso lo puede cambiar producto mañana. Compara las DOS COSAS QUE LA PANTALLA
 * MUESTRA — `ahora + contador` tiene que caer en el día y la hora que anuncia la etiqueta. Un test que
 * repitiera la regla se rompería con cada cambio de plazo; éste sólo se rompe si la pantalla se
 * contradice, que es el defecto.
 *
 * ⚠ NO SE SALTA, Y HOY FALLA CONTRA `main` Y `qa`: el arreglo está en el PR
 * `Creditop-SAS/frontend-monorepo#1028`, sin mergear. Se deja rojo a propósito —mismo criterio que la
 * suite de la sala de espera del canal ecommerce—, porque **un caso que se saltea se lee como verde**.
 * El mensaje de la aserción nombra el PR para que un rojo se lea como «falta mergear» y no como «se
 * rompió algo».
 *
 * NO camina los 14 pasos: siembra la solicitud en estado 25, emite el código y **saltа directo** a la
 * pantalla con `bancolombiaEncryptCode` (el `encryptCode` no es cifrado — ver `pkg/qr.ts`).
 */

process.env.E2E_TARGET ||= 'local';

const { exec, one, close } = await import('../pkg/db.ts');
const { config } = await import('../pkg/config.ts');
const { seedPurchaseCodeReady, bancolombiaEncryptCode } = await import('../pkg/qr.ts');

const API = config.mockUrl;
const FRONT = config.feBaseUrl.replace(/\/+$/, '');
const ZONE = 'America/Bogota';

let USER_ID = 0;
const createdOnes: number[] = [];

/** El día y la hora de un instante EN BOGOTÁ, que es la zona en que la pantalla habla. */
function inBogota(instant: number) {
      const p = new Intl.DateTimeFormat('en-CA', {
            timeZone: ZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(instant);
      const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
      return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), minuto: Number(v('minute')) };
}

test.beforeAll(async () => {
      const doc = `VTO-${Date.now()}`;
      const ins = await exec(
            `INSERT INTO users (first_name, surname, full_name, password, document_type, document_number, cell_phone, created_at, updated_at)
             VALUES ('SYNTH','VENCIMIENTO','SYNTH VENCIMIENTO','x','CC',?,?,NOW(),NOW())`,
            [doc, '3130000001'],
      ).catch(() => null);
      USER_ID = ins?.insertId ?? 0;
});

test.afterAll(async () => {
      for (const ur of createdOnes) {
            await exec('DELETE FROM user_request_additional_information WHERE user_request_id=?', [ur]).catch(() => {});
            await exec('DELETE FROM purchase_codes WHERE user_request_id=?', [ur]).catch(() => {});
            await exec('DELETE FROM lender_integration_flows WHERE user_request_id=?', [ur]).catch(() => {});
            await exec('DELETE FROM user_requests WHERE id=?', [ur]).catch(() => {});
      }
      if (USER_ID) await exec('DELETE FROM users WHERE id=?', [USER_ID]).catch(() => {});
      await close();
});

// SERIAL: escribe en la BD local y abre un navegador. No hay nada que ganar paralelizando dos casos.
test.describe.configure({ mode: 'serial' });

for (const product of ['bnpl', 'consumo'] as const) {
      test(`${product}: el contador y la fecha que anuncia dicen lo mismo`, async () => {
            test.skip(process.env.E2E_TARGET !== 'local', 'siembra en la BD: sólo local');
            test.skip(!USER_ID, 'no se pudo crear el usuario de la suite');

            const seededOne = await seedPurchaseCodeReady({ userId: USER_ID, producto: product });
            test.skip(!seededOne, 'no hay sucursal Corbeta usable para sembrar');
            if (!seededOne) return;
            createdOnes.push(seededOne.userRequestId);

            // El código tiene que existir: sin él la pantalla muestra su estado de error y no hay contador.
            await fetch(`${API}/api/onboarding/purchase-code/generate/${seededOne.userRequestId}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', accept: 'application/json' },
                  signal: AbortSignal.timeout(60_000),
            }).catch(() => null);

            const code = bancolombiaEncryptCode(seededOne.userRequestId, seededOne.branchHash);
            const browser = await chromium.launch();

            try {
                  const page = await browser.newPage();

                  // ⚠ EL RELOJ DEL NAVEGADOR, 24 h ATRÁS — sin esto el test es verde mentiroso.
                  //
                  // El plazo lo calcula el SERVIDOR (`calculateDeadlineTimestamp` corre en el loader) y la
                  // etiqueta la calcula el NAVEGADOR. El defecto sólo se ve cuando esos dos caen en días
                  // distintos de Bogotá, o sea entre las 20:30 y las 23:59 — el 15 % del día. Corrido a
                  // las 07:14 el plazo es hoy a las 20:30 y la frase quemada «Vence hoy» ACIERTA por
                  // casualidad: medido, la primera versión de este test pasó contra el front con el bug.
                  //
                  // Atrasar el reloj del cliente 24 h deja el plazo del servidor intacto y lo corre al día
                  // siguiente DESDE EL PUNTO DE VISTA DEL CUSTOMER, que es exactamente la condición. Así el
                  // test discrimina a cualquier hora. `setFixedTime` toca `Date.now()` y no los timers, que
                  // es lo único que hace falta: el contador se calcula al montar.
                  const fakeClock = new Date(Date.now() - 24 * 60 * 60 * 1000);
                  await page.clock.setFixedTime(fakeClock);

                  await page.goto(`${FRONT}/bancolombia/${product}/purchase-code/${code}`, { waitUntil: 'networkidle' });

                  const counter = await page.getByText(/^\d{2}:\d{2}:\d{2}$/).first()
                        .textContent({ timeout: 20_000 }).catch(() => null);
                  const label = await page.getByText(/\(Vence .*\)/).first()
                        .textContent({ timeout: 20_000 }).catch(() => null);

                  expect(counter, 'la pantalla no mostró la cuenta regresiva — ¿se emitió el código?').toBeTruthy();
                  expect(label, 'la pantalla no mostró la fecha de vencimiento').toBeTruthy();
                  if (!counter || !label) return;

                  // El instante que la pantalla AFIRMA, derivado de su propio contador.
                  //
                  // ⚠ REDONDEADO AL MINUTO, y no es cosmético: el contador se muestra TRUNCADO a segundos
                  // y entre que se pinta y que se lee pasan milisegundos, así que `ahora + contador` cae
                  // un pelo ANTES del plazo real — con un plazo a las 20:30:00 da 20:29:59 y el test
                  // exigiría «8:29 p.m.» contra una etiqueta correcta. Un test intermitente es peor que
                  // no tenerlo: se aprende a ignorar, y con él se ignora el día que falle de verdad.
                  // Se mide contra el reloj FALSO, que es el que vio la pantalla — no contra el de Node.
                  const [hh, mm, ss] = counter.trim().split(':').map(Number);
                  const instant = fakeClock.getTime() + ((hh * 60 + mm) * 60 + ss) * 1000;
                  const expires = inBogota(Math.round(instant / 60_000) * 60_000);
                  const now = inBogota(fakeClock.getTime());
                  const expectedDay = expires.dia === now.dia ? 'hoy' : 'mañana';

                  const because = (what: string) =>
                        `${what}\n      contador «${counter.trim()}» · etiqueta «${label.trim()}»`
                        + `\n      ⚠ si esto falla con «hoy» y el contador pasa de la medianoche, es F-227:`
                        + ' el arreglo está en Creditop-SAS/frontend-monorepo#1028, sin mergear.';

                  // 🔴 EL caso. El día que la etiqueta anuncia tiene que ser el que sale del contador.
                  expect(label, because(`la etiqueta debería decir «${expectedDay}»`)).toContain(expectedDay);

                  // 🔴 Y la hora también sale del contador: que no vuelva a quedar escrita en la frase.
                  const time12 = expires.hora % 12 === 0 ? 12 : expires.hora % 12;
                  const meridian = expires.hora < 12 ? 'a.m.' : 'p.m.';
                  const expectedTime = `${time12}:${String(expires.minuto).padStart(2, '0')} ${meridian}`;
                  expect(label, because(`la etiqueta debería anunciar las ${expectedTime}`)).toContain(expectedTime);
            } finally {
                  await browser.close();
            }
      });
}

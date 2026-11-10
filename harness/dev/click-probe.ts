// Mide el primer clic de «Validar Pre aprobado» como una persona: mouse abajo y arriba donde está el botón, sin
// esperar a que la página se quede quieta. Sólo qa, sucursal de la copia de Mario (1126106a). ESCRIBE: el clic
// selecciona la entidad. Uso: cd harness && [BLOCK_POSTHOG=1] node dev/click-probe.ts <solicitud en el listado> <immediate|settled>
import { chromium } from 'playwright';
// JARVIS=1: en el Chrome de la persona (la extensión Jarvis), con sus cookies; sin él, un Chromium limpio.
const openChrome = process.env.JARVIS === '1' ? (await import('../../jarvis/recipes/recorder.ts')).openChrome : async () => { const browser = await chromium.launch({ headless: process.env.HEADED !== '1' }); const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); return { page, close: () => browser.close() }; };
const [ur, mode = 'immediate'] = process.argv.slice(2);
const url = `https://originaciones-qa.dev.creditop.com/ecommerce/1126106a/${ur}/lenders`;
const { page, close } = await openChrome();
const t0 = Date.now(); const ms = () => Date.now() - t0;
const posts: string[] = [];
// BLOCK_POSTHOG=1: corta los pedidos a PostHog. Con BLOCK_POSTHOG_BRAVE=1, sólo lo que corta Brave Shields de verdad (medido
// en el Brave de Duncan el 2026-11-10): el envío de eventos, el recorder y dead-clicks; config y /flags pasan.
const blocked: string[] = [];
if (process.env.BLOCK_POSTHOG === '1') await page.route(process.env.BLOCK_POSTHOG_PATHS === '1' ? /posthog/i : process.env.BLOCK_POSTHOG_BRAVE === '1' ? /dead-clicks-autocapture|posthog-recorder|us\.i\.posthog\.com\/i\/v0\/e/ : /posthog\.com/, (r: any) => {
  blocked.push(r.request().url().replace(/\?.*$/, ''));
  // BLOCK_POSTHOG_AS: cómo lo corta. abort (por defecto) = falla de red; 503 = respuesta 503 vacía (lo que se ve en Brave);
  // stub = un script vacío con 200 (como los reemplazos «noop» de los bloqueadores).
  const as = process.env.BLOCK_POSTHOG_AS || 'abort';
  if (as === '503') return r.fulfill({ status: 503, body: '' });
  if (as === 'stub') return r.request().resourceType() === 'script' ? r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }) : r.fulfill({ status: 503, body: '' });
  return r.abort('blockedbyclient');
});
// Los errores de la página: un error dentro del clic corta el envío sin que se vea nada.
const pageErrors: string[] = [];
page.on('pageerror', (e: any) => pageErrors.push(String(e).slice(0, 240)));
page.on('request', (r: any) => { if (r.method() === 'POST' && /creditop\.com/.test(r.url())) posts.push(`${ms()}ms ${r.url().replace(/^https:\/\/[^/]+/, '')}`); });
// Cuánto tarda cada pedido a nuestro dominio (desde que sale hasta que termina): dónde se va el tiempo después del clic.
const timings: string[] = [];
page.on('requestfinished', async (r: any) => {
  if (!/creditop\.com/.test(r.url())) return;
  const t = r.timing(); const started = ms() - Math.round(t.responseEnd >= 0 ? t.responseEnd : 0);
  const res = await r.response().catch(() => null);
  timings.push(`${started}ms +${Math.round(t.responseEnd)}ms ${r.method()} ${res?.status() ?? '?'} ${r.url().replace(/^https:\/\/[^/]+/, '').replace(/\?.*$/, '')}`);
});
try {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
  const btn = page.getByRole('button', { name: /Validar Pre aprobado/i }).first();
  await btn.waitFor({ state: 'visible', timeout: 90_000 });
  const tVisible = ms();
  // como una persona: si el botón quedó fuera de la ventana, se baja hasta verlo
  await btn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  // cómo se mueve el botón desde que aparece (cada 50 ms, 3 s)
  const track: string[] = []; let last = '';
  const sampler = (async () => { for (let i = 0; i < 60; i++) { const b = await btn.boundingBox({ timeout: 100 }).catch(() => null); const s = b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : 'sin caja'; if (s !== last) { track.push(`${ms()}ms ${s}`); last = s; } await page.waitForTimeout(50); } })();
  if (mode === 'settled') await page.waitForTimeout(4000);
  const b = await btn.boundingBox({ timeout: 2000 });
  const x = b!.x + b!.width / 2, y = b!.y + b!.height / 2;
  const at = (px: number, py: number) => page.evaluate(([px, py]: number[]) => { const e = document.elementFromPoint(px, py); return e ? `${e.tagName.toLowerCase()} «${(e.textContent || '').trim().slice(0, 30)}»` : 'nada'; }, [px, py]);
  await page.mouse.move(x, y);
  const downOn = await at(x, y); const tDown = ms();
  await page.mouse.down(); await page.waitForTimeout(110);
  const upOn = await at(x, y); await page.mouse.up(); const tUp = ms();
  // Cuánto tarda en dejar el listado (hasta 30 s): un clic que se queda en «•••» no cuenta como que avanzó.
  const tLeft = await page.waitForURL((u: URL) => !u.pathname.endsWith('/lenders'), { timeout: 30_000 }).then(() => ms()).catch(() => null);
  await page.waitForTimeout(500);
  await sampler;
  const spinner = await btn.getAttribute('aria-busy', { timeout: 100 }).catch(() => null);
  console.log(JSON.stringify({ ur, mode, url, tVisible, tDown, tUp, downOn, upOn, postsAfterClick: posts.filter((p) => parseInt(p) >= tDown), allPosts: posts, track, spinner, leftListingMs: tLeft === null ? null : tLeft - tUp, pageErrors, afterClick: timings.filter((x) => parseInt(x) >= tDown - 50), finalUrl: page.url(), blockedPosthog: [...new Set(blocked)] }, null, 1));
  await page.screenshot({ path: `/tmp/probe-${ur}-${mode}.png` });
} finally { await close(); }

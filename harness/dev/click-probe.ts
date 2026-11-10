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
// BLOCK_POSTHOG=1: corta todo pedido a PostHog, como Brave Shields (lo único de terceros que carga el wizard).
const blocked: string[] = [];
if (process.env.BLOCK_POSTHOG === '1') await page.route(process.env.BLOCK_POSTHOG_PATHS === '1' ? /posthog/i : /posthog\.com/, (r: any) => { blocked.push(r.request().url().replace(/\?.*$/, '')); return r.abort('blockedbyclient'); });
page.on('request', (r: any) => { if (r.method() === 'POST' && /creditop\.com/.test(r.url())) posts.push(`${ms()}ms ${r.url().replace(/^https:\/\/[^/]+/, '')}`); });
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
  await page.waitForTimeout(4000);
  await sampler;
  const spinner = await btn.getAttribute('aria-busy', { timeout: 100 }).catch(() => null);
  console.log(JSON.stringify({ ur, mode, url, tVisible, tDown, tUp, downOn, upOn, postsAfterClick: posts.filter((p) => parseInt(p) >= tDown), allPosts: posts, track, spinner, finalUrl: page.url(), blockedPosthog: [...new Set(blocked)] }, null, 1));
  await page.screenshot({ path: `/tmp/probe-${ur}-${mode}.png` });
} finally { await close(); }

/* `make estilo-contraste` — mide el contraste de lo que SE PINTA, en las tres UIs.
 *
 * El chequeo 3 de `estilo-check` sólo puede mirar reglas que fijan color Y fondo en la MISMA regla.
 * Todo lo demás hereda el color de un ancestro y el fondo de otro, y eso no se resuelve leyendo CSS:
 * hay que renderizar. Esto abre cada herramienta con el Chromium de Playwright, le inyecta
 * `tools/contraste.js` y junta lo que reporta.
 *
 * ⚠ NO LEVANTA LOS SERVIDORES, y es deliberado: los puertos son de Miguel y arrancar un segundo Vite
 *   encima le tumba el suyo (ya pasó dos veces con el panel). Audita lo que esté corriendo y **dice
 *   cuál no lo estaba** — una herramienta apagada sale `SIN VERIFICAR`, nunca en verde.
 *
 * ⚠ Playwright vive en `harness/node_modules` (el playground no tiene node_modules propio), así que
 *   se importa por ruta absoluta. Si algún día el harness deja de tenerlo, esto falla diciendo por
 *   qué, no en silencio.
 *
 * Exit, con la misma convención que el resto de los chequeos del repo:
 *   0  todo verde
 *   1  hay texto activo abajo del umbral
 *   2  alguna herramienta no se pudo consultar → SIN VERIFICAR (no cuenta como OK)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(RAIZ, 'harness', 'package.json'));

/* Los puertos son los de `.claude/launch.json`; el panel no es Vite pero se sirve igual. */
const UIS = [
  { tool: 'harness',  url: 'http://localhost:5195' },
  { tool: 'tablero',  url: 'http://localhost:5191' },
  { tool: 'trazador', url: 'http://localhost:5192' },
];

/* Algunas vistas no existen hasta que alguien toca algo. Lo mínimo para que el barrido vea el
 * contenido de verdad y no sólo el estado vacío. Si falla, no es un error del chequeo: se anota. */
const PREPARAR = {
  tablero: async (page) => {
    /* ⚠ Sus tareas llegan después del HTML, por `fetch` a su server Go. Recién cargado el sidebar
     * tiene UNA vista («Traer de Jira») y cero filas: con 600ms de espera el barrido medía una app
     * vacía y decía ✓. Se espera la SEÑAL —que aparezcan las vistas de estado— en vez de dormir un
     * número, que es lo que hace que el chequeo mida lo mismo en una máquina lenta. */
    await page.locator('.sidebar .view-tog').nth(1).waitFor({ state: 'visible', timeout: 12000 })
      .catch(() => {});
    /* Y el contexto de Playwright arranca SIN localStorage, así que el acordeón no está como lo
     * dejaste vos: sólo «En curso» abierta. Se abren todas antes de buscar una fila. */
    for (const v of await page.locator('.sidebar .view-tog').all()) {
      if ((await v.getAttribute('aria-expanded')) !== 'true') await v.click().catch(() => {});
    }
    const fila = page.locator('.sidebar .region-body button').filter({ hasText: /CORE-\d+|local · \d+/ }).first();
    if (!(await fila.count())) return 'sin tareas en el sidebar';
    await fila.click(); await fila.click();          // doble = fija la pestaña
    await page.locator('.editor .region-body').first().waitFor({ timeout: 4000 });
    return null;
  },
};

/* ⚠ Se pregunta por HTTP, no con un socket a `127.0.0.1`. Dos razones, las dos medidas:
 *   1. **Vite escucha sólo en IPv6** (`[::1]:5192`), así que un TCP a `127.0.0.1` da «no hay nada»
 *      sobre un servidor que está perfecto. `localhost` resuelve las dos familias.
 *   2. Un puerto ocupado no es una app: con HTTP se sabe que del otro lado hay algo que responde. */
const vivo = async (url) => {
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1500) });
    return r.ok || r.status < 500;
  } catch { return false }
};

const AUDITOR = join(RAIZ, 'tools', 'contraste.js');
if (!existsSync(AUDITOR)) { console.error('  ✗ falta tools/contraste.js'); process.exit(2) }
/* El archivo termina llamándose a sí mismo para poder pegarlo en la consola; acá sólo se define. */
const fuente = readFileSync(AUDITOR, 'utf8').replace(/\nwindow\.__contraste\(\);?\s*$/, '\n');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('  ✗ no encontré Playwright en harness/node_modules.');
  console.error('     Es donde vive (el playground no tiene node_modules propio):  cd harness && npm i');
  process.exit(2);
}

const soloTool = process.env.SOLO || null;
const umbralRoto = [];
let sinVerificar = 0;

console.log('\n  contraste de lo que SE PINTA · AA: 4,5:1 (texto grande, 3:1)');
console.log('  ⚠ audita lo que está CORRIENDO; no levanta servidores\n');

const navegador = await chromium.launch();
try {
  for (const { tool, url } of UIS) {
    if (soloTool && tool !== soloTool) continue;
    const puerto = Number(new URL(url).port);
    if (!(await vivo(url))) {
      console.log(`      ▲ ${tool.padEnd(9)} SIN VERIFICAR — nada escuchando en :${puerto}`);
      sinVerificar++;
      continue;
    }
    const ctx = await navegador.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    let nota = null;
    try {
      /* ⚠ `networkidle` NO sirve acá: el panel del harness pollea el estado de los servicios, así
       * que la red nunca queda quieta y el goto se cae por timeout sobre una página que ya estaba
       * dibujada. Se espera a que el ÁRBOL tenga contenido, que es la señal que importa. */
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.locator('.workbench, .wrap, #app > *').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(600);   // el último render de Vue/el script del panel
      if (PREPARAR[tool]) { try { nota = await PREPARAR[tool](page) } catch (e) { nota = 'no se pudo preparar la vista: ' + e.message.split('\n')[0] } }
      await page.addScriptTag({ content: fuente });
      const r = await page.evaluate(() => window.__contraste());
      const act = r.activos;
      const cola = `${r.nodos} nodo(s) abajo del umbral · ${r.inactivos} inactivo(s), que WCAG exime`;
      if (act === 0) console.log(`      ✓ ${tool.padEnd(9)} sin texto activo abajo de AA` + (r.inactivos ? `  (${r.inactivos} inactivo(s))` : ''));
      else {
        console.log(`      ✗ ${tool.padEnd(9)} ${act} activo(s) · ${cola}`);
        for (const m of r.detalle) console.log(`          ${String(m.k).padEnd(5)} ${(m.cls || '·').padEnd(26)} ${m.fg} sobre ${m.bg}   «${m.txt}»`);
        umbralRoto.push(tool);
      }
      if (nota) console.log(`          ▲ ${nota} — lo que esa vista tapa no se midió`);
    } catch (e) {
      console.log(`      ▲ ${tool.padEnd(9)} SIN VERIFICAR — ${e.message.split('\n')[0]}`);
      sinVerificar++;
    } finally { await ctx.close() }
  }
} finally { await navegador.close() }

console.log();
if (umbralRoto.length) {
  console.log(`  ✗ ${umbralRoto.join(', ')}: hay texto ACTIVO abajo de AA.`);
  console.log('     La rampa que pasa está en `taller.css`: `--texto-2` (74%) y `--texto-3` (70%).');
  console.log('     ⚠ Y no le apiles `opacity`: la regla sola queda correcta y el chequeo estático no lo ve.');
  process.exit(1);
}
if (sinVerificar) {
  console.log(`  ▲ ${sinVerificar} herramienta(s) SIN VERIFICAR. Levantalas y volvé a correr —`);
  console.log('     callarlo sería inventar un verde.   make tablero · panel · trazador');
  process.exit(2);
}
console.log(`  ✓ ${soloTool ? soloTool : 'las tres'}, sin texto activo abajo de AA.`);

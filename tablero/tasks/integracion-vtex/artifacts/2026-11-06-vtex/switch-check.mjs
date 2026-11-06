// El script del checkout en una página mínima con el bloque de Creditop y la ruta del switch interceptada.
// Uso (desde harness/, que tiene Playwright): node switch-check.mjs <checkout6-custom.js>
import { chromium } from 'playwright'
import fs from 'node:fs'
const script = fs.readFileSync(process.argv[2], 'utf8')
const page_ = (s, fields) => `<!doctype html><html><body><div class="CreditopGroupPaymentGroup">Creditop</div><button id="payment-data-submit">Comprar ahora</button>
<script>window.saved={};window.vtexjs={checkout:{orderForm:{customData:${fields ? `{customApps:[{id:'creditop',fields:${JSON.stringify(fields)}}]}` : 'null'}},setCustomData:function(d){window.saved[d.field]=d.value}}};
document.getElementById('payment-data-submit').addEventListener('click',function(){window.submitted=true})</script><script>${s}</script></body></html>`
const browser = await chromium.launch()
const results = []
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' · ' + JSON.stringify(got)}`) }
async function open(status, body, fields) {
  const page = await browser.newPage()
  await page.route('**/_v/creditop/auto-onboarding', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }))
  await page.route('https://tienda.test/checkout', (r) => r.fulfill({ contentType: 'text/html', body: page_(script, fields) }))
  await page.goto('https://tienda.test/checkout')
  await page.waitForTimeout(400)
  return page
}
const submitBlocked = async (page) => { await page.evaluate(() => { window.submitted = false }); await page.click('#payment-data-submit'); return !(await page.evaluate(() => window.submitted)) }

let p = await open(200, { autoOnboarding: true })
check('prendido: muestra los campos', await p.locator('#cr-ao-birth').count() === 1)
check('prendido: sin datos frena la compra', await submitBlocked(p))
await p.fill('#cr-ao-birth', '1990-01-01'); await p.fill('#cr-ao-expedition', '2010-01-01'); await p.check('#cr-ao-accept')
let saved = await p.evaluate(() => window.saved)
check('prendido: guarda las tres', saved.birthDate === '1990-01-01' && saved.expeditionDate === '2010-01-01' && !!saved.acceptedAt, saved)
check('prendido: completo deja comprar y oculta el aviso', !(await submitBlocked(p)) && await p.locator('#cr-ao-error').isHidden())
await p.close()

for (const [name, status, body] of [['apagado', 200, { autoOnboarding: false }], ['sin conector (404)', 404, {}]]) {
  p = await open(status, body)
  check(`${name}: sin campos y la compra pasa`, await p.locator('#cr-ao-birth').count() === 0 && !(await submitBlocked(p)))
  await p.close()
}

p = await open(200, { autoOnboarding: true }, { birthDate: '1990-01-01', expeditionDate: '2010-01-01', acceptedAt: '2026-11-06T20:00:00.000Z' })
saved = await p.evaluate(() => window.saved)
check('carrito con aceptación vieja: la borra y la casilla aparece sin marcar', saved.acceptedAt === '' && !(await p.isChecked('#cr-ao-accept')), saved)
check('carrito con aceptación vieja: conserva las fechas', (await p.inputValue('#cr-ao-birth')) === '1990-01-01' && (await p.inputValue('#cr-ao-expedition')) === '2010-01-01')
check('carrito con aceptación vieja: sin aceptar de nuevo frena', await submitBlocked(p))
await p.check('#cr-ao-accept')
check('carrito con aceptación vieja: al aceptar de nuevo deja comprar', !(await submitBlocked(p)))
await p.close()

p = await open(200, { autoOnboarding: true })
const minor = new Date(); minor.setFullYear(minor.getFullYear() - 17)
await p.fill('#cr-ao-birth', minor.toISOString().slice(0, 10)); await p.fill('#cr-ao-expedition', '2024-01-01'); await p.check('#cr-ao-accept')
saved = await p.evaluate(() => window.saved)
check('menor de 18: avisa, no guarda el nacimiento y frena', /mayor de 18/.test(await p.textContent('#cr-ao-birth-error')) && !saved.birthDate && await submitBlocked(p), saved)
await p.fill('#cr-ao-birth', '2000-05-05'); await p.fill('#cr-ao-expedition', '1999-01-01')
saved = await p.evaluate(() => window.saved)
check('expedición antes del nacimiento: avisa, no la guarda y frena', /posterior/.test(await p.textContent('#cr-ao-expedition-error')) && saved.birthDate === '2000-05-05' && !saved.expeditionDate && await submitBlocked(p), saved)
await p.fill('#cr-ao-expedition', '2018-06-01')
saved = await p.evaluate(() => window.saved)
check('al corregir: se va el aviso, guarda y deja comprar', await p.locator('#cr-ao-expedition-error').isHidden() && saved.expeditionDate === '2018-06-01' && !(await submitBlocked(p)), saved)
await p.close()

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} casos bien`)
process.exit(failed ? 1 : 0)

// El script del checkout con la ruta del switch respondiendo true, false o 404, en una página mínima con el bloque de Creditop.
import { chromium } from 'playwright'
import fs from 'node:fs'
const script = fs.readFileSync(process.argv[2], 'utf8')
const page_ = (s) => `<!doctype html><html><body><div class="CreditopGroupPaymentGroup">Creditop</div><button id="payment-data-submit">Comprar ahora</button>
<script>window.saved={};window.vtexjs={checkout:{orderForm:{customData:null},setCustomData:function(d){window.saved[d.field]=d.value}}};
document.getElementById('payment-data-submit').addEventListener('click',function(){window.submitted=true})</script><script>${s}</script></body></html>`
const browser = await chromium.launch()
for (const [name, status, body] of [['prendido', 200, { autoOnboarding: true }], ['apagado', 200, { autoOnboarding: false }], ['sin conector (404)', 404, {}]]) {
  const page = await browser.newPage()
  await page.route('**/_v/creditop/auto-onboarding', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }))
  await page.route('https://tienda.test/checkout', (r) => r.fulfill({ contentType: 'text/html', body: page_(script) }))
  await page.goto('https://tienda.test/checkout')
  await page.waitForTimeout(500)
  const fields = await page.locator('#cr-ao-birth').count()
  await page.click('#payment-data-submit')
  const blocked = !(await page.evaluate(() => window.submitted === true))
  let after = ''
  if (fields) {
    await page.fill('#cr-ao-birth', '1990-01-01'); await page.fill('#cr-ao-expedition', '2010-01-01'); await page.check('#cr-ao-accept')
    const saved = await page.evaluate(() => window.saved)
    after = ` · guardó ${Object.keys(saved).join(', ')} · aviso oculto: ${await page.locator('#cr-ao-error').isHidden()}`
  }
  console.log(`${name}: campos ${fields ? 'sí' : 'no'} · comprar sin datos ${blocked ? 'frenado' : 'pasa'}${after}`)
  await page.close()
}
await browser.close()

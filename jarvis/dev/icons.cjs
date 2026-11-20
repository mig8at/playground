// Genera los PNG del ícono de la extensión (extension/images/icon-<tamaño>.png) desde sus SVG, con el Chromium del
// harness. icon.svg es el ícono; icon-small.svg, su versión para 16 px (sin el punto y con el trazo más grueso: en
// 16 px el detalle se pierde). Uso: node jarvis/dev/icons.cjs
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require(path.join(__dirname, '../../harness/node_modules/playwright'))

const dir = path.join(__dirname, '../extension/images')
const sizes = { 16: 'icon-small.svg', 32: 'icon.svg', 48: 'icon.svg', 128: 'icon.svg' }

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const [size, file] of Object.entries(sizes)) {
    const svg = fs.readFileSync(path.join(dir, file), 'utf8').replace(/width="128" height="128"/, `width="${size}" height="${size}"`)
    await page.setViewportSize({ width: Number(size), height: Number(size) })
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
    await page.locator('svg').screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true })
    console.log(`icon-${size}.png`)
  }
  await browser.close()
})()

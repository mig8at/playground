// RECETA POR PANTALLA · crear un producto en el admin de VTEX, en el Chrome de la persona (Jarvis), como lo haría ella.
//
//   make jarvis-recipe APP=vtex RECIPE=create-product-screen ARGS='--name "Casco por pantalla Jarvis" --price 350000'
//
// La hermana de `create-product` (por API): mismo resultado, pero por el admin, para VER cómo se hace o para lo que no
// tiene API. Cada campo y botón sale del MAPA (`jarvis/maps/vtex/map.json`): la receta no busca qué tocar, y si VTEX
// cambia el admin falla diciendo qué elemento del mapa ya no está (`make jarvis-map APP=vtex A=verify`).
//
// Producto por pantalla (nombre, activo, marca, categoría, todas las políticas comerciales, visible, referencia →
// Save). Lo que el admin reparte en otras pantallas (el SKU, su imagen, el precio en «Price List» y el stock en
// «Inventory Management») va por la API con la receta hermana, sobre el producto que dejó la pantalla.
//
// Parámetros: --name (obligatorio) · --price (obligatorio) · --stock 10 · --brand "Creditop Pruebas" ·
// --category "Bicicletas" (el buscador del admin sólo encuentra categorías de primer nivel) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión manejándolo, y la sesión del admin de VTEX abierta en Chrome.
// ESCRIBE en el catálogo de la cuenta de pruebas `creditop`.
import '../args.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, hosts } from './api.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };

const name = (flag('name') || '').trim();
const price = Number(flag('price'));
if (!name || !Number.isFinite(price) || price <= 0) {
    console.error('  uso: create-product-screen --name "…" --price <pesos> [--stock 10] [--brand "Creditop Pruebas"] [--category "Bicicletas"] [--json]');
    process.exit(2);
}
const stock = flag('stock') ?? '10';
const brand = flag('brand') || 'Creditop Pruebas';
const category = flag('category') || 'Bicicletas';
const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ref = `JARVIS-${slug}`.toUpperCase().slice(0, 60);

// ── el mapa: cada elemento por su nombre ──
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'jarvis/maps/vtex/map.json'), 'utf8'));
function el(page: any, screen: string, key: string) {
    const e = map.screens[screen]?.elements[key];
    if (!e) throw new Error(`el mapa de vtex no tiene «${screen}.${key}»: guardá la pantalla (make jarvis-map APP=vtex A=save SCREEN=${screen} FRAME='#raccoon-iframe')`);
    return new Function('page', `return ${e.locator}`)(page);
}

// ── ¿ya existe? Igual que la receta por API: no se duplica ──
const existing = await call('GET', `${hosts.catalog}/api/catalog/pvt/stockkeepingunit?refId=${encodeURIComponent(ref)}`);
const byProductRef = existing.status === 200 && existing.data?.ProductId;
if (byProductRef) say(`ya existe un producto con la referencia ${ref} (producto ${existing.data.ProductId}): no lo creo por pantalla de nuevo`);

// ── Chrome por Jarvis ──
const status = await (await fetch('http://127.0.0.1:5203/api/chrome')).json();
if (!status.connected) { console.error('  ✗ Jarvis no está conectado en Chrome'); process.exit(2); }
if (status.driving) { console.error('  ✗ hay una sesión de Jarvis manejando Chrome: cerrala (bin/jarvis close)'); process.exit(2); }
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go');
const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()!;
const { chromium } = await import(path.join(cache, version, 'package', 'index.mjs'));

let productId: number | null = byProductRef ? Number(existing.data.ProductId) : null;
if (!productId) {
    const browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp');
    const page = await browser.contexts()[0].newPage();
    try {
        say('abro el formulario de producto nuevo del admin');
        await page.goto(map.screens['new-product'].url, { waitUntil: 'commit', timeout: 90_000 });
        await el(page, 'new-product', 'product-name').waitFor({ timeout: 60_000 });

        await el(page, 'new-product', 'product-name').fill(name);
        const active = el(page, 'new-product', 'active');
        if ((await active.getAttribute('aria-checked')) !== 'true') await active.click();
        say(`nombre «${name}» · activo`);

        const brandBox = el(page, 'new-product', 'brand');
        await brandBox.scrollIntoViewIfNeeded();
        await brandBox.click();
        await brandBox.pressSequentially(brand.slice(0, 6), { delay: 60 });
        // La opción filtrada existe pero Playwright la ve «no visible» (la lista la pinta aparte): se elige con el
        // teclado, como una persona. Antes se espera a que el filtro deje alguna.
        await page.frameLocator('#raccoon-iframe').getByRole('option').first().waitFor({ state: 'attached', timeout: 15_000 });
        await brandBox.press('ArrowDown');
        await brandBox.press('Enter');
        say(`marca «${brand}»`);

        const categoryBox = el(page, 'new-product', 'category');
        await categoryBox.click();
        await categoryBox.pressSequentially(category.slice(0, 5), { delay: 60 });
        // No es un listbox accesible: se elige por el texto del resultado («Bicicletas 2»: nombre e id).
        await page.frameLocator('#raccoon-iframe').getByText(new RegExp(`^\\s*${category}`)).last().click({ timeout: 15_000 });
        say(`categoría «${category}»`);

        await el(page, 'new-product', 'all-sales-channels').check();
        say('todas las políticas comerciales');

        const visible = el(page, 'new-product', 'display-on-website');
        await visible.scrollIntoViewIfNeeded();
        if ((await visible.getAttribute('aria-checked')) !== 'true') await visible.click();
        await el(page, 'new-product', 'reference-code').fill(ref);
        say(`visible en la tienda · referencia ${ref}`);

        await el(page, 'new-product', 'save').click();
        // Al guardar, el admin pasa a la URL del producto: de ahí sale su id.
        await page.waitForURL(/catalog-products\/product\/\d+/, { timeout: 60_000 });
        productId = Number(/product\/(\d+)/.exec(page.url())![1]);
        say(`guardado: producto ${productId} · ${page.url()}`);
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

// ── lo que vive en otras pantallas, por API, sobre el producto que dejó la pantalla ──
say('SKU, imagen, precio y stock: por API (receta create-product)');
const out = execFileSync(process.execPath, [path.join(HERE, 'create-product.ts'), '--name', name, '--price', String(price), '--stock', stock,
    '--ref', ref, '--product', String(productId), '--json'], { encoding: 'utf8' });
const api = JSON.parse(out.trim().split('\n').pop()!);
const result = { ...api, recipe: 'vtex/create-product-screen', productId };
if (JSON_OUT) console.log(JSON.stringify(result));
else {
    say(`SKU ${api.skuId} · precio $${price.toLocaleString('es-CO')} · stock ${stock}`);
    say(`tienda:  ${api.store}`);
    say(`carrito: ${api.cart}`);
    say(`admin:   ${hosts.admin}/catalog-products/product/${productId}`);
}

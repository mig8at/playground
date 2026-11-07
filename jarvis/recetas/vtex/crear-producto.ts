// RECETA · crear un producto vendible en la tienda de pruebas de VTEX (cuenta `creditop`), por API.
//
//   make jarvis-receta APP=vtex RECETA=crear-producto ARGS='--nombre "Casco urbano" --precio 350000 --stock 20'
//
// Deja un producto listo para comprar: producto → SKU (con las medidas del paquete) → imagen → precio → stock → SKU
// activo. Lo que no se dice se toma del molde, la BMX de la tienda (SKU 9): categoría, marca, medidas, bodega e imagen.
// Si ya existe un producto con la misma referencia (`--ref`, por defecto sacada del nombre), no crea otro: actualiza
// su precio y su stock y lo dice. Imprime los ids, la URL en la tienda y la del admin.
//
// Parámetros: --nombre (obligatorio) · --precio (pesos, obligatorio) · --stock 10 · --ref TEXTO · --categoria 4 ·
// --marca 2000001 · --descripcion TEXTO · --oculto (no se muestra en la tienda: sólo por URL o carrito) · --json
//
// ESCRIBE en el catálogo de la cuenta de pruebas `creditop` (es la de pruebas: cada comercio tiene su propia cuenta).
// La versión por pantalla de esta misma receta usa el mapa del admin (`jarvis/mapas/vtex/mapa.json`).
import { call, hosts, must } from './api.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string) => argv.includes(`--${name}`);
const JSON_OUT = has('json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };

const TEMPLATE_SKU = 9; // la BMX: de ella salen categoría, marca, medidas, bodega e imagen
const name = (flag('nombre') || '').trim();
const price = Number(flag('precio'));
if (!name || !Number.isFinite(price) || price <= 0) {
    console.error('  uso: crear-producto --nombre "…" --precio <pesos> [--stock 10] [--ref …] [--categoria 4] [--marca 2000001] [--descripcion …] [--oculto] [--json]');
    process.exit(2);
}
const stock = Number(flag('stock') ?? 10);
const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ref = (flag('ref') || `JARVIS-${slug}`).toUpperCase().slice(0, 60);

const { catalog, pricing, store, admin } = hosts;

// ── el molde ──
const tSku = await must('leer el SKU molde', 'GET', `${catalog}/api/catalog/pvt/stockkeepingunit/${TEMPLATE_SKU}`);
const tProduct = await must('leer el producto molde', 'GET', `${catalog}/api/catalog/pvt/product/${tSku.ProductId}`);
const tFiles = await must<any[]>('leer la imagen del molde', 'GET', `${catalog}/api/catalog/pvt/stockkeepingunit/${TEMPLATE_SKU}/file`);
const tStock = await must('leer la bodega del molde', 'GET', `${catalog}/api/logistics/pvt/inventory/skus/${TEMPLATE_SKU}`);
const warehouse: string = tStock.balance?.[0]?.warehouseId ?? '1_1';

// ── ¿ya existe? (por la referencia: correr la receta dos veces no duplica) ──
// Por el SKU y no por el producto: `productgetbyrefid` lee de un índice que tarda en enterarse (dio 404 con el producto
// recién creado, 2026-11-07), y `stockkeepingunit?refId=` va directo al catálogo. Producto y SKU llevan la misma ref.
async function findByRef(): Promise<{ productId: number; skuId: number } | null> {
    const r = await call('GET', `${catalog}/api/catalog/pvt/stockkeepingunit?refId=${encodeURIComponent(ref)}`);
    return r.status === 200 && r.data?.Id ? { productId: r.data.ProductId, skuId: r.data.Id } : null;
}

let productId: number;
let skuId: number;
let created = false;
const found = await findByRef();
if (found) {
    ({ productId, skuId } = found);
    say(`ya existía (ref ${ref}): producto ${productId}, SKU ${skuId} · actualizo precio y stock`);
} else {
    created = true;
    const product = await must('crear el producto', 'POST', `${catalog}/api/catalog/pvt/product`, {
        Name: name,
        CategoryId: Number(flag('categoria') ?? tProduct.CategoryId),
        BrandId: Number(flag('marca') ?? tProduct.BrandId),
        LinkId: slug,
        RefId: ref,
        IsVisible: !has('oculto'),
        IsActive: true,
        Description: flag('descripcion') || `${name}. Producto de prueba creado por Jarvis.`,
        ShowWithoutStock: false,
    });
    productId = product.Id;
    say(`producto ${productId} · «${name}» · ref ${ref}`);

    const sku = await must('crear el SKU', 'POST', `${catalog}/api/catalog/pvt/stockkeepingunit`, {
        ProductId: productId,
        Name: name,
        RefId: ref,
        IsActive: false, // se activa al final, cuando ya tiene imagen, precio y stock
        PackagedHeight: tSku.PackagedHeight, PackagedLength: tSku.PackagedLength,
        PackagedWidth: tSku.PackagedWidth, PackagedWeightKg: tSku.PackagedWeightKg,
        MeasurementUnit: tSku.MeasurementUnit ?? 'un', UnitMultiplier: tSku.UnitMultiplier ?? 1,
    });
    skuId = sku.Id;
    say(`SKU ${skuId}`);

    const main = tFiles.find((f) => f.IsMain) ?? tFiles[0];
    if (main?.Url) {
        await must('agregar la imagen', 'POST', `${catalog}/api/catalog/pvt/stockkeepingunit/${skuId}/file`, {
            IsMain: true, Label: name, Name: slug.slice(0, 40), Text: name, Url: main.Url,
        });
        say('imagen (la del molde)');
    }
}

// La POLÍTICA COMERCIAL (sales channel): por API un producto nace sin ninguna, y así la tienda no lo vende — la
// simulación del carrito decía «Ítem … no encontrado o no disponible» (ORD027) con el SKU activo, con precio y con
// stock (2026-11-07). Se asocia a las mismas que el molde.
const policies = await must<{ StoreId: number }[]>('leer las políticas del molde', 'GET', `${catalog}/api/catalog/pvt/product/${tSku.ProductId}/salespolicy`);
const mine = await call<{ StoreId: number }[]>('GET', `${catalog}/api/catalog/pvt/product/${productId}/salespolicy`);
for (const { StoreId } of policies) {
    if ((mine.data ?? []).some((p) => p.StoreId === StoreId)) continue;
    await must('asociar la política comercial', 'POST', `${catalog}/api/catalog/pvt/product/${productId}/salespolicy/${StoreId}`);
    say(`política comercial ${StoreId}`);
}

// La API de precios pide exactamente DOS de basePrice, costPrice y markup: costo + margen 0 da el precio base.
await must('poner el precio', 'PUT', `${pricing}/pricing/prices/${skuId}`, { costPrice: price, markup: 0, listPrice: price });
say(`precio $${price.toLocaleString('es-CO')}`);
await must('poner el stock', 'PUT', `${catalog}/api/logistics/pvt/inventory/skus/${skuId}/warehouses/${warehouse}`, { unlimitedQuantity: false, quantity: stock });
say(`stock ${stock} en la bodega ${warehouse}`);

// Se activa si quedó inactivo (también si una corrida anterior se cortó antes de llegar acá).
const current = await must('leer el SKU', 'GET', `${catalog}/api/catalog/pvt/stockkeepingunit/${skuId}`);
if (!current.IsActive) {
    await must('activar el SKU', 'PUT', `${catalog}/api/catalog/pvt/stockkeepingunit/${skuId}`, { ...current, IsActive: true });
    say('SKU activo');
}

const out = {
    receta: 'vtex/crear-producto', creado: created, productId, skuId, ref, nombre: name, precio: price, stock,
    tienda: `${store}/${slug}/p`,
    carrito: `${store}/checkout/cart/add?sku=${skuId}&qty=1&seller=1&sc=1`,
    admin: `${admin}/catalog-products/product/${productId}`,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
    say(`tienda:  ${out.tienda}  (la tienda puede tardar unos minutos en indexarlo)`);
    say(`carrito: ${out.carrito}`);
    say(`admin:   ${out.admin}`);
}

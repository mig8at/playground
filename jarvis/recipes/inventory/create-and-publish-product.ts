// RECETA CON TU SESIÓN · Crear y publicar un producto en el inventario. Repite por la API los pedidos que hizo la página en el flujo, sin clics.
// (Salió de jarvis/flows/inventory/crear-y-publicar-un-producto-en-el-inventario.json y de la red de su corrida 2026-11-20_18-50-30_s1: make jarvis-recipe-api. Pulí la explicación.)
//
//   make jarvis-recipe APP=inventory RECIPE=create-and-publish-product ARGS='--name "Casco integral" --price "480000" --stock "12"'
//
// Crear y publicar otro producto
//
// Parámetros: --name (Nombre; por defecto "Casco integral") · --price (Precio; por defecto "480000") · --stock (Stock; por defecto "12") · --json
// Necesita: Jarvis conectado en Chrome y la sesión de http://localhost:5220 abierta en Chrome (los pedidos van con sus cookies).
// ESCRIBE: POST /api/products (paso «Guardar») · POST /api/skus (paso «Guardar») · PUT /api/products/1 (paso «Publicar Casco integral»)
// Encadena: el campo «code» del pedido 2 («SKU-1») lleva adentro un id devuelto antes
// Encadena: el campo «productId» del pedido 2 es «id» de lo que devolvió el pedido 1
// Encadena: PUT /api/products/1: el 1 de la URL es «id» de lo que devolvió el pedido 1
// Encadena: el campo «id» del pedido 3 es «id» de lo que devolvió el pedido 1
// Verificada: 2026-11-20 contra http://localhost:5220: POST /api/products → 201 · POST /api/skus → 201 · PUT /api/products/9 → 200; mismos estados y campos que la grabación.
import '../args.ts';
import { openChrome } from '../recorder.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const DEFAULTS: Record<string, string> = {
    "name": "Casco integral",
    "price": "480000",
    "stock": "12"
};
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : DEFAULTS[n]; };

// Los pedidos, en el orden en que los hizo la página. url y body reciben r, lo que devolvió cada pedido anterior
// (encadenados: pick). recorded: el estado que dieron aquella vez; shape: los campos que traía su respuesta.
const CALLS = [
    { step: "Guardar", method: "POST", url: (r: any[]) => "/api/products", contentType: "application/json", body: (r: any[]) => JSON.stringify({ "name": arg("name"), "price": Number(arg("price")), "stock": Number(arg("stock")) }), recorded: 201, shape: ["id","name","price","stock"] },
    { step: "Guardar", method: "POST", url: (r: any[]) => "/api/skus", contentType: "application/json", body: (r: any[]) => JSON.stringify({ "code": `SKU-${pick(r, 0, "id")}`, "productId": pick(r, 0, "id"), "stock": Number(arg("stock")) }), recorded: 201, shape: ["code","id","productId","stock"] },
    { step: "Publicar Casco integral", method: "PUT", url: (r: any[]) => `/api/products/${pick(r, 0, "id")}`, contentType: "application/json", body: (r: any[]) => JSON.stringify({ "id": pick(r, 0, "id"), "name": arg("name"), "price": Number(arg("price")), "status": "published", "stock": Number(arg("stock")) }), recorded: 200, shape: ["id","name","price","status","stock"] },
];

// pick(r, n, 'data.id'): un campo de lo que devolvió el pedido n de esta corrida; si no está, la receta no puede seguir.
function pick(r: any[], n: number, at: string) {
    let v = r[n];
    for (const k of at.split('.')) v = v == null ? undefined : v[k];
    if (v === undefined || v === null) throw new Error(`el pedido ${n + 1} no devolvió «${at}»: no se puede encadenar el siguiente (¿cambió su respuesta?)`);
    return v;
}

const { page, close } = await openChrome();
const r: any[] = [];
const changed: string[] = [];
const results: { step: string; method: string; url: string; status: number; recorded: number | string; keys: string[] }[] = [];
try {
    say("Abro http://localhost:5220/ para usar tu sesión");
    await page.goto("http://localhost:5220/", { waitUntil: 'domcontentloaded', timeout: 90_000 });
    for (const c of CALLS) {
        const url = c.url(r);
        const res = await page.evaluate(async ({ url, method, contentType, body }) => {
            const res = await fetch(url, { method, credentials: 'include', headers: contentType ? { 'content-type': contentType } : {}, body });
            return { status: res.status, text: await res.text() };
        }, { url, method: c.method, contentType: c.contentType, body: c.body(r) });
        let json: any;
        try { json = JSON.parse(res.text); } catch { /* no es JSON */ }
        r.push(json);
        const keys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json) : [];
        results.push({ step: c.step, method: c.method, url, status: res.status, recorded: c.recorded, keys });
        say(`${res.status < 400 ? '✓' : '✗'} ${c.method} ${url} → ${res.status} (paso «${c.step}»)`);
        if (res.status >= 400) throw new Error(`${c.method} ${url} dio ${res.status}: ${res.text.slice(0, 500)}`);
        // ¿Devolvió lo mismo que en la grabación? Un campo que ya no viene es lo primero que rompe un encadenado.
        const missing = c.shape.filter((k) => !keys.includes(k));
        if (typeof c.recorded === 'number' && c.recorded >= 400) changed.push(`${c.method} ${url} dio ${res.status}; en la grabación, ${c.recorded}`);
        if (missing.length) changed.push(`${c.method} ${url} ya no devuelve: ${missing.join(', ')}`);
    }
    for (const w of changed) say(`⚠ distinto de la grabación: ${w}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: "inventory/create-and-publish-product", results, changed }));
    else say('listo');
    if (changed.length) process.exitCode = 3;
} finally {
    await close();
}

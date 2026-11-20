// RECETA CON TU SESIÓN · Crear un producto en el inventario. Repite por la API los pedidos que hizo la página en el flujo, sin clics.
// (Salió de jarvis/flows/inventory/crear-un-producto-en-el-inventario.json y de la red de su corrida 2026-11-20_17-34-23_s2: make jarvis-recipe-api. Pulí la explicación.)
//
//   make jarvis-recipe APP=inventory RECIPE=create-product ARGS='--name "Casco urbano" --price "350000" --stock "20"'
//
// Crear un producto en el inventario
//
// Parámetros: --name (Nombre; por defecto "Casco urbano") · --price (Precio; por defecto "350000") · --stock (Stock; por defecto "20") · --json
// Necesita: Jarvis conectado en Chrome y la sesión de http://localhost:5220 abierta en Chrome (los pedidos van con sus cookies).
// ESCRIBE: POST /api/products (paso «Guardar»)
// No se repite: DELETE /api/products (al cargar la página de entrada, antes del primer paso)
import '../args.ts';
import { openChrome } from '../recorder.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const DEFAULTS: Record<string, string> = {
    "name": "Casco urbano",
    "price": "350000",
    "stock": "20"
};
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : DEFAULTS[n]; };

// Los pedidos, en el orden en que los hizo la página (recorded: el estado que dieron aquella vez).
const CALLS = [
    { step: "Guardar", method: "POST", url: "/api/products", contentType: "application/json", body: JSON.stringify({ "name": arg("name"), "price": Number(arg("price")), "stock": Number(arg("stock")) }), recorded: 201 },
];

const { page, close } = await openChrome();
const results: { step: string; method: string; url: string; status: number; response: string }[] = [];
try {
    say("Abro http://localhost:5220/ para usar tu sesión");
    await page.goto("http://localhost:5220/", { waitUntil: 'domcontentloaded', timeout: 90_000 });
    for (const c of CALLS) {
        const r = await page.evaluate(async ({ url, method, contentType, body }) => {
            const res = await fetch(url, { method, credentials: 'include', headers: contentType ? { 'content-type': contentType } : {}, body });
            return { status: res.status, response: (await res.text()).slice(0, 500) };
        }, c);
        results.push({ step: c.step, method: c.method, url: c.url, ...r });
        say(`${r.status < 400 ? '✓' : '✗'} ${c.method} ${c.url} → ${r.status} (paso «${c.step}»)`);
        if (r.status >= 400) throw new Error(`${c.method} ${c.url} dio ${r.status}: ${r.response}`);
    }
    if (JSON_OUT) console.log(JSON.stringify({ recipe: "inventory/create-product", results }));
    else say('listo');
} finally {
    await close();
}

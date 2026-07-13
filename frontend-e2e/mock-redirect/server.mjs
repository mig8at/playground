// mock-redirect — equivalente LOCAL del "sitio del comercio" + el redirect de borde de infra:
//   • GET /checkout/{hash}?<query>  →  302  {TARGET}/ecommerce/{hash}/checkout?<query>   (regla de infra)
//   • GET /return                    →  HTML "volviste a la tienda" (destino del botón "volver al comercio")
//   • GET /                          →  JSON health (lo usa bin/mock-redirect status)
//
// La regla /checkout es la misma nginx pedida a infra (preserva el query VERBATIM, lleva el base64).
// El /return cierra el loop del demo: tienda → checkout → … → loan-approved → "volver al comercio" → /return.
// Cero deps.   env: MOCK_REDIRECT_PORT (8096) · MOCK_REDIRECT_TARGET (http://localhost:5174)

import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_REDIRECT_PORT || 8096);
const TARGET = (process.env.MOCK_REDIRECT_TARGET || "http://localhost:5174").replace(/\/+$/, "");

const RETURN_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Tienda MCP — pedido</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;margin:0;min-height:100vh;display:grid;place-items:center}
 .card{background:#fff;border-radius:18px;padding:44px 52px;max-width:480px;text-align:center;box-shadow:0 6px 28px rgba(0,0,0,.07)}
 .logo{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#ff7a59,#ff3d77);margin:0 auto 18px}
 h1{color:#1a1a2e;font-size:23px;margin:0 0 6px} p{color:#555;margin:6px 0;font-size:15px}
 .ok{display:inline-block;background:#e7f7ec;color:#1a8a3f;border-radius:999px;padding:7px 16px;font-weight:800;margin:12px 0}
 .demo{position:fixed;top:0;left:0;right:0;background:#1a1a2e;color:#fff;text-align:center;font-size:12px;padding:6px;letter-spacing:.04em}
 .q{font-size:11px;color:#aaa;margin-top:20px;word-break:break-all}
</style></head><body>
 <div class="demo">DEMO · tienda-mock (volviste de Creditop)</div>
 <div class="card">
   <div class="logo"></div>
   <h1>🛒 Volviste a la tienda</h1>
   <div class="ok" id="st">✓ Pedido procesado con Creditop</div>
   <p>Tu solicitud de financiación quedó registrada. ¡Gracias por tu compra!</p>
   <p class="q" id="q"></p>
 </div>
 <script>
   var p = new URLSearchParams(location.search);
   var s = p.get('status'); if (s) document.getElementById('st').textContent = '✓ Pedido — estado: ' + s;
   if ([...p].length) document.getElementById('q').textContent = 'params recibidos: ' + location.search;
 </script>
</body></html>`;

// /return sirve la TIENDA MOCK real (mock-store/index.html) por HTTP → así el botón nativo "volver al comercio"
// (que navega por el browser) puede llegar; un file:// del mock-store lo bloquearía. Si no se puede leer, cae al
// HTML inline de arriba (RETURN_HTML).
let STORE_HTML = RETURN_HTML;
try { STORE_HTML = readFileSync(new URL("../mock-store/index.html", import.meta.url), "utf8"); } catch { /* usa RETURN_HTML */ }

const server = http.createServer((r, res) => {
      const u = new URL(r.url, "http://x");
      const m = u.pathname.match(/^\/checkout\/([^/]+)\/?$/); // ^/checkout/{hash}[/]
      if (m) {
            const hash = m[1];
            const location = `${TARGET}/ecommerce/${hash}/checkout${u.search}`; // 👈 query verbatim
            console.log(`[mock-redirect] 302  /checkout/${hash}  →  ${TARGET}/ecommerce/${hash}/checkout${u.search ? "  (?…)" : ""}`);
            res.writeHead(302, { Location: location });
            res.end();
            return;
      }
      if (u.pathname === "/return" || u.pathname.startsWith("/return")) {
            console.log(`[mock-redirect] return  ${u.pathname}${u.search}  (volver al comercio → tienda mock)`);
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(STORE_HTML);
            return;
      }
      const ok = u.pathname === "/";
      res.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, service: "mock-redirect", target: TARGET, routes: ["/checkout/{hash} → 302", "/return → tienda"] }));
});

server.listen(PORT, () => {
      console.log(`mock-redirect → :${PORT}  ·  /checkout/{hash} ⇒ 302 ${TARGET}/ecommerce/{hash}/checkout  ·  /return ⇒ tienda`);
});

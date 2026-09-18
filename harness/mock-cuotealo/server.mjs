// Mock del SIMULADOR DE CUOTÉALO (BCP Perú) — el iframe del paso `entidad/simulador`.
//
// POR QUÉ EXISTE, y no es "para que no se vea vacío":
//
//   1. EN LOCAL EL IFRAME QUEDA EN BLANCO, y va a seguir así. El host de Cuotéalo permite ser
//      embebido sólo por un puñado de orígenes, y `localhost` no está ni va a estar en esa lista.
//
//      ⚠ OJO CON LO QUE DICE EL FRONT. `routes/entidad/simulador.tsx` afirma que el host responde
//      `X-Frame-Options: SAMEORIGIN` y que «BCP tiene que permitir nuestro origen». **Eso ya no es
//      cierto**: medido el 2026-09-18, ese host NO manda `X-Frame-Options` (cero) y su CSP declara
//      `frame-ancestors 'self' https://originaciones.creditop.com
//      https://originaciones-stg.dev.creditop.com https://originaciones-qa.dev.creditop.com …`.
//      O sea que BCP YA nos habilitó, y el paso debería verse en qa, staging y producción. Antes de
//      creer que «la pantalla está en blanco en todos lados», comprobalo:
//          curl -sI https://wapceu2pxtid01.azurewebsites.net/simulador | grep -i frame
//
//   2. Y EL PRELLENADO ES CIEGO. El front arma la URL con marca, modelo, versión, seguro, comisión,
//      valor y monto a financiar; si algo falta, `buildVehicleSimulatorUrl` devuelve la URL PELADA y
//      la pantalla degrada **sin decir nada** (el comentario del front lo llama «fallo MUDO»). Con el
//      iframe en blanco no se distingue «el prellenado anduvo» de «se cayó a la URL pelada».
//
// Este mock contesta las dos: se deja embeber (no manda XFO y permite cualquier `frame-ancestors`) y
// **muestra en pantalla los parámetros que recibió**, separando los que el contrato espera de los que
// no conoce. Así el prellenado pasa de ciego a verificable, que es lo que ningún ambiente da hoy.
//
// ⚠ NO SIMULA EL NEGOCIO. No calcula cuotas, no valida rangos y no le contesta nada al wizard — no
// hace falta: el paso lo cierra el USUARIO con «Completar datos y continuar», porque el simulador real
// tampoco avisa cuándo terminó (es cross-origin, no hay `postMessage`). Sirve para ver la pantalla y
// para comprobar qué le llegó, no para afirmar qué haría BCP con eso.
//
// APUNTÁ EL WIZARD (frontend-monorepo/apps/loan-request-wizard/.env) — acá SÍ es localhost, porque el
// que carga el iframe es el NAVEGADOR y no un contenedor:
//   VITE_BCP_SIMULATOR_URL=http://localhost:8110/simulador
//
// uso: bin/mock-cuotealo [start|stop|status|logs]
import http from 'node:http';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_CUOTEALO_PORT || 8110);
/** Huella del código en disco: el launcher la compara para no reusar un proceso con la versión vieja. */
const CODIGO = Math.floor(statSync(fileURLToPath(import.meta.url)).mtimeMs / 1000);

/** Las claves que el contrato del front declara (`buildVehicleSimulatorParams`). Todo lo que llegue
 *  fuera de esta lista se muestra aparte: es la señal de que el contrato cambió y nadie avisó. */
// ⚠ MEDIDOS, no deducidos del tipo. La primera versión de esta lista decía `brand`/`model` leyendo
// `buildVehicleSimulatorParams`, y la primera corrida real mostró que viajan como `vehicleBrand` y
// `vehicleModel` (el nombre de la clave lo pone el tipo, no el nombre de la variable). Que el mock
// cante «no están en el contrato» es justamente lo que lo dejó ver.
const ESPERADOS = [
    'origin', 'productType', 'vehicleBrand', 'vehicleModel', 'version',
    'insuranceType', 'commissionRate', 'vehicleValue', 'financingAmount',
];

const llamadas = [];
const log = (s) => console.log(`[mock-cuotealo] ${new Date().toISOString().slice(11, 19)} ${s}`);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const plata = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `S/ ${n.toLocaleString('es-PE')}` : esc(v);
};

function pagina(params) {
    const recibidos = new Map(params);
    const faltan = ESPERADOS.filter((k) => !recibidos.has(k));
    const sobran = [...recibidos.keys()].filter((k) => !ESPERADOS.includes(k));
    // La URL PELADA es el desenlace de cualquier falla del prellenado, y es justo lo que hay que poder
    // reconocer de un vistazo: sin este cartel se ve igual que un prellenado bueno.
    const pelada = faltan.length >= ESPERADOS.length - 1;

    const fila = (k) => `<tr><th>${esc(k)}</th><td>${
        /Value|Amount/.test(k) ? plata(recibidos.get(k)) : esc(recibidos.get(k))
    }</td></tr>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Simulador Cuotéalo · simulado por el harness</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 :root { color-scheme: light }
 body { font: 15px/1.55 system-ui, sans-serif; margin: 0; padding: 24px; color: #1a1a2e; background: #fff }
 .marca { display: flex; align-items: center; gap: 10px; margin-bottom: 4px }
 .marca b { font-size: 20px; color: #0033a0 }
 .nota { background: #fff8e1; border-left: 4px solid #ffc107; padding: 12px 14px; border-radius: 6px;
         margin: 16px 0; font-size: 13px; color: #5d4a00 }
 .peligro { background: #fdecea; border-left-color: #d32f2f; color: #7f1d1d }
 h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #666; margin: 22px 0 8px }
 table { border-collapse: collapse; width: 100%; font-size: 14px }
 th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top }
 th { width: 42%; font-weight: 600; color: #444 }
 td { font-variant-numeric: tabular-nums }
 .vacio { color: #999; font-style: italic }
 code { background: #f4f4f8; padding: 1px 5px; border-radius: 4px; font-size: 13px }
</style></head><body>
 <div class="marca"><b>Cuotéalo</b> <span style="color:#888">· BCP</span></div>
 <div style="color:#666;font-size:13px">Simulador vehicular</div>

 <div class="nota${pelada ? ' peligro' : ''}">
   <b>Esta pantalla la sirve el harness, no BCP.</b>
   ${pelada
        ? 'Y llegó <b>sin prellenado</b>: la URL vino pelada, que es el desenlace de cualquier falla '
          + 'de <code>buildVehicleSimulatorUrl</code>. En un ambiente real esto se ve exactamente igual '
          + 'que un prellenado correcto — por eso el front lo llama «fallo mudo».'
        : 'No calcula cuotas: existe para poder VER el paso y comprobar qué le llegó. '
          + 'Contra BCP este iframe queda en blanco desde <code>localhost</code>, porque su '
          + '<code>frame-ancestors</code> sólo admite los dominios desplegados de CreditOp.'}
 </div>

 <h2>Lo que recibió del wizard</h2>
 <table>${ESPERADOS.filter((k) => recibidos.has(k)).map(fila).join('')}</table>
 ${faltan.length ? `<h2>No llegaron</h2><p class="vacio">${faltan.map(esc).join(' · ')}</p>` : ''}
 ${sobran.length ? `<h2>No están en el contrato</h2><p class="vacio">${sobran.map(esc).join(' · ')}<br>
   Si el front empezó a mandar esto, actualizá <code>ESPERADOS</code> en el mock.</p>` : ''}
</body></html>`;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' && !url.search) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ mock: 'cuotealo', puerto: PORT, codigo: CODIGO, llamadas: llamadas.slice(-15) }, null, 2));
    }

    if (path === '/_control/reset') { llamadas.length = 0; return res.end('{"ok":true}'); }

    // ⚠ UNA PÁGINA QUE SE EMBEBE A SÍ MISMA, para poder comprobar lo único que este mock tiene que
    // garantizar: que un iframe lo renderice. Sin esto, verificarlo exige levantar el wizard con
    // `VITE_BCP_SIMULATOR_URL` puesto y reiniciarlo — y si el día de mañana alguien le mete una
    // cabecera que lo bloquee, el síntoma sería «el simulador sigue en blanco», que es exactamente el
    // problema que este mock vino a resolver. Acá se ve en dos segundos y sin nada más arriba.
    if (path === '/_prueba') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><title>¿se deja embeber?</title>
<style>body{font:14px system-ui;margin:0;padding:16px;background:#f4f4f8}
 iframe{width:100%;height:78vh;border:1px solid #ccc;border-radius:12px;background:#fff}</style>
<p><b>Prueba de embebido.</b> Si abajo se ve el simulador, el mock se deja meter en un iframe —
que es justo lo que el host real de BCP no permite desde <code>localhost</code>.</p>
<iframe src="/simulador?origin=creditop&productType=vehicular&brand=HONDA&model=WR-V%20Elite&version=SPORT%20(EX)&insuranceType=BANA&commissionRate=0.1&vehicleValue=60000&financingAmount=48000"></iframe>`);
    }

    const params = [...url.searchParams.entries()];
    llamadas.push({ at: new Date().toISOString(), path, params: Object.fromEntries(params) });
    log(`GET ${path} · ${params.length ? params.map(([k, v]) => `${k}=${v}`).join(' · ') : '(sin parámetros — URL PELADA)'}`);

    // ⚠ SIN `X-Frame-Options` Y CON `frame-ancestors *`: ser embebible es el punto de este mock. El host
    // real manda SAMEORIGIN y por eso el iframe queda en blanco; si acá se colara una cabecera de esas
    // —por un proxy, por un default de framework— el mock reproduciría el problema en vez de resolverlo.
    res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': 'frame-ancestors *',
        'cache-control': 'no-store',
    });
    res.end(pagina(params));
});

server.listen(PORT, () => log(`escuchando en :${PORT} — apuntá VITE_BCP_SIMULATOR_URL=http://localhost:${PORT}/simulador`));

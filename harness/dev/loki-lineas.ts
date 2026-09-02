// Lee los CUERPOS crudos de Loki para un selector y una ventana — lo que la sonda de `trazador-acceso`
// NO hace: ésa imprime los labels del stream, así que todo «mensaje» que se le extraiga es
// `{app=CreditopDev, …}`. Y `loki-trace.ts` ancla en un uReq, que no existe cuando el flujo murió antes
// de crear la solicitud. Este hueco costó cinco intentos el 2026-09-02.
//
//   E2E_TARGET=dev node dev/loki-lineas.ts '{service_name="CreditopDev"} |~ `1828230`' 2026-09-02T14:12:00Z 2026-09-02T14:17:00Z
//
// ⚠ El PHP de dev Y de qa loguea como service_name="CreditopDev" con environment=development: por
// label no se distinguen (F-179). Y el selector `legacy-backend` que uno probaría primero no matchea.
import { lokiConfig } from '../pkg/loki.ts';
const c: any = lokiConfig();
const [q, desde, hasta] = [process.argv[2], process.argv[3], process.argv[4]];
const start = BigInt(Date.parse(desde)) * 1_000_000n, end = BigInt(Date.parse(hasta)) * 1_000_000n;
const u = new URL(c.url.replace(/\/$/, '') + '/loki/api/v1/query_range');
u.searchParams.set('query', q); u.searchParams.set('start', String(start)); u.searchParams.set('end', String(end));
u.searchParams.set('limit', '500'); u.searchParams.set('direction', 'forward');
const auth = 'Basic ' + Buffer.from(`${c.user}:${c.token}`).toString('base64');
const r = await fetch(u, { headers: { authorization: auth } });
const j: any = await r.json();
const lineas: [string, string][] = [];
for (const s of j?.data?.result ?? []) for (const [ns, l] of s.values) lineas.push([ns, l]);
lineas.sort((a, b) => (a[0] < b[0] ? -1 : 1));
for (const [ns, l] of lineas) {
  const t = new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(11, 19);
  let msg = l; try { const o = JSON.parse(l); msg = (o.message ?? o.msg ?? l) + (o.context ? '  ' + JSON.stringify(o.context).slice(0, 220) : ''); } catch {}
  console.log(t, '·', String(msg).slice(0, 300));
}
console.log(`-- ${lineas.length} líneas`);

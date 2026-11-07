// CASO REVERSIBLE POR API · un cupón de VTEX: crearlo, comprobarlo y archivarlo.
//
//   make jarvis-recipe APP=vtex RECIPE=coupon [ARGS='--code jarvis… | --keep | --archive <código>']
//
// Sale de la grabación del admin (`coupon-screen.ts` → `jarvis/maps/vtex/cases/coupon.json`). Acá el admin llama
// directo a la API REST de promociones, la misma que acepta la llave de la cuenta:
//   crear     POST /api/rnb/v1/pvt/coupon                  { couponCode, utmSource, utmCampaign, maxUsage, … }
//   leer      GET  /api/rnb/v1/pvt/coupon/<código>          ← trae `isArchived`: es la comprobación
//   archivar  POST /api/rnb/v1/pvt/archive/coupon/<código>  (sin cuerpo)
// Un cupón no se borra: se archiva. VTEX guarda el código en minúsculas. Sin promoción ligada, no descuenta nada.
// ⚠ La lectura de un cupón queda en CACHÉ (medido el 2026-11-07): si se lee ANTES de archivar, sigue diciendo
// `isArchived: false` por minutos, con o sin un parámetro distinto en la URL. Sin esa lectura previa, a los 2 s ya
// dice `true`. Por eso la creación se comprueba con la respuesta del POST y el cupón se lee recién después de
// archivar (con `?_=<ahora>` y reintentos hasta 15 s). Archivar no cambia `lastModifiedUtc`.
// ESCRIBE en las promociones de la cuenta de pruebas `creditop` (y lo archiva).
import '../args.ts';
import { hosts, must } from './api.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const base = `${hosts.store}/api/rnb/v1/pvt`;

async function archive(code: string) {
    await must('archivar el cupón', 'POST', `${base}/archive/coupon/${encodeURIComponent(code)}`);
    let archived = false;
    for (let i = 0; i < 15 && !archived; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        archived = (await must('leer el cupón', 'GET', `${base}/coupon/${encodeURIComponent(code)}?_=${Date.now()}`)).isArchived;
    }
    if (!archived) throw new Error(`archivé el cupón ${code} pero a los 15 s no figura archivado`);
    say(`archivado: ${code} (isArchived)`);
}

if (flag('archive')) {
    await archive(flag('archive')!.toLowerCase());
    process.exit(0);
}

const code = (flag('code') || `jarvis${Date.now().toString(36)}`).toLowerCase();
const created = await must('crear el cupón', 'POST', `${base}/coupon`, {
    couponCode: code, utmSource: 'jarvis', utmCampaign: 'pruebas-jarvis',
    maxUsage: null, maxItemsPerClient: 0, expirationIntervalPerUse: '00:00:00',
});
if (created?.couponCode !== code || created?.isArchived) throw new Error(`el cupón ${code} no quedó activo: ${JSON.stringify(created)}`);
say(`creado y comprobado: ${code} · ${hosts.admin}/coupons`);

if (!argv.includes('--keep')) await archive(code);
if (JSON_OUT) console.log(JSON.stringify({ recipe: 'vtex/coupon', code, archived: !argv.includes('--keep') }));

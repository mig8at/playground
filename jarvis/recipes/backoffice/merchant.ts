// SÓLO LECTURA · ¿cómo está configurado este comercio en el backoffice nuevo? Datos, salud, puntos de venta, entidades
// con su alcance de reglas, qué entidad está prendida en qué punto de venta (y por qué no se puede prender), ecommerce
// y productos, en una sola salida.
//
//   make jarvis-recipe APP=backoffice RECIPE=merchant ARGS='368'
//   make jarvis-recipe APP=backoffice RECIPE=merchant ARGS='BUSINESS_FINANDINA --json'
//
// Llama a la misma API que la ficha del comercio, con tu sesión, desde una pestaña del backoffice en tu Chrome
// (`backoffice/api.ts`). En dev, lo de legacy-backend lo atiende el despliegue de la rama `lab`, sobre la base que
// comparten dev, qa y staging: lo que se ve acá es lo que ven esos tres ambientes.
// ⚠ No lee credenciales: sólo si están y en qué nivel, como la pantalla.
// ⚠ Necesita una sesión del backoffice en tu Chrome (entrar una vez a backoffice.dev.creditop.com).
import '../args.ts';
import { dataOf, errorOf, findMerchant, openBackoffice } from './api.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const ref = argv.find((a) => !a.startsWith('--'));
if (!ref) {
    console.error('falta el comercio: un id, el nombre o el hash de una sucursal');
    process.exit(2);
}
const say = (s = '') => { if (!JSON_OUT) console.log(s); };

const { call, close, origin } = await openBackoffice('dev');
try {
    const merchant = await findMerchant(call, ref);
    const id = merchant.id;
    const get = async (p: string) => {
        const r = await call('GET', `/api/backoffice/merchants/${id}${p}`);
        return r.ok ? dataOf(r) : { error: `${r.status} ${errorOf(r)}` };
    };
    const [health, branches, lenders, activations, scopes, ecommerce, products] = await Promise.all([
        get('/health'), get('/branches'), get('/lenders'), get('/activations'), get('/rule-scopes'), get('/ecommerce'), get('/products'),
    ]);
    const report = { origin, merchant, health, branches, lenders, activations, scopes, ecommerce, products };
    if (JSON_OUT) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        say(`  ${merchant.name} · comercio ${id} · ${origin}/merchants/${id}`);
        say(`  salud: ${health?.headline ?? health?.error} (${health?.failing ?? '?'} fallan de ${health?.total ?? '?'})`);
        for (const b of branches?.branches ?? []) say(`  punto de venta ${b.id} «${b.name}» · hash ${b.hash ?? '—'} · ${b.address ?? ''}`);
        const names = new Map((activations?.activations?.lenders ?? []).map((l: any) => [l.id, l]));
        for (const s of scopes?.lenders ?? []) say(`  entidad ${s.lenderId} «${s.lenderName}» · reglas de ${s.scope === 'lender' ? 'la entidad' : 'el comercio'}${s.reviewReason ? ` · revisar: ${s.reviewReason}` : ''}`);
        for (const c of activations?.activations?.cells ?? []) {
            const l: any = names.get(c.lenderId);
            say(`  ${l?.name ?? c.lenderId} en ${c.branchId}: ${c.on ? 'PRENDIDA' : 'apagada'}${c.canEnable ? '' : ` · no se puede prender: ${c.reason}`}`);
        }
        say(`  ecommerce: ${(ecommerce?.ecommerce?.rows ?? []).length} tienda(s) · productos: ${(products?.products ?? []).length}`);
    }
} finally {
    await close();
}

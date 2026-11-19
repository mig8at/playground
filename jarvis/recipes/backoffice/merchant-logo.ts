// ESCRIBE · el logo de un comercio, por el backoffice nuevo: por defecto uno de letra (círculo de color con la primera
// letra del nombre, el de `connectors/admin/avatar.go`), o una imagen con `--file`.
//
//   make jarvis-recipe APP=backoffice RECIPE=merchant-logo ARGS='368'
//   make jarvis-recipe APP=backoffice RECIPE=merchant-logo ARGS='BUSINESS_FINANDINA --file logo.png'
//
// ESCRIBE `allieds.image` del comercio en la base que comparten dev, qa y staging, y sube la imagen al bucket del
// backoffice (el logo anterior no se borra). Es lo mismo que «Marca → Logo → Guardar cambios», con tu sesión
// (`POST /api/backoffice/merchants/<id>/images/logo`, `{contentType, data}` en base64).
// ⚠ Desde CORE-562 el guardado puede fallar con «Unknown column 'show_products' in 'OLD'»: los triggers de
// auditoría de `allieds` siguen nombrando columnas que se borraron. La imagen queda en el bucket y el comercio no
// cambia; la pantalla no lo avisa (el modal queda abierto). La receta lo dice y sale 1.
import '../args.ts';
import fs from 'node:fs';
import path from 'node:path';
import { dataOf, errorOf, findMerchant, openBackoffice } from './api.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const file = flag('file');
const ref = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--file');
if (!ref) {
    console.error('falta el comercio: un id, el nombre o el hash de una sucursal');
    process.exit(2);
}

// La misma paleta y el mismo hash (FNV-1a del nombre sin el prefijo de la automatización) que avatar.go.
function letterAvatarSvg(name: string): string {
    const palette = ['#1A73E8', '#D93025', '#188038', '#E37400', '#9334E6', '#007B83', '#C5221F', '#3949AB'];
    const clean = name.replace(/^PRUEBA AUTO\s*/, '').trim();
    let h = 0x811c9dc5;
    for (const b of Buffer.from(clean)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    const letter = (clean.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]/) ?? ['?'])[0];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128" fill="${palette[h % palette.length]}"/>`
        + `<text x="128" y="172" font-size="120" font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
}

const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const { call, close, origin } = await openBackoffice('dev');
let failed = false;
try {
    const merchant = await findMerchant(call, ref);
    let contentType: string;
    let data: string;
    if (file) {
        contentType = types[path.extname(file).toLowerCase()] ?? '';
        if (!contentType) throw new Error(`tipo de imagen no aceptado: ${file} (png, jpg, webp o svg)`);
        data = fs.readFileSync(file).toString('base64');
    } else {
        contentType = 'image/svg+xml';
        data = Buffer.from(letterAvatarSvg(merchant.name)).toString('base64');
    }
    const r = await call('POST', `/api/backoffice/merchants/${merchant.id}/images/logo`, { contentType, data });
    const after = await findMerchant(call, String(merchant.id));
    const result = { merchant: merchant.id, name: merchant.name, status: r.status, ok: r.ok, logo: after?.logoUrl ?? after?.image ?? null, error: r.ok ? null : errorOf(r) };
    failed = !r.ok;
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    else if (r.ok) console.log(`  logo guardado · ${merchant.name} (${merchant.id}) · ${result.logo ?? 'ver la ficha'} · ${origin}/merchants/${merchant.id}?tab=brand`);
    else console.log(`  ✗ no se guardó (${r.status}): ${result.error}${/in 'OLD'/.test(result.error ?? '') ? '\n    → los triggers de auditoría de allieds nombran columnas borradas por CORE-562: la imagen subió al bucket, el comercio no cambió' : ''}`);
    void dataOf;
} finally {
    await close();
}
process.exit(failed ? 1 : 0);

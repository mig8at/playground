// montar-peru.ts — deja un COMERCIO PERUANO usable en local, para mirar el wizard con su país puesto.
//
// POR QUÉ HACE FALTA. Perú ya está entero como PAÍS en local —`PEN`, `+51`, 9 dígitos de celular,
// `["DNI","CE"]`, `es-PE`, `is_operating`— pero **no hay ni un comercio que lo use**: el dump local trae
// 266 colombianos y 2 dominicanos. Sin un comercio no hay hash, y sin hash no hay pantalla que mirar:
// todo lo que la tanda de internacionalización cambió viaja en el payload del comercio.
//
// ⚠⚠ CONFIG DE PRUEBA, NO DE NEGOCIO. Las reglas de riesgo y los costos se copian de un comercio
// colombiano sin revisarlas — sirve para EJERCITAR las pantallas, no para concluir nada sobre a quién se
// le ofrece qué en Perú.
//
// ⚠ Sólo LOCAL. Aborta contra cualquier otro target: esto ESCRIBE, y `dev` es compartido.
//
// Uso:  node dev/montar-peru.ts            (idempotente: no pisa lo que ya exista)

process.env.E2E_TARGET ||= 'local';
export {};

if ((process.env.E2E_TARGET || '').toLowerCase() !== 'local') {
    console.log(`\n  ✗ esto ESCRIBE y sólo corre en local (E2E_TARGET=${process.env.E2E_TARGET}).\n`);
    process.exit(2);
}

const { one, query, exec, close } = await import('../pkg/db.ts');
const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PERU = 167;
const NOMBRE = 'Comercio pruebas Perú';
const SLUG = 'comercio-pruebas-peru';
const SUCURSAL = 'Lima · Miraflores';

const paso = (t: string, d = '') => console.log(`  ${t}${d ? ` · ${d}` : ''}`);

// ── el país tiene que estar configurado; si no, lo que se vea no prueba nada ────────────────────────
const pais = await one<{
    id: number; name: string; phone_code: string; cell_phone_lenght: string;
    currency: string; locale: string; document_types: string; is_operating: number;
}>(`SELECT id, name, phone_code, cell_phone_lenght, currency, locale, document_types, is_operating
    FROM countries WHERE id = ${PERU}`);

if (!pais || !pais.is_operating) {
    console.log('\n  ✗ Perú no está operando en esta base. Corré las migraciones de país primero.\n');
    await close();
    process.exit(2);
}
console.log(`\n  Perú (${PERU}) · ${pais.currency} · ${pais.phone_code} · ${pais.cell_phone_lenght} dígitos · ${pais.document_types}\n`);

// ── el comercio ────────────────────────────────────────────────────────────────────────────────────
let comercio = await one<{ id: number }>(`SELECT id FROM allieds WHERE slug = '${SLUG}' LIMIT 1`);
if (comercio) {
    paso('comercio', `ya existía (${comercio.id})`);
    await exec(`UPDATE allieds SET country_id = ${PERU},
                       quaternary_color = COALESCE(NULLIF(TRIM(quaternary_color), ''), 'FFFFFF')
                WHERE id = ${comercio.id}`);
} else {
    // La categoría se toma de un comercio que ya exista: es una FK y su catálogo varía entre dumps.
    const cat = await one<{ c: number }>('SELECT allied_caterogy_id AS c FROM allieds WHERE allied_caterogy_id IS NOT NULL LIMIT 1');
    // ⚠ `quaternary_color` va SIEMPRE, y no es cosmético: es el color del TEXTO de los botones, y el
    // backend rellena el que falte con el color de FONDO (`AlliedInfoController`:
    // `$allied->quaternary_color ?? $allied->primary_color`). Sin él, los botones salen con el texto
    // invisible en 15 pantallas del wizard. Blanco es lo que usan 329 de los 330 comercios de prod.
    await exec(`INSERT INTO allieds (name, slug, allied_caterogy_id, country_id, status, primary_color, quaternary_color, created_at, updated_at)
                VALUES ('${NOMBRE}', '${SLUG}', ${cat?.c ?? 1}, ${PERU}, 1, '4c39ff', 'FFFFFF', NOW(), NOW())`);
    comercio = await one<{ id: number }>(`SELECT id FROM allieds WHERE slug = '${SLUG}' LIMIT 1`);
    paso('comercio', `creado (${comercio!.id})`);
}
const ALLIED = comercio!.id;

// ── la sucursal ────────────────────────────────────────────────────────────────────────────────────
let suc = await one<{ id: number; hash: string }>(`SELECT id, hash FROM allied_branches WHERE allied_id = ${ALLIED} LIMIT 1`);
if (suc) {
    paso('sucursal', `ya existía (${suc.id})`);
} else {
    // El hash es lo que viaja en la URL. Se deriva del id para que sea estable al volver a correr esto.
    await exec(`INSERT INTO allied_branches (allied_id, name, status, created_at, updated_at)
                VALUES (${ALLIED}, '${SUCURSAL}', 1, NOW(), NOW())`);
    suc = await one<{ id: number; hash: string }>(`SELECT id, hash FROM allied_branches WHERE allied_id = ${ALLIED} ORDER BY id DESC LIMIT 1`);
    if (!suc!.hash) {
        const h = (0x50e00000 + suc!.id).toString(16).padStart(8, '0');
        await exec(`UPDATE allied_branches SET hash = '${h}' WHERE id = ${suc!.id}`);
        suc!.hash = h;
    }
    paso('sucursal', `creada (${suc!.id}, hash ${suc!.hash})`);
}

// ── que el PANEL lo encuentre, sin depender de que alguien lo abra primero ─────────────────────────
//
// El panel lista los comercios de `MERCHANTS` pero saca el hash de `.flows.json`, y ese archivo está
// gitignoreado —trae el sub del asesor—. En una máquina limpia la tarjeta sale con «sin branch_hash en
// .flows.json», que se lee como que el montaje falló cuando en realidad falta el índice. Se escribe acá.
const flows = join(ROOT, '.flows.json');
try {
    const j = existsSync(flows) ? JSON.parse(readFileSync(flows, 'utf8')) : {};
    j.merchants ??= {};
    if (j.merchants[SLUG]?.branch_hash !== suc!.hash) {
        j.merchants[SLUG] = { ...(j.merchants[SLUG] ?? {}), branch_hash: suc!.hash };
        writeFileSync(flows, JSON.stringify(j, null, 2) + '\n');
        paso('.flows.json', `${SLUG} → ${suc!.hash}`);
    } else {
        paso('.flows.json', 'ya apuntaba bien');
    }
} catch (e) {
    paso('.flows.json', `no se pudo escribir (${(e as Error).message}) — la tarjeta del panel dirá «sin branch_hash»`);
}

console.log('');
console.log('  ── LO QUE SE PUEDE MIRAR ─────────────────────────────────────────────');
console.log(`  monto y celular:   http://localhost:5174/self-service/${suc!.hash}/solicitar`);
console.log('');
console.log(`  el payload:        curl -s http://localhost/api/loans/allied/${suc!.hash} | python3 -m json.tool`);
console.log('');
console.log('  ⚠ Perú tiene 0 ciudades cargadas, así que este comercio llega hasta el celular.');
console.log('    Datos personales pide ciudad y ahí se corta — es lo esperado, no un bug del wizard.');
console.log('');

await close();

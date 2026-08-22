// montar-rto.ts — deja el lender Rent to Own USABLE en local, con su rama de codeudor.
//
// POR QUÉ HACE FALTA. La migración que clona el RTO desde Motai Renting copia SÓLO tres tablas hijas
// —`credit_line_by_lenders`, `lenders_by_allied_branches` (visibilidad) y `lenders_by_allieds`
// (costos)— y su docblock declara lo que NO copia: «categorías de usuario y sus reglas, credenciales
// por aliado, ciudades, métodos de pago, requisitos y reglas. Clonar ese árbol entero crearía un
// gemelo a medias con reglas de riesgo copiadas sin revisar, que es peor que no tenerlas».
//
// Es la decisión correcta para producción y deja el lender INUTILIZABLE en local: sin categorías no
// resuelve política, sin política no lista, y sin listar no hay flujo que probar. Esto rellena ese
// hueco copiando del hermano más cercano (Motai RB, 170).
//
// ⚠⚠ ESTO ES CONFIG DE PRUEBA, NO DE NEGOCIO. Son reglas de riesgo copiadas sin revisar — exactamente
// lo que la migración desaconseja. Sirve para EJERCITAR el flujo; cualquier conclusión sobre conducta
// (a quién se le ofrece, con qué cupo) medida sobre esta config está midiendo al 170, no al RTO.
//
// Uso:  node dev/montar-rto.ts            (idempotente: no pisa lo que ya exista)

process.env.E2E_TARGET ||= 'local';
export {};

const { one, query, exec, close, appKey } = await import('../pkg/db.ts');
const { encryptLaravelString } = await import('../pkg/laravel-crypt.ts');

const MOLDE = 170;                       // Motai RB: mismo comercio, producto `rto`
const TIPO_TITULAR = 1, TIPO_COSIGNER = 3;

const paso = (t: string, d = '') => console.log(`  ${t}${d ? ` · ${d}` : ''}`);

const rto = await one<{ id: number }>("SELECT id FROM lenders WHERE slug='rent-to-own' LIMIT 1");
if (!rto) {
    console.log('\n  ✗ no existe el lender `rent-to-own`. Corré primero su migración:');
    console.log('    php artisan migrate --path=database/migrations/2026_08_15_140000_clone_motai_renting_lender_as_rent_to_own.php\n');
    await close();
    process.exit(2);
}
const DEST = rto.id;
console.log(`\n  Rent to Own = lender ${DEST}   ⚠ el id NO es estable entre ambientes (en qa es 205, en prod 193)\n`);

/** Copia filas de una tabla hija del molde al destino, sin pisar lo que ya haya. */
async function copiar(tabla: string, extra: (r: any) => Record<string, unknown> = () => ({})) {
    const ya = await query<any>(`SELECT id FROM ${tabla} WHERE lender_id=?`, [DEST]);
    if (ya.length) { paso(`${tabla}`, `ya tiene ${ya.length}, no se toca`); return 0; }
    const src = await query<any>(`SELECT * FROM ${tabla} WHERE lender_id=?`, [MOLDE]);
    for (const r of src) {
        const sobre = extra(r);
        const cols = Object.keys(r).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
        await exec(
            `INSERT INTO ${tabla} (${cols.map((c) => '`' + c + '`').join(',')}, created_at, updated_at) ` +
            `VALUES (${cols.map(() => '?').join(',')}, NOW(), NOW())`,
            cols.map((k) => k === 'lender_id' ? DEST : (k in sobre ? sobre[k] : r[k])));
    }
    paso(`${tabla}`, `copiadas ${src.length} del ${MOLDE}`);
    return src.length;
}

// 1· CATEGORÍAS + sus reglas. ⚠ Van las CUATRO: con una sola —la «Premium», la más estricta— un
//    cliente que no la pasa se queda sin categoría y la card desaparece del listado.
const cats = await query<any>('SELECT id FROM lender_users_categories WHERE lender_id=?', [DEST]);
if (cats.length) paso('lender_users_categories', `ya tiene ${cats.length}, no se toca`);
else {
    const src = await query<any>('SELECT * FROM lender_users_categories WHERE lender_id=? ORDER BY id', [MOLDE]);
    for (const c of src) {
        const cols = Object.keys(c).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
        const r = await exec(
            `INSERT INTO lender_users_categories (${cols.map((x) => '`' + x + '`').join(',')}, created_at, updated_at) ` +
            `VALUES (${cols.map(() => '?').join(',')}, NOW(), NOW())`,
            // todas exigen codeudor: en el catálogo del RTO SÓLO existe la rama con codeudor, así que
            // un tier sin él firmaría el contrato de renting — el hueco que el propio commit declara
            cols.map((k) => k === 'lender_id' ? DEST : k === 'requires_cosigner' ? 1 : c[k]));
        for (const g of await query<any>('SELECT * FROM lender_users_category_rules WHERE lender_users_category_id=?', [c.id])) {
            const rc = Object.keys(g).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
            // ⚠ y una copia de cada regla con tipo COSIGNER (3): la política del codeudor es de otro
            // TIPO que la del titular, y sin ella el endpoint de cupo tipo 3 no responde `has_quota`
            for (const tipo of [TIPO_TITULAR, TIPO_COSIGNER]) {
                await exec(
                    `INSERT INTO lender_users_category_rules (${rc.map((x) => '`' + x + '`').join(',')}, created_at, updated_at) ` +
                    `VALUES (${rc.map(() => '?').join(',')}, NOW(), NOW())`,
                    rc.map((k) => k === 'lender_id' ? DEST
                           : k === 'lender_users_category_id' ? r.insertId
                           : k === 'lender_users_category_type_id' ? tipo : g[k]));
            }
        }
    }
    paso('lender_users_categories', `copiadas ${src.length} con reglas de tipo titular Y codeudor`);
}

// 2· Proveedores de identidad — sin esto, `validation/providers` responde
//    «Lender has no primary identity validation provider configured».
await copiar('lender_identity_validation_types');

// 3· Reglas duras POR SUCURSAL. Cuelgan de `group_rules` (que es por sucursal), así que se copian
//    dentro de cada grupo donde el molde las tenga.
const gr = await query<any>(
    'SELECT r.* FROM lender_rules r JOIN group_rules g ON g.id=r.group_rule_id WHERE r.lender_id=?', [MOLDE]);
const yaGr = await query<any>('SELECT id FROM lender_rules WHERE lender_id=?', [DEST]);
if (yaGr.length) paso('lender_rules', `ya tiene ${yaGr.length}, no se toca`);
else {
    for (const r of gr) {
        const cols = Object.keys(r).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
        await exec(
            `INSERT INTO lender_rules (${cols.map((c) => '`' + c + '`').join(',')}, created_at, updated_at) ` +
            `VALUES (${cols.map(() => '?').join(',')}, NOW(), NOW())`,
            cols.map((k) => k === 'lender_id' ? DEST : r[k]));
    }
    paso('lender_rules', `copiadas ${gr.length} del ${MOLDE}`);
}

console.log(`
  Falta a mano, y no lo hace este script:
    · el catálogo `+"`cosigner_statuses`"+` — lo siembra un SEEDER, no la migración:
        php artisan db:seed --class=CosignerStatusesSeeder
    · el AML del codeudor — en local NO corre para nadie (cero filas en toda la base) y su
      endpoint está tras auth de sesión. Se inyecta con dev/inyectar-aml.ts <user_id>.
`);
await close();

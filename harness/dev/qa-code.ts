// qa-code — genera un código de preaprobado REAL en qa, el mismo que emitiría la app, para que QA
// pruebe el canje desde la pantalla del asesor (`/merchant/<hash>/codigo`).
//
//   make harness-qa-code [MERCHANT=<hash de sucursal>] [LENDER=<lender_id>] [USER_ID=<user_id>] [BATCH=<n>]
//   (los nombres de antes —harness-codigo-qa, COMERCIO, ENTIDAD, USUARIO, LOTE— siguen andando)
//
// Lo que resuelve solo, contra la base de qa y SOLO LEYENDO:
//   · el comercio: el `merchant_id` del servicio es el `allied_id` de la sucursal, no la sucursal —
//     el canje consulta con ése, así que un código generado con otro id no se encuentra nunca;
//   · la entidad: sin ENTIDAD, la primera habilitada en ESA sucursal, que es lo que hace que el listado
//     pueda mostrarla después;
//   · el cliente: sin USUARIO, el último cliente sintético («SYNTH PRUEBA», correo @creditop.com) con
//     celular y correo. El código queda atado a esa persona y la solicitud nace a su nombre, por eso el
//     default nunca es un usuario cualquiera de la base.
//
// La única escritura es la del propio servicio de códigos (crea el código, o devuelve el que ya estaba
// activo para el mismo cliente, comercio y entidad). Pide la VPN de DESARROLLO: con la de producción
// `*.inertia-develop` resuelve a otra red y todo parece caído (2026-09-24).
//
// ⚠ El E2E_TARGET se fija ANTES de importar `pkg/db.ts`: un `||=` no le gana a un import estático (F-187).
process.env.E2E_TARGET = 'qa';
const { query, close } = await import('../pkg/db.ts');
export {};   // sin imports estáticos (ver arriba), TypeScript lo leería como script y no aceptaría el await

const FRONT = 'https://originaciones-qa.dev.creditop.com';

const arg = (k: string) => (process.env[k] || '').trim();
const HASH = arg('MERCHANT') || arg('COMERCIO') || 'ec977139';   // Amoblando Pullman · Amoblando principal: donde se probó
const LENDER_ID = arg('LENDER') || arg('ENTIDAD');
const USER_ID = arg('USER_ID') || arg('USUARIO');

function fail(msg: string): never {
    console.error('✗ ' + msg);
    process.exit(1);
}

// La llamada al servicio es la de `pkg/client-code.ts`, la misma que usa el lanzador del panel.
const { requestServiceCode, ClientCodeSkip } = await import('../pkg/client-code.ts');
async function generate(userId: number, merchantId: number, lenderId: number): Promise<{ code: string; expired_at: string }> {
    try {
        return await requestServiceCode(userId, merchantId, lenderId);
    } catch (e: any) {
        fail(e instanceof ClientCodeSkip ? e.message : String(e?.message || e));
    }
}

// LOTE=<n>: n códigos por comercio de Colombia, para la lista de QA. Un comercio = su sucursal con más
// asesores con cuenta (el asesor sólo entra a la suya). Cada código usa un cliente sintético DISTINTO:
// el servicio devuelve el mismo código mientras siga activo para el mismo cliente, comercio y entidad,
// así que repetir el cliente no daría códigos nuevos. Las entidades se reparten en rueda.
// Escribe `.runs/qa-codes.json`, que es lo que se carga en la página.
const BATCH = Number(arg('BATCH') || arg('LOTE') || 0);
if (BATCH > 0) {
    try {
        const branches = await query(
            `SELECT ab.id, ab.hash, ab.name AS sucursal, a.id AS allied_id, a.name AS comercio,
                    (SELECT COUNT(*) FROM users u WHERE u.allied_branch_id = ab.id AND u.cognito_id IS NOT NULL) AS asesores
               FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id AND a.country_id = 47
              WHERE ab.status = 1 AND ab.name NOT LIKE 'Ecommerce%'
                AND EXISTS (SELECT 1 FROM lenders_by_allied_branches lab WHERE lab.allied_branch_id = ab.id AND lab.status = 1)
             HAVING asesores > 0 ORDER BY asesores DESC, ab.id`);
        const byMerchant = new Map<number, any>();
        for (const s of branches) if (!byMerchant.has(s.allied_id)) byMerchant.set(s.allied_id, s);
        const clients = await query(
            `SELECT id FROM users WHERE full_name = 'SYNTH PRUEBA' AND email LIKE '%@creditop.com'
               AND cell_phone <> '' AND cognito_id IS NULL ORDER BY id DESC`);
        // Sólo códigos del formato vigente. Si el servicio devuelve 4 dígitos, es un código viejo que
        // sigue activo para esa combinación (lo reusa hasta fin de mes): se saltea y se prueba otra.
        const CODE_FORMAT = /^[A-Z]{2}\d{4}$/;

        const generatedAt = new Date().toISOString();
        const codes: any[] = [];
        for (const s of byMerchant.values()) {
            const lenders = await query(
                `SELECT l.id, l.name FROM lenders_by_allied_branches lab JOIN lenders l ON l.id = lab.lender_id
                  WHERE lab.allied_branch_id = ? AND lab.status = 1 ORDER BY l.id`, [s.id]);
            // Todas las combinaciones cliente × entidad, en rueda, hasta juntar LOTE códigos nuevos.
            const pairs: [number, any][] = [];
            // Cada combinación exactamente una vez: en la vuelta r, el cliente j va con la entidad j+r.
            for (let r = 0; r < lenders.length; r++)
                for (let j = 0; j < clients.length; j++) pairs.push([clients[j].id, lenders[(j + r) % lenders.length]]);
            let collected = 0, skippedOld = 0;
            for (const [u, e] of pairs) {
                if (collected >= BATCH) break;
                const r = await generate(u, s.allied_id, e.id);
                if (!CODE_FORMAT.test(r.code)) { skippedOld++; continue; }
                collected++;
                codes.push({
                    id: `a${s.allied_id}-u${u}-l${e.id}`, code: r.code, expired_at: r.expired_at,
                    allied_id: s.allied_id, comercio: s.comercio, branch_id: s.id, sucursal: s.sucursal.trim(), hash: s.hash,
                    lender_id: e.id, lender: e.name, user_id: u, generated_at: generatedAt,
                });
            }
            console.log(`${collected < BATCH ? '⚠' : '✔'} ${s.comercio} · ${s.sucursal.trim()} (${s.hash}): ${collected} códigos nuevos`
                + (skippedOld ? ` (se saltearon ${skippedOld} viejos, todavía activos)` : '') + (collected < BATCH ? ` — faltan ${BATCH - collected}: no hay más combinaciones` : ''));
        }
        const fs = await import('node:fs');
        fs.mkdirSync('.runs', { recursive: true });
        fs.writeFileSync('.runs/qa-codes.json', JSON.stringify(codes, null, 1));
        console.log(`\n${codes.length} códigos en ${byMerchant.size} comercios → harness/.runs/qa-codes.json (vencen el ${codes[0]?.expired_at})`);
    } finally {
        await close();
    }
    process.exit(0);
}

try {
    const [branch] = await query(
        `SELECT ab.id, ab.name AS sucursal, ab.allied_id, a.name AS comercio, a.country_id
           FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`, [HASH]);
    if (!branch) fail(`no hay sucursal con hash '${HASH}' en qa.`);
    if (Number(branch.country_id) !== 47)
        console.warn(`⚠ ${branch.comercio} no es de Colombia: la opción «Usuario app» no aparece ahí y el canje se rechaza.`);

    const lenders = await query(
        `SELECT l.id, l.name FROM lenders_by_allied_branches lab JOIN lenders l ON l.id = lab.lender_id
          WHERE lab.allied_branch_id = ? AND lab.status = 1 ORDER BY l.id`, [branch.id]);
    if (!lenders.length) fail(`la sucursal ${branch.id} no tiene entidades habilitadas: el código no tendría a dónde llevar.`);
    const lender = LENDER_ID ? lenders.find((e: any) => String(e.id) === LENDER_ID) : lenders[0];
    if (!lender) fail(`la entidad ${LENDER_ID} no está habilitada en esa sucursal. Habilitadas: `
        + lenders.map((e: any) => `${e.id} ${e.name}`).join(' · '));

    const [client] = USER_ID
        ? await query(`SELECT id, full_name FROM users WHERE id = ? AND cell_phone <> '' AND email <> '' LIMIT 1`, [USER_ID])
        : await query(`SELECT id, full_name FROM users WHERE full_name = 'SYNTH PRUEBA' AND email LIKE 'qa%@creditop.com'
                        AND cell_phone <> '' AND cognito_id IS NULL ORDER BY id DESC LIMIT 1`);
    if (!client) fail(USER_ID ? `el usuario ${USER_ID} no existe o no tiene celular y correo: el canje daría CCO007.`
                                 : 'no hay clientes sintéticos en qa; pasá USUARIO=<id>.');

    const issued = await generate(Number(client.id), Number(branch.allied_id), Number(lender.id));

    console.log(`✔ código ${issued.code}   (vence el ${issued.expired_at})`);
    console.log(`   comercio  ${branch.comercio} · ${branch.sucursal} (sucursal ${branch.id} · comercio ${branch.allied_id} · hash ${HASH})`);
    console.log(`   entidad   ${lender.name} (${lender.id}) — la única que tiene que quedar en el listado`);
    console.log(`   cliente   ${client.full_name} (${client.id})`);
    console.log(`   canjealo  ${FRONT}/merchant/${HASH}/codigo   (con un asesor asignado a esa sucursal)`);
} finally {
    await close();
}

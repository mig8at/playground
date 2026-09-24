// codigo-qa — genera un código de preaprobado REAL en qa, el mismo que emitiría la app, para que QA
// pruebe el canje desde la pantalla del asesor (`/merchant/<hash>/codigo`).
//
//   make harness-codigo-qa [COMERCIO=<hash de sucursal>] [ENTIDAD=<lender_id>] [USUARIO=<user_id>]
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

const SERVICIO = process.env.CODE_SERVICE_URL || 'http://self-manager-api.inertia-develop:8082';
const FRONT = 'https://originaciones-qa.dev.creditop.com';

const arg = (k: string) => (process.env[k] || '').trim();
const HASH = arg('COMERCIO') || 'ec977139';   // Amoblando Pullman · Amoblando principal: donde se probó
const ENTIDAD = arg('ENTIDAD');
const USUARIO = arg('USUARIO');

function fallar(msg: string): never {
    console.error('✗ ' + msg);
    process.exit(1);
}

try {
    const [suc] = await query(
        `SELECT ab.id, ab.name AS sucursal, ab.allied_id, a.name AS comercio, a.country_id
           FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`, [HASH]);
    if (!suc) fallar(`no hay sucursal con hash '${HASH}' en qa.`);
    if (Number(suc.country_id) !== 47)
        console.warn(`⚠ ${suc.comercio} no es de Colombia: la opción «Usuario app» no aparece ahí y el canje se rechaza.`);

    const entidades = await query(
        `SELECT l.id, l.name FROM lenders_by_allied_branches lab JOIN lenders l ON l.id = lab.lender_id
          WHERE lab.allied_branch_id = ? AND lab.status = 1 ORDER BY l.id`, [suc.id]);
    if (!entidades.length) fallar(`la sucursal ${suc.id} no tiene entidades habilitadas: el código no tendría a dónde llevar.`);
    const entidad = ENTIDAD ? entidades.find((e: any) => String(e.id) === ENTIDAD) : entidades[0];
    if (!entidad) fallar(`la entidad ${ENTIDAD} no está habilitada en esa sucursal. Habilitadas: `
        + entidades.map((e: any) => `${e.id} ${e.name}`).join(' · '));

    const [cliente] = USUARIO
        ? await query(`SELECT id, full_name FROM users WHERE id = ? AND cell_phone <> '' AND email <> '' LIMIT 1`, [USUARIO])
        : await query(`SELECT id, full_name FROM users WHERE full_name = 'SYNTH PRUEBA' AND email LIKE 'qa%@creditop.com'
                        AND cell_phone <> '' AND cognito_id IS NULL ORDER BY id DESC LIMIT 1`);
    if (!cliente) fallar(USUARIO ? `el usuario ${USUARIO} no existe o no tiene celular y correo: el canje daría CCO007.`
                                 : 'no hay clientes sintéticos en qa; pasá USUARIO=<id>.');

    let res: Response;
    try {
        res = await fetch(`${SERVICIO}/api/v1/generate/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': String(cliente.id) },
            body: JSON.stringify({ merchant_id: Number(suc.allied_id), lender_id: Number(entidad.id) }),
            signal: AbortSignal.timeout(15_000),
        });
    } catch (e: any) {
        fallar(`no llegué al servicio de códigos (${SERVICIO}): ${e.cause?.code || e.message}. ¿Estás en la VPN de desarrollo?`);
    }
    const cuerpo: any = await res.json().catch(() => ({}));
    if (!res.ok || !cuerpo.code) fallar(`el servicio respondió HTTP ${res.status}: ${JSON.stringify(cuerpo)}`);

    console.log(`✔ código ${cuerpo.code}   (vence el ${cuerpo.expired_at})`);
    console.log(`   comercio  ${suc.comercio} · ${suc.sucursal} (sucursal ${suc.id} · comercio ${suc.allied_id} · hash ${HASH})`);
    console.log(`   entidad   ${entidad.name} (${entidad.id}) — la única que tiene que quedar en el listado`);
    console.log(`   cliente   ${cliente.full_name} (${cliente.id})`);
    console.log(`   canjealo  ${FRONT}/merchant/${HASH}/codigo   (con un asesor asignado a esa sucursal)`);
} finally {
    await close();
}

// dev/client-reset.ts — dejar libre la cédula de un cliente de prueba para repetir el registro, en un paso.
//
//   E2E_TARGET=local node dev/client-reset.ts --document 1031138508 [--apply]
//   E2E_TARGET=qa    node dev/client-reset.ts --phone 3119129800 [--apply]
//
// Junta lo que se hacía en tres comandos: mira el estado de la cédula (`pg client state`), da de baja al cliente por la
// papelera del admin (`pg admin client-disable`, que sólo actúa sobre la cuenta ACTIVA con la cédula EXACTA y perfil de
// cliente) y vuelve a mirar. Con `--phone` busca primero la cédula del cliente activo con ese celular.
//
// El admin de qa es el de dev (comparten base); producción no: el conector del admin la rechaza. Sin --apply sólo muestra.
// Los usuarios temporales (`TEMP-…`) que haya dejado un OTP a medias se informan y no se tocan: el registro siguiente los
// toma y les pide los datos.
import { clientState, type Target } from '../pkg/backend-reads.ts';
import { runPg, lastLine } from '../pkg/pg.ts';
import { query, close, TARGET } from '../pkg/db.ts';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (!process.env.E2E_TARGET) { console.error('  ✗ exportá E2E_TARGET explícito (local, dev, qa, staging): este comando escribe'); process.exit(2); }
if (TARGET === 'prod') { console.error('  ✗ producción no: ahí la baja se hace a mano en el admin (Usuarios → papelera)'); process.exit(2); }
const adminTarget = TARGET === 'qa' ? 'dev' : TARGET;

try {
    let doc = flag('--document');
    const phone = flag('--phone')?.replace(/^\+/, '');
    if (!doc && !phone) throw new Error('pasá --document <cédula> o --phone <celular>');
    if (doc && !/^\d{5,15}$/.test(doc)) throw new Error('--document va sólo con dígitos');
    if (phone && !/^\d{7,15}$/.test(phone)) throw new Error('--phone va sólo con dígitos');

    if (!doc && phone) {
        // El celular se guarda con o sin indicativo: se busca por cómo termina, entre clientes activos con cédula real.
        const rows = await query<{ document_number: string }>(
            "SELECT document_number FROM users WHERE cell_phone LIKE CONCAT('%', ?) AND status = 1 AND user_profile_id = 1 AND document_number NOT LIKE 'TEMP-%'", [phone]);
        if (rows.length !== 1) throw new Error(`hay ${rows.length} clientes activos con el celular …${phone} en ${TARGET}: pasá --document`);
        doc = rows[0].document_number;
        console.log(`  celular …${phone} → cédula ${doc}`);
    }

    const before = clientState(TARGET as Target, doc!);
    if (!before.active) {
        console.log(`  la cédula ${doc} ya está libre en ${TARGET}: no hay cliente activo, el próximo registro crea uno nuevo.`);
    } else {
        const a = before.active as Record<string, unknown>;
        console.log(`  ${TARGET}: cliente activo ${a.id} · ${a.first_name} / ${a.surname} · ${before.requests?.length ?? 0} solicitudes recientes`);
        const r = runPg(['admin', 'client-disable', '--target', adminTarget, '--document', doc!, ...(apply ? ['--apply'] : [])]);
        process.stdout.write(r.stdout.split('\n').map((l) => l && '  ' + l.trim()).join('\n'));
        if (r.status !== 0) throw new Error(`la baja falló: ${lastLine(r.stderr || r.stdout)}`);
        if (apply) {
            const after = clientState(TARGET as Target, doc!);
            console.log(after.active ? '  ✗ sigue habiendo un cliente activo: revisá' : `\n  ✓ la cédula ${doc} quedó libre en ${TARGET}`);
        }
    }
    if (phone) {
        const temps = await query<{ id: number }>("SELECT id FROM users WHERE cell_phone LIKE CONCAT('%', ?) AND status = 1 AND document_number LIKE 'TEMP-%'", [phone]);
        if (temps.length) console.log(`  · hay ${temps.length} usuario(s) temporal(es) con ese celular (${temps.map((t) => t.id).join(', ')}): no se tocan, el registro los toma`);
    }
} catch (e) {
    console.error('  ✗ ' + (e as Error).message);
    process.exitCode = 1;
} finally {
    await close();
}

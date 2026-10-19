// dev/setting.ts — tocar una setting de legacy-backend para una prueba, con foto y vuelta atrás (`pkg/settings-write.ts`).
//
//   E2E_TARGET=local node dev/setting.ts set <clave> '<json>' [--apply]          sólo local: fija el valor
//   E2E_TARGET=dev   node dev/setting.ts add <clave> <lista> <comercio> [--apply] agrega un comercio a la lista
//   E2E_TARGET=dev   node dev/setting.ts remove <clave> <lista> <comercio> [--apply]
//   E2E_TARGET=dev   node dev/setting.ts undo <foto.json> [--apply]             deshace desde la foto
//
// Sin --apply sólo muestra. En la base compartida (dev, qa y staging) sólo comercios «PRUEBA AUTO…» y sólo las settings de
// TEST_SETTING_KEYS. E2E_TARGET va SIEMPRE explícito: escribe.
import { settingSet, settingListAdd, settingListRemove, settingUndo } from '../pkg/settings-write.ts';
import { close, TARGET } from '../pkg/db.ts';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const [cmd, ...rest] = argv.filter((a) => a !== '--apply');

if (!process.env.E2E_TARGET) { console.error('  ✗ exportá E2E_TARGET explícito (local, dev…): este comando escribe'); process.exit(2); }

try {
    if (cmd === 'set' && rest.length === 2) {
        const c = await settingSet(rest[0], rest[1], apply);
        console.log(`  ${c.key} en ${c.target}\n    antes  ${c.before ?? '(no existe)'}\n    ahora  ${c.after}`);
        console.log(apply ? `  ✓ cambiado · deshacer: ${c.undo}` : '  (vista previa: repetí con --apply)');
    } else if ((cmd === 'add' || cmd === 'remove') && rest.length === 3 && /^\d+$/.test(rest[2])) {
        const fn = cmd === 'add' ? settingListAdd : settingListRemove;
        const c = await fn(rest[0], rest[1], Number(rest[2]), apply);
        console.log(`  ${c.key}.${rest[1]} en ${c.target}: ${cmd === 'add' ? 'agregar' : 'sacar'} el comercio ${rest[2]}\n    antes  ${c.before}\n    ahora  ${c.after}`);
        if (TARGET !== 'local') console.log('    ⚠ base COMPARTIDA: dev, qa y staging ven el cambio');
        console.log(apply ? (c.undo ? `  ✓ cambiado · deshacer: ${c.undo}` : '  · ya estaba así: no se escribió nada') : '  (vista previa: repetí con --apply)');
    } else if (cmd === 'undo' && rest.length === 1) {
        const r = await settingUndo(rest[0], apply);
        console.log(`  ${r.key}: ${r.restored ? '✓ ' : ''}${r.detail}`);
    } else {
        console.error('  uso: node dev/setting.ts set <clave> <json> | add|remove <clave> <lista> <comercio> | undo <foto> [--apply]');
        process.exitCode = 2;
    }
} catch (e) {
    console.error('  ✗ ' + (e as Error).message);
    process.exitCode = 1;
} finally {
    await close();
}

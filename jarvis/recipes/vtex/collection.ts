// CASO REVERSIBLE POR API · una colección del catálogo de VTEX: crearla, comprobarla y borrarla.
//
//   make jarvis-recipe APP=vtex RECIPE=collection [ARGS='--name "…" | --keep | --delete <id>']
//
// Sale de la grabación del admin (`collection-screen.ts` → `jarvis/maps/vtex/cases/collection.json`). El admin
// llama `createCollection` y `deleteCollection` por GraphQL (`vtex.catalog-graphql`, con la sesión de la persona);
// esa app envuelve la API REST del catálogo, que es la que acepta la llave de la cuenta:
//   crear    POST   /api/catalog/pvt/collection/        { Name, Description, Searchable, Highlight, DateFrom, DateTo }
//   borrar   DELETE /api/catalog/pvt/collection/<id>
//   listar   GET    /api/catalog_system/pvt/collection/search      ← para comprobar
// ⚠ `GET /api/catalog/pvt/collection/<id>` sigue devolviendo 200 con la colección ya borrada (medido el 2026-11-07: 15 s
// después y en los dos hosts; el DELETE repetido dice «Collection not found»). Lo que existe se comprueba en el listado.
// Como el admin: nombre y descripción, sin destacar ni buscar, desde ahora y con vencimiento lejano (el admin pone
// 49 años). Sin `--keep`, la borra al final y comprueba que ya no está en el listado.
// ESCRIBE en el catálogo de la cuenta de pruebas `creditop` (y lo deshace).
import '../args.ts';
import { call, hosts, must } from './api.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const base = `${hosts.catalog}/api/catalog/pvt/collection`;

async function listed(id: number): Promise<boolean> {
    const r = await must<{ items: { id: number }[] }>('listar las colecciones', 'GET', `${hosts.catalog}/api/catalog_system/pvt/collection/search?page=1&pageSize=200&orderByAsc=false`);
    return r.items.some((c) => Number(c.id) === id);
}

async function remove(id: number) {
    await must('borrar la colección', 'DELETE', `${base}/${id}`);
    if (await listed(id)) throw new Error(`borré la colección ${id} pero sigue en el listado`);
    say(`borrada: la colección ${id} ya no está en el listado`);
}

if (flag('delete')) {
    await remove(Number(flag('delete')));
    process.exit(0);
}

const name = flag('name') || `Jarvis API ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
const from = new Date();
const to = new Date(from); to.setFullYear(to.getFullYear() + 49);
const created = await must('crear la colección', 'POST', `${base}/`, {
    Name: name,
    Description: 'Colección de prueba de Jarvis.',
    Searchable: false,
    Highlight: false,
    DateFrom: from.toISOString(),
    DateTo: to.toISOString(),
});
const id = Number(created.Id);
say(`creada: «${name}» · id ${id}`);

if (!(await listed(id))) throw new Error(`creé la colección ${id} pero no aparece en el listado`);
say(`comprobada: ${hosts.admin}/collections/${id}`);

if (!argv.includes('--keep')) await remove(id);
if (JSON_OUT) console.log(JSON.stringify({ recipe: 'vtex/collection', id, name, deleted: !argv.includes('--keep') }));

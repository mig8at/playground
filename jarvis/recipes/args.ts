// Los flags de las recetas de antes del 2026-11-07, en castellano, siguen andando: las tareas guardan el comando exacto
// con que se hizo algo. Se importa PRIMERO en cada receta (`import '../args.ts'`): traduce process.argv al entrar y la
// receta sólo conoce los nombres en inglés.
const OLD = {
    '--nombre': '--name', '--precio': '--price', '--categoria': '--category', '--marca': '--brand',
    '--descripcion': '--description', '--oculto': '--hidden', '--producto': '--product', '--dejar': '--keep',
    '--borrar': '--delete', '--terminos': '--terms', '--codigo': '--code', '--archivar': '--archive',
    '--solo-borrar': '--only-delete', '--solo-archivar': '--only-archive', '--ultimos': '--last',
    '--preparar': '--prepare', '--descuento': '--discount',
};
process.argv = process.argv.map((a) => OLD[a] ?? a);

export {};

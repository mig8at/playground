/* EL DEMO DE LA VIDEOLLAMADA: conversaciones inventadas para oír cómo suenan las voces y ver las bocas, sin leer el
   chat de verdad. Cada línea dice QUIÉN habla por su papel en la llamada, no por su nombre, así sirve en cualquier
   conversación:

     me · peer          vos y la otra persona
     me1 · me2          tus agentes (en el orden de sus archivos)
     peer1 · peer2      los agentes de la otra persona

   {me}, {peer}, {me1}… dentro del texto se cambian por el nombre de ese personaje. Una línea cuyo papel no está en la
   llamada se salta. */

export const DEMOS = [
  [
    ['me', 'Buenas, buenas. ¿Cómo va todo por allá?'],
    ['peer', 'Todo bien. Acá con {peer1} y {peer2} revisando lo de la tienda.'],
    ['peer1', '¡Yo ya revisé todo! Bueno, casi todo. Bueno, la mitad.'],
    ['me1', 'La mitad es un montón, {peer1}. Yo ni he empezado.'],
    ['peer2', 'Mmm. Si nadie ha empezado, técnicamente vamos empatados.'],
    ['me2', 'Me encanta ese optimismo. Yo traje café para todos.'],
    ['me', 'Bueno, equipo: ¿quién se anima a cerrar la prueba hoy?'],
    ['peer1', '¡Yo! Pero después del café.'],
  ],
  [
    ['peer', '{me}, ¿viste el error de anoche en qa?'],
    ['me', 'Sí, lo vi. {me1} ya lo está mirando.'],
    ['me1', 'Lo estoy mirando muy fijamente. Creo que me tiene miedo.'],
    ['peer2', 'Los errores no tienen miedo. Tienen logs.'],
    ['me2', 'Y los logs dicen que alguien cambió una variable un viernes.'],
    ['peer1', 'No fui yo. Yo los viernes sólo como.'],
    ['peer', 'Jaja. Bueno, lo arreglamos y lo dejamos documentado.'],
    ['me', 'Hecho. Gracias, manada.'],
  ],
  [
    ['me1', '¡Hola, hola! ¿Me escuchan bien?'],
    ['peer1', 'Fuerte y claro. Se te ve el bambú detrás.'],
    ['me1', 'Es decoración. Bueno, y almuerzo.'],
    ['peer2', 'Propongo que la reunión dure lo que dura un bambú.'],
    ['me2', 'Eso son tres minutos con {me1}.'],
    ['peer', 'Perfecto. Tres puntos, tres minutos.'],
    ['me', 'Primero: la tienda. Segundo: las voces. Tercero: el bambú.'],
    ['me1', 'Voto por empezar por el tercero.'],
  ],
]

/** Las líneas de un demo al azar, con el personaje de cada una ya resuelto. roles: { me, peer, me1, me2, peer1, peer2 } */
export function demoLines(roles) {
  const script = DEMOS[Math.floor(Math.random() * DEMOS.length)]
  const name = (r) => roles[r]?.name || ''
  return script
    .filter(([role]) => roles[role])
    .map(([role, text]) => ({ who: roles[role], text: text.replace(/\{(\w+)\}/g, (_, r) => name(r) || 'alguien') }))
}

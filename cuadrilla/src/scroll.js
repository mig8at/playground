/* Trabar el fondo mientras hay un modal abierto.
   `showModal()` pone el diálogo en el top layer y bloquea el foco, pero NO frena el scroll de la
   página: si rodás la rueda sobre el backdrop, el contenido de atrás se mueve y el modal parece
   despegado de la página. Chrome y Safari se comportan distinto acá, así que se hace a mano. */
let abiertos = 0
let previo = ''

export function trabarFondo(trabar){
  const b = document.body
  if (trabar) {
    if (abiertos === 0) { previo = b.style.overflow; b.style.overflow = 'hidden' }
    abiertos++
  } else if (abiertos > 0) {
    abiertos--
    if (abiertos === 0) b.style.overflow = previo
  }
}

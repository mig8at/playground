// Cómo se juega (2026-10-17): las reglas para el jugador, en sus palabras, sacadas de REGLAS.md (la fuente: si cambia una
// regla, se cambia allá y acá). Las usa la pantalla «Cómo se juega» de /inicio y la sala de espera (lo básico de cada
// bando); el menú del juego las va a usar también. Los números salen de medidas.js, para que no se desfasen.
import {MODO_BOTIN as M,VIDA,PATRULLA,RELOJ} from '../engine/medidas.js';

const min=Math.round(M.duracion/60),horas=Math.round(M.duracion*RELOJ.escala/3600);
const precio=v=>'$'+Math.round(v*1e6).toLocaleString('es-CO');

export const SECCIONES=[
 {id:'juego',titulo:'El juego',lema:'Los ladrones juntan la meta en plata en sus guaridas; la policía los atrapa antes.',items:[
  ['Dos bandos, las mismas chances','Ladrones contra policías, del mismo tamaño (de 2 a 8 por bando). Cada bando tiene su objetivo y sus ayudas.'],
  ['Sin armas','Como un juego de patio: se roba, se huye y se atrapa con el cuerpo.'],
  [`Una ronda dura ${min} minutos`,`Son ${horas} horas de la ciudad: un minuto real es una hora. Empieza a cualquier hora del día o de la noche.`],
  ['Cómo se gana',`Los ladrones ganan si lo guardado en sus guaridas llega a la meta (${precio(M.meta)} por ladrón). La policía gana si tiene a todos los ladrones presos a la vez, o si se acaba el tiempo.`],
  ['Rescatar','Un ladrón libre puede sacar a sus compañeros presos desde la puerta de la comisaría.']]},
 {id:'ladron',titulo:'Ladrones',lema:'Robá, guardá y que no te agarren con las manos llenas.',items:[
  ['Lo que vale','Al acercarte, cada cosa que se puede robar dice su precio: un televisor, un joyero, un cuadro, la caja fuerte. Robarla la pone en tu mochila: no pesa y cabe todo.'],
  ['Guardar es lo que cuenta','La meta es del equipo y cuenta lo guardado en la caja de una guarida, no lo que llevás encima. Si te atrapan con botín, vas preso y se pierde.'],
  ['Tus guaridas','Las elige el juego cada ronda: un apartamento de la ciudad o una casa del monte. Sabés la dirección exacta y sólo tu banda abre la puerta.'],
  ['Casas ajenas','Forzá la chapa para entrar (toma unos segundos y se oye). Antes mirá por el visor si hay gente: si la hay, llaman a la policía. De día entre semana hay más casas vacías; de noche casi todas tienen gente, pero la calle está sola.'],
  ['Las cámaras','Si salís de un lugar con cámaras con la mochila llena, te graban: la policía tiene tu retrato. La ropa se cambia; la piel, el pelo y la barba no.'],
  ['Huir con el cuerpo',`Corré, saltá, subí a las azoteas y saltá de un techo a otro, o metete en una casa vacía. Tenés ${VIDA.max} de vida: una caída de más de ${VIDA.segura} m lastima y desde ${VIDA.mortal} m mata.`],
  ['De incógnito','Si un policía te pide los papeles, das un nombre falso con un oficio de verdad. Pero tu nombre no está en el censo: quedás marcado.']]},
 {id:'policia',titulo:'Policía',lema:'Encontrá al ladrón entre la gente y alcanzalo con el botín encima.',items:[
  ['Los avisos','Cada robo pone un punto en tu plano: una alarma, una llamada de los vecinos, una cámara.'],
  ['La cámara del robo','Andá al lugar y revisá la cámara: te da el retrato del que robó (piel, pelo, barba). Cuando lo tenés a la vista, lleva una marca.'],
  ['Pedir papeles','A cualquiera: dice quién es, en qué trabaja y dónde vive. El ladrón da un nombre que no está en el censo y queda marcado; si lleva botín, va preso.'],
  ['Atrapar','Alcanzalo y atrapalo. Con botín encima, a la cárcel y lo pierde; sin nada, una detención corta por sospecha.'],
  ['Dónde entrás','En las zonas comunes de los edificios (vestíbulo, escaleras, ascensor, pasillos, azotea), no en las casas. Si venías persiguiendo a un ladrón y se mete a su guarida, la puerta queda abierta: entrá y registrala.'],
  ['Las patrullas',`Hay ${PATRULLA.cuantas(3)} o más frente a la comisaría, según el tamaño. Se manejan como un auto y se dejan estacionadas donde sea. Sólo la policía las usa.`],
  ['Uniformada','Se te reconoce de lejos.']]},
 {id:'ciudad',titulo:'La ciudad',lema:'Una ciudad que vive sola: la gente trabaja, compra, estudia y vuelve a casa.',items:[
  ['Gente con nombre','Cada vivienda tiene su familia y cada persona su oficio y su semana. Al cruzarte con alguien ves su nombre y en qué trabaja.'],
  ['Los horarios','Los locales abren y cierran: de madrugada están trancados. El colegio llena las calles a las 7 y a las 15; las oficinas, a las 18.'],
  ['Sólo el dueño abre','Las casas y los apartamentos están cerrados; los portales de los edificios con vecinos, abiertos.'],
  ['De día y de noche','De día hay más casas vacías y más testigos en la calle. De noche la calle está sola y las casas, llenas.']]},
];

export const CONTROLES=[
 ['W A S D','moverse'],['Ratón','mirar'],['Shift','correr'],['Espacio','saltar'],['E','usar lo de cerca: robar, guardar, forzar, atrapar, pedir papeles, subir a la patrulla'],
 ['R','la otra acción: mirar por el visor, la cortina'],['M','el plano'],['T · F','vista detrás o en primera persona'],['Tab','el menú: el ladrón ve su botín, se cambia de ropa y ve su retrato en las noticias; la policía, los avisos, los retratos y el censo'],['Esc','soltar el ratón']];

// lo básico de cada bando, para la sala de espera
export const LO_BASICO={
 ladron:['Robá y guardá en la caja de tu guarida: sólo cuenta lo guardado.','Mirá por el visor antes de forzar una casa.','Si te graban, cambiate de ropa y escapá por los techos.'],
 policia:['Andá a los avisos y revisá la cámara del robo.','Pedí papeles: el ladrón no está en el censo.','Atrapalo con el botín encima; usá la patrulla para llegar antes.']};

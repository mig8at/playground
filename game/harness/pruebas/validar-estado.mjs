// El estado del mundo (2026-11-22, Miguel: «abrir y cerrar una ventana y que se guarde el estado, al igual que una puerta;
// eso va a servir luego en el modo multijugador»; engine/estadoMundo.js), en node:
//  · abrir y cerrar anota y borra (lo cerrado es lo de fábrica: no se guarda); repetir lo mismo no es un cambio;
//  · cada cambio sale como un dato chico {tipo, clave, valor, t}: lo que se mandaría por la red;
//  · lo guardado vuelve igual (JSON ida y vuelta) y lo que llega con otra forma —otro tipo, un valor que no es true, una
//    clave enorme— se descarta;
//  · la clave de una puerta es su lugar al centímetro: la misma puerta, la misma clave.
// Uso: node harness/pruebas/validar-estado.mjs
import {crearEstado,cambiar,abiertas,leerEstado,puertaClave,TIPOS} from '../../src/engine/estadoMundo.js';
const fallas=[];const f=(m,ej={})=>fallas.push(m+' '+JSON.stringify(ej));
const E=crearEstado();
const c1=cambiar(E,'ventanas','12:3:4',true);if(!c1||c1.tipo!=='ventanas'||c1.clave!=='12:3:4'||c1.valor!==true||typeof c1.t!=='number')f('abrir una ventana no da su cambio',c1);
if(cambiar(E,'ventanas','12:3:4',true)!==null)f('abrir una ventana abierta cuenta como cambio');
const p={cx:10.004,cz:5.5,cy:3.02};const kp=puertaClave(p);if(kp!==puertaClave({cx:10.0049,cz:5.5001,cy:3.04}))f('la misma puerta con dos claves',{kp});
cambiar(E,'puertas',kp,true);if(abiertas(E,'puertas')[0]!==kp)f('la puerta abierta no queda anotada');
cambiar(E,'ventanas','12:3:4',false);if(abiertas(E,'ventanas').length)f('cerrar no borra la ventana');
const vuelta=leerEstado(JSON.parse(JSON.stringify(E)));if(JSON.stringify(vuelta)!==JSON.stringify(E))f('lo guardado no vuelve igual',{vuelta});
const raro=leerEstado({ventanas:{a:true,b:1,['x'.repeat(200)]:true},hackeo:{c:true}});if(abiertas(raro,'ventanas').join()!=='a'||raro.hackeo)f('se acepta algo con otra forma',raro);
try{cambiar(E,'autos','x',true);f('se acepta un tipo desconocido');}catch{}
console.log(`estado · ${TIPOS.join(' y ')} · abrir, cerrar, guardar y volver · cada cambio, un dato para la red`);
console.log(`fallas: ${fallas.length}`);for(const x of fallas)console.log('  1\t'+x);process.exit(fallas.length?1:0);

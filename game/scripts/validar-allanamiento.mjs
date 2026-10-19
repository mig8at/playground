// El allanamiento (2026-10-18, Miguel: «si la policía lo está persiguiendo, o está con el tiempo del rastro, no puede
// meter el botín a la guarida; si lo hace, la policía la puede allanar luego de un tiempo y lo que encuentra se lo
// incauta a la banda, aunque no agarre al ladrón»; RASTRO y ALLANAMIENTO en medidas.js, engine/juego/ronda.js), en el
// 2D, en N ciudades, con la ronda de verdad (sus guaridas y lo robable):
//  · guardar con el rastro del robo encendido delata la guarida; antes de ALLANAMIENTO.espera s no se puede allanar, y
//    después la policía incauta TODO lo guardado ahí (lo descuenta del botín) y la guarida queda cerrada (no ofrece
//    guardar ni acepta más);
//  · guardar con el rastro ya apagado no la delata (allanar no hace nada);
//  · huir de los papeles también enciende el rastro (RASTRO.huyePapeles), y que un policía lo persiga, aunque no haya
//    rastro;
//  · antes del allanamiento la banda puede sacar lo guardado: vuelve a la mochila y el allanamiento no encuentra nada;
//  · las cuentas cierran siempre: lo guardado + lo incautado + lo de la mochila = lo robado;
//  · en el motor de los bots (partida.js, bots.js): un ladrón que guarda con el rastro encendido delata la guarida, y un
//    policía bot va a su puerta y, pasada la espera (no antes), la allana: incauta lo guardado, la cierra y descuenta.
// Uso: node scripts/validar-allanamiento.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {crearRonda,robar,guardar,allanar,sacar,huirPapeles,perseguido,usosRonda} from '../src/engine/juego/ronda.js';
import {RASTRO,ALLANAMIENTO,MODO_BOTIN as MB} from '../src/engine/medidas.js';
import {prepararCiudad,crearPartida,paso,empezar} from '../src/engine/juego/partida.js';
import {decidir} from '../src/engine/juego/bots.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const E=ALLANAMIENTO.espera;let casos=0,incautado=0;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 const nueva=()=>crearRonda(bp,{equipo:3}),ej={semilla:s};
 let R=nueva();if(R.guaridas.length<2){falla('la ronda tiene menos de dos guaridas',{...ej,n:R.guaridas.length});continue;}
 const rob=R.robables.filter(o=>o.valor>0),robado=()=>[...R.robados].reduce((a,id)=>a+R.robables.find(o=>o.id===id).valor,0);
 const cierra=(paso)=>{const d=R.botin+R.incautado+R.mochila-robado();if(Math.abs(d)>1e-9)falla('las cuentas no cierran',{...ej,paso,diferencia:d});
  const suma=R.guaridas.reduce((a,g)=>a+g.guardado,0);if(Math.abs(suma-R.botin)>1e-9)falla('lo guardado en las guaridas no suma el botín',{...ej,paso,suma,botin:R.botin});};
 const [g1,g2]=R.guaridas;
 // 1 · roba y guarda con el rastro encendido: la delata; no antes de la espera; después, incauta todo y la cierra
 robar(R,rob[0].id,0);const t1=RASTRO.robo/2,v1=guardar(R,t1,g1.id);casos++;
 if(!g1.delatada)falla('guardar con el rastro encendido no delata la guarida',{...ej,t:t1,rastro:RASTRO.robo});
 if(allanar(R,g1.id,t1+E-.5)!==null)falla('se pudo allanar antes de la espera',{...ej,t:t1+E-.5,espera:E});
 const inc=allanar(R,g1.id,t1+E);if(inc!==v1)falla('el allanamiento no incautó todo lo guardado',{...ej,guardado:v1,incauto:inc});else incautado+=inc;
 if(!g1.cerrada)falla('la guarida allanada no queda cerrada',ej);cierra('allanar');
 const u=usosRonda(R,g1.lugar,g1.caja.x,g1.caja.z).find(u=>u.id===g1.id);if(u?.accion==='guardar')falla('la guarida allanada sigue ofreciendo guardar',ej);
 robar(R,rob[1].id,200);if(guardar(R,200+RASTRO.robo+1,g1.id)!==0)falla('se pudo guardar en la guarida allanada',ej);
 // 2 · guarda con el rastro apagado: no la delata
 const t2=200+RASTRO.robo+1;guardar(R,t2,g2.id);casos++;if(g2.delatada)falla('guardar con el rastro apagado delata la guarida',{...ej,t:t2});
 if(allanar(R,g2.id,t2+E+10)!==null)falla('se allanó una guarida no delatada',ej);cierra('sin rastro');
 // 3 · huye de los papeles, guarda (delata) y la banda saca antes del allanamiento: no encuentran nada
 robar(R,rob[2].id,400);huirPapeles(R,400+RASTRO.robo+5);const t3=400+RASTRO.robo+5+RASTRO.huyePapeles-1,antes=g2.guardado,v3=guardar(R,t3,g2.id);casos++;
 if(!g2.delatada)falla('huir de los papeles no enciende el rastro (guardar no delata)',{...ej,t:t3});
 const sac=sacar(R,g2.id,t3+5);if(sac!==antes+v3)falla('sacar no devuelve todo lo guardado a la mochila',{...ej,guardado:antes+v3,saco:sac});cierra('sacar');
 const inc3=allanar(R,g2.id,t3+E);if(inc3!==0)falla('el allanamiento después de sacar encontró algo',{...ej,incauto:inc3});cierra('allanar vacía');
 // 4 · perseguido sin rastro: también delata
 R=nueva();const [h1]=R.guaridas;robar(R,R.robables.find(o=>o.valor>0).id,0);perseguido(R,500,true);guardar(R,500,h1.id);casos++;
 if(!h1.delatada)falla('guardar perseguido (sin rastro) no delata la guarida',ej);perseguido(R,600,false);cierra('perseguido');}
// ---- la ronda del jugador y el motor de los bots ven las mismas guaridas, en el mismo orden (el 3D las cruza por índice:
// guardar del jugador delata en el motor la i-ésima, y el allanamiento del motor vuelve a la ronda por su índice) ----
for(let s=S0;s<S0+N;s++)for(const eq of [2,3,5]){const bp=generateBlueprint({seed:s,team:eq}),R=crearRonda(bp,{equipo:eq,ronda:0}),P=crearPartida(prepararCiudad(bp),{equipo:eq,ronda:0});
 if(R.guaridas.length!==P.guaridas.length||R.guaridas.some((g,i)=>g.texto!==P.guaridas[i].nombre))falla('la ronda y el motor no tienen las mismas guaridas en el mismo orden',{semilla:s,equipo:eq,ronda:R.guaridas.map(g=>g.texto),motor:P.guaridas.map(g=>g.nombre)});}
// ---- el motor de los bots ----
let motor=0,espero=[];
for(let s=S0;s<S0+N;s++){const C=prepararCiudad(generateBlueprint({seed:s,team:3})),P=crearPartida(C,{equipo:3,ronda:0}),ej={semilla:s,motor:true};
 const a=P.agentes.find(b=>b.equipo==='ladron'),L=P.guaridas.find(g=>Math.hypot(g.puntos[0][0]-a.x,g.puntos[0][1]-a.z)<1)||P.guaridas[0];
 // (todos los ladrones con el rastro encendido toda la prueba: nadie saca el botín; éste, con 4 de botín, guarda)
 // (los otros ladrones, quietos en la comisaría como presos: así la policía no se va a perseguirlos y se mide sólo el allanamiento)
 for(const b of P.agentes)if(b.equipo==='ladron'){b.rastroHasta=1e9;if(b!==a){b.estado='preso';const [cx,cz]=C.comisaria.puntos[0];b.x=cx;b.z=cz;}}a.mochila=4;empezar(P,a,'guardar',L);
 let t0=null;while(P.t<MB.duracion&&!L.cerrada){if(a.accion?.tipo!=='guardar'&&!L.delatada)empezar(P,a,'guardar',L);
  if(L.delatada&&a.accion?.tipo!=='esconder'){a.accion=null;}decidir(P);paso(P);if(L.delatada&&t0==null)t0=P.t;
  if(L.cerrada&&P.t<L.delatada.allanable)falla('el motor allanó antes de la espera',{...ej,t:P.t,allanable:L.delatada.allanable});}
 motor++;if(!L.delatada){falla('en el motor, guardar con el rastro no delató la guarida',ej);continue;}
 if(!L.cerrada){falla('ningún policía bot allanó la guarida delatada',{...ej,delatada:L.delatada,t:P.t});continue;}
 espero.push(P.t-t0);if(P.stats.incautado<4-1e-9)falla('el allanamiento del motor no incautó lo guardado',{...ej,incautado:P.stats.incautado});
 if(Math.abs(P.botin-P.guaridas.reduce((x,g)=>x+g.guardado,0))>1e-9)falla('en el motor, el botín no es lo de las guaridas',ej);}
console.log(`motor · ${motor} ciudades · la policía bot allanó a los ${espero.map(x=>Math.round(x)).join('/')} s de delatada (la espera es ${E} s)`);
const total=[...fallas.values()].reduce((a,f)=>a+f.n,0);
console.log(`allanamiento · ${N} ciudades · ${casos} casos · espera ${E} s · rastro ${RASTRO.robo} s (robo) y ${RASTRO.huyePapeles} s (papeles) · incautado ${incautado.toFixed(1)}`);
console.log(`fallas: ${total}`);for(const [k,f] of fallas)console.log(`  ${k} (${f.n}): ${JSON.stringify(f.ej)}`);

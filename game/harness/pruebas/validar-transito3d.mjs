// Nivel 10 del probador: el tránsito en el 3D de verdad (2026-10-18; lib/traffic3d.js con engine/transito.js), sin
// pantalla. Abre /demo y hace andar el tráfico 120 s (a 30 pasos por segundo, sin dibujar), y mide:
//  · nadie entra a un cruce con semáforo con su luz en rojo (con amarillo sí: decidió que alcanzaba);
//  · hay quien se para con el rojo (los semáforos funcionan) y las luces de los semáforos están puestas;
//  · lo que siente el de adentro: de costado (v × giro por segundo) p99 ≤ TRANSITO.lateral + 0,5 m/s², y frenando, el
//    p99 ≤ la frenada cómoda y nunca más que la máxima (fuera de los sustos: no cuenta cuando frena por alguien que
//    cruza);
//  · nadie se queda trabado: ningún vehículo más de 60 s sin moverse (salvo esperando un verde).
// Uso: node scripts/validar-transito3d.mjs [ciudad=1] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
const [ciudad=1]=process.argv.slice(2);const N=await abrirNavegador();const fallas=[];let res={};
try{const P=await N.abrir(`http://localhost:5180/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.traffic&&d.acciones){clearInterval(t);r(1);}},300);})`,{tiempo:240000});
 res=await P.evaluar(`(async()=>{const d=window.__demo,T=d.traffic,{axis,semaforo}=T.debug,V=T.vehicles,{TRANSITO}=await import('/src/engine/medidas.js');
  const dt=1/30,pasos=120*30,lejos={x:-1e4,z:-1e4},est=V.map(v=>({yaw:v.yaw,speed:v.speed,j:null,quieto:0}));
  let rojos=0,entradas=0,amarillos=0,paradosRojo=0,maxQuieto=0;const lat=[],dec=[];let decMax=0;
  for(let k=0;k<pasos;k++){T.update(dt,{player:lejos,people:[]});
   V.forEach((v,i)=>{const e=est[i];let dy=v.yaw-e.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));const w=Math.abs(dy)/dt;if(v.speed>1&&w<3)lat.push(v.speed*w);
    const a=(e.speed-v.speed)/dt;if(a>.05){dec.push(a);decMax=Math.max(decMax,a);}
    // (la casilla de la trompa: ¿entró a un cruce con semáforo?)
    const fr=v.route&&(()=>{let acc=0;const f=v.s+v.len/2;for(const g of v.route){if(f<=acc+g.len)return g;acc+=g.len;}return v.route.at(-1);})();
    const enJ=fr&&!fr.exc&&axis(fr.cx,fr.cy)==='j'&&semaforo(fr.cx,fr.cy)?fr.cx+','+fr.cy:null;
    if(enJ&&e.j==null){entradas++;const L=T.debug.luz(fr.din[0]?'h':'v');if(L==='rojo')rojos++;if(L==='amarillo')amarillos++;}
    e.j=enJ;if(v.rojo&&v.speed<.2)paradosRojo++;
    if(v.speed<.05&&!v.rojo)e.quieto+=dt;else e.quieto=0;maxQuieto=Math.max(maxQuieto,e.quieto);e.yaw=v.yaw;e.speed=v.speed;});}
  const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:0;};
  const luces=T.group.children.filter(o=>o.isInstancedMesh&&o.material?.isMeshBasicMaterial).reduce((a,o)=>a+o.count,0);
  return {vehiculos:V.length,entradas,rojos,amarillos,paradosRojo:+(paradosRojo*dt).toFixed(0),luces,lat99:+q(lat,.99).toFixed(2),dec99:+q(dec,.99).toFixed(2),decMax:+decMax.toFixed(2),maxQuieto:+maxQuieto.toFixed(1),
   lateral:TRANSITO.lateral,comoda:TRANSITO.frena.comoda,maxima:TRANSITO.frena.maxima};})()`,{tiempo:300000});
 console.log(JSON.stringify(res));
 if(!res.entradas)fallas.push('ningún vehículo entró a un cruce con semáforo');
 if(res.rojos)fallas.push(`${res.rojos} entradas a un cruce con la luz en rojo`);
 if(!res.paradosRojo)fallas.push('nadie se paró con el rojo');
 if(!res.luces)fallas.push('no hay luces en los semáforos');
 if(res.lat99>res.lateral+.5)fallas.push(`de costado, p99 ${res.lat99} m/s² (más que ${res.lateral}+0,5)`);
 if(res.dec99>res.comoda+.3)fallas.push(`frenando, p99 ${res.dec99} m/s² (más que la cómoda ${res.comoda})`);
 if(res.decMax>res.maxima+.01)fallas.push(`frenó ${res.decMax} m/s² (más que la máxima ${res.maxima})`);
 if(res.maxQuieto>60)fallas.push(`un vehículo trabado ${res.maxQuieto} s`);
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`tránsito 3d · ciudad ${ciudad} · ${res.vehiculos??'—'} vehículos, 120 s · ${res.entradas??'—'} entradas a cruces con semáforo (${res.amarillos??'—'} con amarillo, ${res.rojos??'—'} con rojo) · ${res.paradosRojo??'—'} s esperando el verde · de costado p99 ${res.lat99??'—'} · frenando p99 ${res.dec99??'—'}, máx ${res.decMax??'—'} m/s²`);
 console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}

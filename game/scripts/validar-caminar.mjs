// El caminar de la gente, natural (2026-10-18, Miguel: «que las animaciones de los npc cuadren con la animación de
// caminar: se ven como si hicieran saltos bruscos de movimiento»). En el 2D (engine/juego/transeuntes.js, lo que el 3D
// —sociedad3d— pone cada cuadro), 30 s reales a 30 cuadros por segundo junto al colegio, a las 11 y a la salida (15),
// por persona y por cuadro (sin el primero en que aparece):
//  · la velocidad contra su paso (v): lo que avanza en un cuadro / dt / v —p99 ≤ CAMINAR_NATURAL.rapido, nunca más de
//    CAMINAR_NATURAL.salto (un salto)—;
//  · la aceleración (el cambio de la velocidad, en vector): p99 ≤ CAMINAR_NATURAL.acel m/s² (un tirón se ve);
//  · el giro del rumbo de la marcha, caminando (a más de 0,6 m/s: casi quieto se gira en el lugar): p99 ≤
//    CAMINAR_NATURAL.giro °/s;
//  · los pies: la animación de caminar va a ANIM.paso × su ritmo (characters3d moveCharacter: el ritmo, v / ANIM.paso
//    entre ANIM.min y ANIM.max); lo que patina —|avance real − avance de la animación| / avance real— p95 ≤
//    CAMINAR_NATURAL.patina;
//  · hacia dónde mira (o.rumbo) contra hacia dónde camina: p95 ≤ CAMINAR_NATURAL.mira °.
// Uso: node scripts/validar-caminar.mjs [semilla=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {RELOJ,CAMINAR_NATURAL as K,ANIM} from '../src/engine/medidas.js';
import {mapaDeJuego} from '../src/engine/juego/mapa.js';
import {crearTranseuntes} from '../src/engine/juego/transeuntes.js';
import {sociedadDe} from '../src/engine/sociedad.js';
const S0=+(process.argv[2]||1),H=3600,FPS=30,dt=1/FPS;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const bp=generateBlueprint({seed:S0,team:3}),S=sociedadDe(bp),mapa=mapaDeJuego(bp),col=[...S.lugares.values()].find(l=>l.tipo==='colegio');
const q=(a,p)=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
const ang=a=>Math.atan2(Math.sin(a),Math.cos(a));
for(const h of [11,15]){const T=crearTranseuntes(S,mapa),ini=(24+h)*H,prev=new Map(),rat=[],acel=[],giro=[],pat=[],mira=[];let max={rat:0};
 for(let s=0;s<30;s+=dt){const L=T.cerca(ini,s,col.x,col.z,90,120);
  for(const o of L){if(!o.camina){prev.delete(o.id);continue;}const p=prev.get(o.id),vx=p?(o.x-p.x)/dt:0,vz=p?(o.z-p.z)/dt:0,sp=Math.hypot(vx,vz);
   if(p&&p.n>=1){const r=sp/o.v;rat.push(r);if(r>max.rat)max={rat:r,id:o.id,s:+s.toFixed(2)};
    if(p.n>=2){acel.push(Math.hypot(vx-p.vx,vz-p.vz)/dt);if(sp>.6&&Math.hypot(p.vx,p.vz)>.6)giro.push(Math.abs(ang(Math.atan2(vx,vz)-Math.atan2(p.vx,p.vz)))/dt*180/Math.PI);}
    const ritmo=Math.max(ANIM.min,Math.min(ANIM.max,(o.vAnim??o.v)/ANIM.paso)),anim=ANIM.paso*ritmo;if(sp>.2)pat.push(Math.abs(sp-anim)/sp);
    if(sp>.3)mira.push(Math.abs(ang(o.rumbo-Math.atan2(vx,vz)))*180/Math.PI);}
   prev.set(o.id,{x:o.x,z:o.z,vx,vz,n:(p?.n??-1)+1});}
  for(const id of [...prev.keys()])if(!L.some(o=>o.id===id))prev.delete(id);}
 const m={rapido:q(rat,.99),salto:q(rat,1),acel:q(acel,.99),giro:q(giro,.99),patina:q(pat,.95),mira:q(mira,.95)};
 console.log(`caminar a las ${h} · ${rat.length} cuadros de gente caminando · velocidad/paso p99 ${m.rapido.toFixed(2)} (máx ${m.salto.toFixed(2)}) · aceleración p99 ${m.acel.toFixed(1)} m/s² · giro p99 ${m.giro.toFixed(0)} °/s · los pies patinan p95 ${(100*m.patina).toFixed(0)} % · mira p95 ${m.mira.toFixed(0)}°`);
 if(m.rapido>K.rapido)falla('se adelanta a su paso (tirones)',{hora:h,p99:+m.rapido.toFixed(2),max:K.rapido});
 if(m.salto>K.salto)falla('un salto de un cuadro a otro',{hora:h,max:+m.salto.toFixed(2),donde:max});
 if(m.acel>K.acel)falla('aceleración brusca',{hora:h,p99:+m.acel.toFixed(1),max:K.acel});
 if(m.giro>K.giro)falla('giros bruscos',{hora:h,p99:+m.giro.toFixed(0),max:K.giro});
 if(m.patina>K.patina)falla('los pies patinan (la animación no va con lo que avanza)',{hora:h,p95:+m.patina.toFixed(2),max:K.patina});
 if(m.mira>K.mira)falla('mira para otro lado de donde camina',{hora:h,p95:+m.mira.toFixed(0),max:K.mira});}
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`fallas: ${tot}`);

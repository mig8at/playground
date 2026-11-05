// Valida el núcleo (escalera + ascensor) en el PLANO, antes de cualquier 3D (2026-10-15).
// Uso: node scripts/validar-nucleos.mjs [ciudades=40] [semilla0=1]
// Por edificio de 2+ pisos, en cada piso: el núcleo y la escalera son los mismos que en planta baja (el 3D arma la
// escalera y el hueco de la losa con los de planta baja); ningún cuarto, pasillo ni el ascensor pisa la huella de la
// escalera; la escalera cabe en su núcleo; y su vano de entrada da a un pasillo o descanso (no a un cuarto).
// Y el volumen de la escalera armada (stairBoxes, las mismas cajas que dibuja el 3D, más la franja de losa sobre el vano):
// por el camino de subida, en cada punto, el cuerpo (radio 20 cm, de las rodillas a la coronilla: 0,4–1,85 m sobre la
// huella) no puede tocar ninguna caja. Así una escalera que se dibuja encima de la cabeza se ve antes de abrir el juego.
// Y que no quede un corte entre pisos (2026-10-16, Miguel: «la división entre pisos se ve un corte cuando subo»): en el
// hueco de cada losa, junto a cada pared y al borde del vano, algo cubre desde donde terminan los muros de abajo
// (ALTURA.cieloRaso − 2 cm) hasta el piso de arriba; y la pared del medio sube sin ranuras de la planta baja al último piso.
// Y el rincón bajo el carril B de planta baja: debajo, ALTURA.libre en todo su fondo, y detrás, cerrado del suelo arriba.
import {generateBlueprint} from '../src/engine/blueprint.js';
import {stairOf,stairBoxes,STAIRS} from '../src/lib/town3d.js';
import {ALTURA} from '../src/engine/medidas.js';
const FLOOR=ALTURA.piso;

const N=+(process.argv[2]||40),S0=+(process.argv[3]||1),E=1e-6;
const rectOfStair=s=>{const P=(a,b)=>[s.x+s.ux*a+s.vx*b,s.z+s.uz*a+s.vz*b],[x0,z0]=P(0,0),[x1,z1]=P(s.w||2,s.d);return {x:Math.min(x0,x1),y:Math.min(z0,z1),w:Math.abs(x1-x0),h:Math.abs(z1-z0)};};
const overlap=(a,b,m=.02)=>a.x+m<b.x+b.w&&b.x+m<a.x+a.w&&a.y+m<b.y+b.h&&b.y+m<a.y+a.h;
const inside=(a,b,m=.02)=>a.x>=b.x-m&&a.y>=b.y-m&&a.x+a.w<=b.x+b.w+m&&a.y+a.h<=b.y+b.h+m;
const same=(a,b,ks)=>a&&b&&ks.every(k=>Math.abs(a[k]-b[k])<1e-6);
const count={},ejemplos={};let edificios=0,conFallas=0,nooks=0;
const falla=(k,info)=>{count[k]=(count[k]||0)+1;(ejemplos[k]||(ejemplos[k]=[])).length<3&&ejemplos[k].push(info);};
for(let seed=S0;seed<S0+N;seed++){const bp=generateBlueprint({seed,team:3});
 for(const L of bp.lots){if(!L.levels||L.floors<2||!L.levels[0]?.stair)continue;edificios++;const s0=L.levels[0].stair,c0=L.levels[0].core,before=Object.values(count).reduce((a,b)=>a+b,0);
  const tag=f=>({ciudad:seed,lote:L.id,tipo:L.type,pisos:L.floors,piso:f});
  for(const lv of L.levels){const f=lv.level,s=lv.stair,sr=s&&rectOfStair(s);
   if(!s){falla('piso sin escalera',tag(f));continue;}
   if(!same(s,s0,['x','z','ux','uz','vx','vz','d']))falla('escalera distinta a la de planta baja',{...tag(f),pb:s0,aca:s});
   if(!same(lv.core,c0,['x','y','w','h']))falla('núcleo distinto al de planta baja',{...tag(f),pb:c0,aca:lv.core});
   if(!inside(sr,lv.core))falla('escalera fuera de su núcleo',{...tag(f),escalera:sr,nucleo:lv.core});
   for(const q of lv.rooms)if(overlap(q,sr))falla('cuarto sobre la escalera',{...tag(f),cuarto:q.type,q,escalera:sr});
   for(const q of lv.corridor)if(overlap(q,sr))falla('pasillo sobre la escalera',{...tag(f),q,escalera:sr});
   if(lv.liftRect&&overlap(lv.liftRect,sr))falla('ascensor sobre la escalera',{...tag(f),ascensor:lv.liftRect,escalera:sr});
   // (lo que sobra del núcleo además de la escalera y el ascensor: un hueco sin uso, encerrado)
   const area=lv.core.w*lv.core.h,shaft=lv.liftRect?(Math.abs(s.ux)>.5?lv.liftRect.w*lv.core.h:lv.core.w*lv.liftRect.h):0,used=sr.w*sr.h+shaft;if(area-used>.5)falla('núcleo con sobrante sin uso',{...tag(f),nucleo:lv.core,escalera:sr,ascensor:lv.liftRect});
   // (el vano de la escalera: su centro, medio metro hacia afuera del núcleo, tiene que caer en pasillo o descanso)
   const d=lv.doors.find(d=>d.stair);if(!d){falla('escalera sin vano',tag(f));continue;}
   const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,ox=mx-s.vx*.5,oz=mz-s.vz*.5,pt={x:ox-.01,y:oz-.01,w:.02,h:.02};
   const room=lv.rooms.find(q=>overlap(q,pt,0)),corr=lv.corridor.find(q=>overlap(q,pt,0));
   if(!corr&&room&&room.type!=='vestibulo')falla('el vano de la escalera da a un cuarto',{...tag(f),cuarto:room.type});
   if(!corr&&!room)falla('el vano de la escalera da a la nada',tag(f));
   for(const it of lv.furniture||[])if(overlap({x:it.x,y:it.y,w:it.w,h:it.h},lv.core))falla('mueble dentro del núcleo',{...tag(f),mueble:it.kind});}
  // (el volumen: las cajas de la escalera, como las arma el 3D)
  const ST=stairOf(s0,L.floors,FLOOR),{FR,BK,run}=ST,bx=[];
  stairBoxes(ST,STAIRS.madera[0],{floors:L.floors,FLOOR,hallC:'#fff',box:(x,y,z,sx,sy,sz,c,f)=>bx.push({x0:x-sx/2,x1:x+sx/2,y0:y,y1:y+sy,z0:z-sz/2,z1:z+sz/2,f}),boxes:[]});
  // (el corte entre pisos: los muros de abajo llegan a f·piso − piso + cieloRaso − 2 cm; el piso de arriba, a f·piso + 2 cm)
  const cubre=(a,b,y0,y1)=>{const [x,z]=ST.P(a,b),c=bx.filter(q=>q.x0<=x&&q.x1>=x&&q.z0<=z&&q.z1>=z&&q.y1>y0&&q.y0<y1).sort((p,q)=>p.y0-q.y0);let y=y0;for(const q of c){if(q.y0>y+.005)break;y=Math.max(y,q.y1);}return y>=y1-.005?null:+y.toFixed(3);};
  const A0=.07,A1=ST.W-.07,BD=ST.sd.d-.07;
  for(let f=1;f<L.floors;f++){const y0=f*FLOOR-FLOOR+ALTURA.cieloRaso-.02,y1=f*FLOOR+.02;
   const bordes=[['pared del carril A',t=>[A0-.005,FR+(BD-FR)*t]],['pared del carril B',t=>[A1+.005,FR+(BD-FR)*t]],['pared del fondo',t=>[A0+(A1-A0)*t,BD+.005]],['borde del vano',t=>[A0+(A1-A0)*t,FR-.005]]];
   for(const [k,pt] of bordes)for(const t of [.05,.3,.5,.7,.95]){const [a,b]=pt(t),y=cubre(a,b,y0,y1);if(y!=null){falla('corte entre pisos en el hueco de la escalera',{...tag(f),donde:k,a:+a.toFixed(2),b:+b.toFixed(2),cubreHasta:y,falta:+y1.toFixed(2)});break;}}}
  {const y=cubre(ST.HW,FR+run/2,.02,(L.floors-1)*FLOOR+.02);if(y!=null)falla('ranura en la pared del medio de la escalera',{...tag(0),cubreHasta:y});}
  if(ST.nook){nooks++;const {b1}=ST.nook;
   for(let b=FR+.1;b<b1-.05;b+=.2)for(const a of [ST.HW+.25,(ST.HW+A1)/2,A1-.15]){const [x,z]=ST.P(a,b),o=bx.find(q=>q.x0<x&&q.x1>x&&q.z0<z&&q.z1>z&&q.y1>.1&&q.y0<ALTURA.libre-.005);
    if(o){falla('rincón bajo la escalera más bajo que ALTURA.libre',{...tag(0),b:+b.toFixed(2),fondo:+o.y0.toFixed(2)});b=1e9;break;}}
   if(cubre((ST.HW+A1)/2,b1+.03,.02,ALTURA.libre)!=null)falla('rincón bajo la escalera abierto por detrás',tag(0));}
  for(let f=1;f<L.floors;f++){const r=ST.rect(0,0,ST.W,FR);bx.push({x0:r.x,x1:r.x+r.w,z0:r.z,z1:r.z+r.h,y0:f*FLOOR-.12,y1:f*FLOOR+.02,f,losa:true});}
  if(ST.HW-.12<.52+.3)falla('tramo angosto (menos de 30 cm de margen para el cuerpo)',{...tag(0),ancho:ST.W});
  for(let f=0;f<L.floors-1;f++){const base=f*FLOOR+.02,pts=[];
   for(let b=FR+.15;b<FR+run-.1;b+=.25)pts.push(['carril A',ST.HW/2,b,base+1.5*Math.min(1,(b-FR)/run)]);
   for(let a=.35;a<=ST.W-.35;a+=.3)pts.push(['descanso',a,FR+run+BK/2,base+1.5]);
   for(let b=FR+run-.15;b>FR+.1;b-=.25)pts.push(['carril B',ST.W-ST.HW/2,b,base+1.5+1.5*(1-(b-FR)/run)]);
   for(const [k,a,b,h] of pts){const [x,z]=ST.P(a,b),R=.2,y0=h+.4,y1=h+1.85;
    const o=bx.find(q=>q.x0<x+R&&q.x1>x-R&&q.z0<z+R&&q.z1>z-R&&q.y0<y1&&q.y1>y0);
    if(o){falla('algo de la escalera choca con la cabeza o el cuerpo',{...tag(f),donde:k,a:+a.toFixed(2),b:+b.toFixed(2),pies:+h.toFixed(2),caja:{piso:o.f,y0:+o.y0.toFixed(2),y1:+o.y1.toFixed(2),losa:!!o.losa}});break;}}}
  if(Object.values(count).reduce((a,b)=>a+b,0)>before)conFallas++;}}
console.log(`${N} ciudades (semillas ${S0}–${S0+N-1}) · ${edificios} edificios con escalera (${nooks} con rincón bajo el carril B) · ${conFallas} con fallas`);
for(const [k,n] of Object.entries(count).sort((a,b)=>b[1]-a[1])){console.log(`  ${n}\t${k}`);for(const e of ejemplos[k])console.log('     ',JSON.stringify(e));}
process.exitCode=conFallas?1:0;

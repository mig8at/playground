/* LAS ABERTURAS Y LO QUE SE VE POR ELLAS (2026-11-22, Miguel: «¿por qué no lo aterrizas en el motor 2D, así también podemos
   calcular?»; antes: «mostrar el interior por donde apunta la cámara: si está abierta la puerta, debería verse lo de adentro,
   al igual que si está abierta una ventana, similar a lo que hace GTA»). Puro, sobre el plano: el 3D sólo lo consulta
   (world3d updateInteriors) y validar-portales lo mide sin pantalla.
   · aberturasDe(bp): cada ventana —su clave lote:piso:ventana, la misma del paño del 3D— y cada puerta de calle, con su
     lugar (x, z en el mundo; y0..y1 de alto), su ancho, su eje (h: corre a lo largo de x), hacia dónde mira
     afuera (nx, nz) y su lote;
   · vistaDesde(bp, camara, abiertas): de las aberturas ABIERTAS, cuáles están en el campo de visión de la cámara y a menos
     de LEJOS m, mirándolas desde su lado de afuera —una ventana de la cara de atrás no se ve— (vistas) y cuáles de esas tapa otro edificio (tapadas: el rayo de la cámara a la abertura, cada PASO m sobre
     la planta, pasa por otro lote por debajo de su techo). lotes: los que tienen una abertura vista —su interior se arma—.
     camara: {x, y, z, yaw, pitch, fov (vertical, grados), aspect} —el giro YXZ de three.js: yaw en y, pitch en x—;
     abiertas: {ventanas: [claves], puertas: [claves de engine/estadoMundo.js puertaClave —el lugar de la hoja—]}. */
import {VANO} from './fachada-medida.js';
import {RAISE} from './fachada.js';
import {cuartoDeVentana} from './cortinas.js';
import {modulosDeFachada,vidrioDeModulo,vanoDeModulo,GRILLA_FACHADA} from './fachada-piezas.js';

export const PORTALES={lejos:35,paso:.5,piso:3,margenPuerta:1,pxMin:24};
const cache=new WeakMap();
// (el cuarto de detrás de una abertura: su número en el piso y su rectángulo en el plano —x, z del mundo—)
const cuartoDe=(lv,q)=>({id:`${lv.level}:${lv.rooms.indexOf(q)}`,nivel:lv.level,x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h});
const subida=L=>L.fachada?.escalinata?RAISE:0;
// Las aberturas del plano y la planta de los edificios (para el rayo), una vez por plano.
export function aberturasDe(bp){if(cache.has(bp))return cache.get(bp).aberturas;const out=[],F=PORTALES.piso;
 // (2026-11-22, Miguel: «apuntando también a las fachadas como se verán en el 3D»: una ventana del plano está donde la dibuja el
 // 3D —su módulo de fachada, fachada-piezas.js, y el vidrio de su pieza: vidrioDeModulo—, no en el centro de su tramo del
 // plano. En una ventana doble, la pieza ocupa dos módulos y su vidrio va centrado en la junta: las dos ventanas del plano son
 // ese vidrio. Sin vidrio medido —una vidriera, un balcón—, el vano del módulo; sin módulo, el tramo del plano)
 const S=GRILLA_FACHADA.casilla;
 for(const L of bp.lots||[]){const mods=new Map();for(const md of (L.modulos?.length?L.modulos:modulosDeFachada(bp,L)))mods.set(`${md.f}:${md.x}:${md.y}:${md.dx}:${md.dy}:${md.k}`,md);
  const centro=md=>{const c=-S/2+1+2*md.k;return {x:(md.x+.5+md.dx*.5)*S+md.dy*c,z:(md.y+.5+md.dy*.5)*S-md.dx*c,tx:md.dy,tz:-md.dx};};
  const moduloEn=(f,x,z)=>{for(const md of mods.values()){if(md.f!==f)continue;const p=centro(md);if(Math.abs(p.x-x)<.3&&Math.abs(p.z-z)<.3)return md;}return null;};
  for(const lv of L.levels||[]){const base=subida(L)+lv.level*F;
  (lv.windows||[]).forEach((w,wi)=>{const c=cuartoDeVentana(lv,w);if(!c)return;const m=(c.u+c.v)/2,wx=c.h?m:c.at,wz=c.h?c.at:m;
   let md=moduloEn(lv.level,wx,wz);if(md?.tipo==='doble2')md=mods.get(`${md.f}:${md.x}:${md.y}:${md.dx}:${md.dy}:${md.k-1}`)||md;
   const g=md&&(vidrioDeModulo(md)||vanoDeModulo(md)),p=md&&centro(md);
   const [x,z,ancho,a,b]=g?[p.x+p.tx*(g[0]+g[1])/2,p.z+p.tz*(g[0]+g[1])/2,g[1]-g[0],g[2],g[3]]:[wx,wz,c.v-c.u,...(w.shop?VANO.vidriera:VANO.comun)];
   out.push({tipo:'ventana',clave:`${L.id}:${lv.level}:${wi}`,lote:L.id,nivel:lv.level,h:c.h,x,z,nx:c.h?0:-c.edge,nz:c.h?-c.edge:0,y0:base+a,y1:base+b,ancho,modulo:md?.tipo||null,cuarto:cuartoDe(lv,c.q)});});/* (edge: hacia adentro del cuarto; afuera, al revés) */
  if(lv.level===0)(lv.doors||[]).forEach((d,di)=>{if(!d.street)return;const h=Math.abs(d.y0-d.y1)<1e-6,[a,b]=VANO.puerta,x=(d.x0+d.x1)/2,z=(d.y0+d.y1)/2;
   // (afuera: el lado de la puerta que no cae en el lote)
   const enL=(px,pz)=>(L.parts||[]).some(p=>px>p.x&&px<p.x+p.w&&pz>p.y&&pz<p.y+p.h),[nx,nz]=(h?[[0,1],[0,-1]]:[[1,0],[-1,0]]).find(([u,v])=>!enL(x+u*.6,z+v*.6))||[0,0];
   const q=(lv.rooms||[]).find(r=>{const px=x-nx*.4,pz=z-nz*.4;return px>r.x-.01&&px<r.x+r.w+.01&&pz>r.y-.01&&pz<r.y+r.h+.01;});
   out.push({tipo:'puerta',clave:`${L.id}:puerta:${di}`,lote:L.id,nivel:0,h,x,z,nx,nz,y0:base+a,y1:base+b,ancho:Math.hypot(d.x1-d.x0,d.y1-d.y0),cuarto:q?cuartoDe(lv,q):null});});}}
 // (la planta: cada parte de cada edificio con su techo)
 const partes=[];for(const L of bp.lots||[])for(const p of L.parts||[])partes.push({lote:L.id,x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h,techo:subida(L)+(L.floors||1)*F});
 cache.set(bp,{aberturas:out,partes});return out;}
const partesDe=bp=>{aberturasDe(bp);return cache.get(bp).partes;};
const loteEn=(P,x,z)=>{for(const p of P)if(x>p.x0&&x<p.x1&&z>p.z0&&z<p.z1)return p;return null;};

// LAS CASAS DEL MONTE (2026-11-22, Miguel: «sí, las casas»): sus aberturas, del plano de cada casa (engine/vivienda.js
// planHouse: openings, en el marco de la casa) puestas en el mundo con su lugar y su giro. casas: [{i, x, y, z, c, s, plan}]
// —c, s: coseno y seno del giro, como vivienda3d—. La ventana: clave c<i>:v<número del vano>, su piso y su cuarto (el plano los
// trae); la puerta de calle: c<i>:puerta:<número>, y su cuarto, el del punto de adentro (los de hogar.js, en u, v). El lote: c<i>.
export function aberturasDeCasas(casas){const out=[];
 for(const h of casas){const P=h.plan,HG=P?.spec?.hogar;if(!P)continue;
  const aMundo=(lx,lz)=>[h.x+lx*h.c+lz*h.s,h.z-lx*h.s+lz*h.c],dir=(nx,nz)=>[nx*h.c+nz*h.s,-nx*h.s+nz*h.c];
  const cuartoEn=(lx,lz,nivel)=>{const lv=HG?.levels?.find(l=>l.level===nivel);if(!lv)return null;const u=lx+P.ox,v=P.D-lz-P.oz,q=lv.rooms.find(r=>u>r.u0-.01&&u<r.u1+.01&&v>r.v0-.01&&v<r.v1+.01);return q?{id:`${nivel}:${q.id}`,nivel}:null;};
  P.openings.forEach((o,oi)=>{if(o.inner||(o.kind!=='window'&&o.kind!=='door'))return;const [lx,lz]=o.axis==='x'?[o.c,o.at]:[o.at,o.c],[lnx,lnz]=o.axis==='x'?[0,o.out]:[o.out,0];
   const [x,z]=aMundo(lx,lz),[nx,nz]=dir(lnx,lnz),y0=h.y+o.y0,y1=y0+o.h,ventana=o.kind==='window';
   const cuarto=ventana?(o.cuarto!=null?{id:`${o.nivel}:${o.cuarto}`,nivel:o.nivel}:null):cuartoEn(lx-lnx*.4,lz-lnz*.4,0);
   out.push({tipo:ventana?'ventana':'puerta',clave:`c${h.i}:${ventana?'v':'puerta:'}${oi}`,lote:'c'+h.i,casa:h.i,nivel:ventana?o.nivel??0:0,h:Math.abs(nx)<.5,x,z,nx,nz,y0,y1,ancho:o.w,cuarto});});}
 return out;}

// ¿Está el punto (x, y, z), con su medio ancho r, en el campo de visión de la cámara?
export function enVista(c,x,y,z,r=0){const cy=Math.cos(c.yaw),sy=Math.sin(c.yaw),cp=Math.cos(c.pitch||0),sp=Math.sin(c.pitch||0);
 const dx=x-c.x,dy=y-c.y,dz=z-c.z,hondo=-dx*sy*cp+dy*sp-dz*cy*cp;if(hondo<=.05)return false;
 const lado=dx*cy-dz*sy,alto=dx*sy*sp+dy*cp+dz*cy*sp,tv=Math.tan((c.fov||75)*Math.PI/360),th=tv*(c.aspect||1);
 return Math.abs(lado)<=hondo*th+r&&Math.abs(alto)<=hondo*tv+r;}
// ¿Llega el rayo de la cámara a la abertura sin pasar por otro edificio por debajo de su techo?
export function libre(bp,c,a){const P=partesDe(bp),propios=new Set([loteEn(P,c.x,c.z)?.lote,a.lote]);
 const tx=a.x,ty=(a.y0+a.y1)/2,tz=a.z,dx=tx-c.x,dy=ty-c.y,dz=tz-c.z,L=Math.hypot(dx,dz);
 for(let t=PORTALES.paso;t<L-.6;t+=PORTALES.paso){const k=t/L,p=loteEn(P,c.x+dx*k,c.z+dz*k);if(p&&!propios.has(p.lote)&&c.y+dy*k<p.techo)return false;}
 return true;}

// Cuánto mide la abertura en la pantalla (px): su lado más corto —el alto, o el ancho visto de sesgo—, por la distancia, en una
// pantalla de c.alto px de alto con su campo de visión vertical.
export function enPantalla(c,a){const d=Math.max(.3,Math.hypot(a.x-c.x,(a.y0+a.y1)/2-c.y,a.z-c.z)),dx=c.x-a.x,dz=c.z-a.z,sesgo=Math.abs(dx*a.nx+dz*a.nz)/(Math.hypot(dx,dz)||1);
 const k=(c.alto||800)/(2*Math.tan((c.fov||75)*Math.PI/360)*d);return Math.min((a.y1-a.y0)*k,a.ancho*sesgo*k);}

// (2026-11-22, Miguel: «con ese cálculo se puede saber el tamaño a la distancia de la ventana o puerta y omitir cargar los
// polígonos de adentro; y ahí deben estar presentes los ids: saber qué partes de adentro se van a mostrar por la ventana, y
// sólo si realmente vale la pena según la distancia»): de cada abertura vista, su tamaño en pantalla (px); si mide menos de
// pxMin, no vale la pena —chicas: su interior no se arma—; si vale, su cuarto —el de detrás, con su id nivel:número— va en
// cuartos, por lote: el 3D arma sólo lo de esos cuartos. otras: más aberturas fuera del plano —las de las casas del monte,
// aberturasDeCasas—.
export function vistaDesde(bp,c,abiertas={},otras=[]){const A=otras.length?[...aberturasDe(bp),...otras]:aberturasDe(bp),V=new Set(abiertas.ventanas||[]),Pu=(abiertas.puertas||[]).map(k=>k.split(',').map(Number));
 const abierta=a=>a.tipo==='ventana'?V.has(a.clave):Pu.some(([x,z,y])=>Math.hypot(x-a.x,z-a.z)<PORTALES.margenPuerta&&Math.abs(y-a.y0)<1.6);
 const vistas=[],tapadas=[],chicas=[],lotes=new Set(),cuartos=new Map();
 for(const a of A){if(Math.hypot(a.x-c.x,a.z-c.z)>PORTALES.lejos||!abierta(a))continue;if((c.x-a.x)*a.nx+(c.z-a.z)*a.nz<=0)continue;/* (desde atrás no se ve) */const ym=(a.y0+a.y1)/2;if(!enVista(c,a.x,ym,a.z,Math.max(a.ancho,a.y1-a.y0)/2))continue;
  if(!libre(bp,c,a)){tapadas.push(a);continue;}
  const px=enPantalla(c,a);if(px<PORTALES.pxMin){chicas.push({...a,px});continue;}
  vistas.push({...a,px});lotes.add(a.lote);if(a.cuarto){const m=cuartos.get(a.lote)||cuartos.set(a.lote,new Map()).get(a.lote);m.set(a.cuarto.id,a.cuarto);}}
 return {lotes,vistas,tapadas,chicas,cuartos};}

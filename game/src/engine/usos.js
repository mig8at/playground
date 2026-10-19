// ======== Los usos de los objetos (2026-10-16, idea de Miguel: «acciones como abrir una cortina, sentarse en una silla o
// acostarse en una cama, al acercarse») ========
// usosDePiso(muebles, ventanas, cuartos): por cada objeto que se usa, sus usos {objeto, accion, de pie:{x,z} —donde se
// para el personaje para hacerlo—, pose:{x,z,yaw} —donde queda—, frente:{x,z} —hacia donde mira—}. El 3D sólo los anima;
// validar-usos comprueba que cada uno se alcance caminando y quepa. Puro.
// Muebles en el marco del plano: {kind, x0,x1, z0,z1, fx,fz (hacia dónde mira su frente)}.
import {ERGO,mm} from './medidas.js';
import {cuartoDeVentana} from './cortinas.js';
// Las ventanas a las que uno se asoma, como miradores de usosDePiso (la normal hacia adentro de su cuarto):
//  · de un piso de edificio (en el plano del mapa): todas las de afuera menos las vidrieras de los locales y las de los
//    baños;
//  · de un piso de casa (hogar.js, en u, v): todas las de sus cuartos.
export const miradoresDePiso=lv=>(lv.windows||[]).flatMap((w,wi)=>{if(w.shop)return [];const c=cuartoDeVentana(lv,w);if(!c||USOS.asomarse.sinCuartos.includes(c.q.type))return [];
 return [{...(c.h?{x0:c.u,x1:c.v,z0:c.at,z1:c.at,nx:0,nz:c.edge}:{x0:c.at,x1:c.at,z0:c.u,z1:c.v,nx:c.edge,nz:0}),wi}];});
export const miradoresDeCasa=lv=>(lv.windows||[]).flatMap((w,wi)=>{const q=lv.rooms.find(r=>r.id===w.a);if(!q||USOS.asomarse.sinCuartos.includes(q.type))return [];
 return [w.axis==='u'?{x0:w.from,x1:w.from+w.len,z0:w.at,z1:w.at,nx:0,nz:Math.abs(w.at-q.v0)<.02?1:-1,wi}:{x0:w.at,x1:w.at,z0:w.from,z1:w.from+w.len,nx:Math.abs(w.at-q.u0)<.02?1:-1,nz:0,wi}];});
// (la distancia desde el borde del mueble a donde se para el personaje: la misma con que el generador prueba que se usa
// —blueprint.js makeMovement: el radio de prueba más 5 cm—)
const ANTES=mm(ERGO.radioPrueba)+.05;
export const USOS={
 sentarse:{tipos:['silla','sillon','sofa','inodoro','banca','banco'],asiento:.6,antes:ANTES,suelta:['silla'],
  plazas:{banco:1}},// (el banco de pesas es ancho por su rack, pero tiene un solo cojín)
 acostarse:{tipos:['cama','cama_s','catre','cama_h','camilla'],costado:ANTES},
 cortina:{antes:.6,fondos:[.4,.6,.9,1.3],costado:1.2,paso:.3,brazo:1.3,bajo:.75},
 // asomarse (2026-10-17, Miguel: «asomarme a una ventana y poder ver a los lados»): de una grilla delante del vidrio —a lo
 // ancho y hasta «costado» m más allá de sus puntas, a «fondos» m— los puntos a ≤ «brazo» m del borde más cercano del
 // vidrio; más lejos que «cerca», inclinado sobre lo que haya en el medio si no pasa de «bajo» (la cama bajo la ventana, un
 // escritorio sin computador). El ojo, a «ojo» m del vidrio, del lado del cuarto. Los baños no: nadie se asoma por encima
 // de la ducha (sinCuartos).
 asomarse:{fondos:[.4,.65,.9,1.3],costado:.9,paso:.3,cerca:.45,brazo:1.3,bajo:.75,ojo:.12,sinCuartos:['bano','sanitario','vestuario']}};
// miradores: las ventanas a las que uno se asoma (todas las de afuera, no sólo las de cortina), {x0,x1,z0,z1,nx,nz} con
// la normal hacia adentro del cuarto, como las ventanas.
export function usosDePiso(muebles,ventanas=[],miradores=[]){const out=[];
 for(const m of muebles){const cx=(m.x0+m.x1)/2,cz=(m.z0+m.z1)/2,yaw=Math.atan2(m.fx,m.fz),ancho=Math.abs(m.fx)>.5?m.z1-m.z0:m.x1-m.x0,fondo=Math.abs(m.fx)>.5?m.x1-m.x0:m.z1-m.z0,lx=-m.fz,lz=m.fx;
  if(USOS.sentarse.tipos.includes(m.kind)){const n=USOS.sentarse.plazas[m.kind]||Math.max(1,Math.floor(ancho/USOS.sentarse.asiento+1e-6));
   for(let i=0;i<n;i++){const o=(i-(n-1)/2)*USOS.sentarse.asiento,px=cx+lx*o,pz=cz+lz*o;
    // (de dónde se llega: delante; una silla, además, por detrás y por los costados —la de un escritorio se corre—)
    const A=USOS.sentarse.antes,des=[{x:px+m.fx*(fondo/2+A),z:pz+m.fz*(fondo/2+A)}];
    // (lo ancho —un sillón, la punta de un sofá— también desde cerca de sus puntas, como lo prueba el generador)
    if(ancho/n>=.9)for(const sg of [-1,1]){const o2=sg*(ancho/n/2-.3);des.push({x:px+lx*o2+m.fx*(fondo/2+A),z:pz+lz*o2+m.fz*(fondo/2+A)});}
    if(USOS.sentarse.suelta.includes(m.kind))des.push({x:px-m.fx*(fondo/2+A),z:pz-m.fz*(fondo/2+A)},{x:px+lx*(ancho/2+A),z:pz+lz*(ancho/2+A)},{x:px-lx*(ancho/2+A),z:pz-lz*(ancho/2+A)});
    out.push({objeto:m,accion:'sentarse',plaza:i,pose:{x:px,z:pz,yaw},de:des[0],des});}}
  else if(USOS.acostarse.tipos.includes(m.kind)){// (por cualquiera de los dos costados)
   for(const s of [-1,1]){const de={x:cx+lx*s*(ancho/2+USOS.acostarse.costado),z:cz+lz*s*(ancho/2+USOS.acostarse.costado)};out.push({objeto:m,accion:'acostarse',lado:s,pose:{x:cx,z:cz,yaw:yaw+Math.PI},de,des:[de]});}}}
 // las cortinas: delante de la ventana, del lado del cuarto
 // (a lo ancho de la ventana —el centro y sus puntas— y a USOS.cortina.antes o un poco más: se alcanza con el brazo)
 // (de dónde: una grilla delante de la ventana —a lo ancho, hasta USOS.cortina.costado más allá de sus puntas; de fondo,
 // USOS.cortina.fondos—, cada punto con el borde más cercano de la ventana: desde ahí se estira el brazo; si está a más de
 // USOS.cortina.antes, sobre:true —vale si en el medio no hay nada más alto que USOS.cortina.bajo: la cama contra la ventana
 // sí, el armario no—)
 for(const v of ventanas){const mx=(v.x0+v.x1)/2,mz=(v.z0+v.z1)/2,tx=v.nz?1:0,tz=v.nx?1:0,la=Math.hypot(v.x1-v.x0,v.z1-v.z0)/2,des=[],C=USOS.cortina;
  for(const d of C.fondos)for(let t=-la-C.costado;t<=la+C.costado+1e-6;t+=C.paso){const tc=Math.max(-la,Math.min(la,t)),hx=mx+tx*tc,hz=mz+tz*tc,px=mx+tx*t+v.nx*d,pz=mz+tz*t+v.nz*d;
   if(Math.hypot(px-hx,pz-hz)>C.brazo)continue;des.push({x:px,z:pz,sobre:Math.hypot(px-hx,pz-hz)>C.antes+1e-6,hacia:{x:hx,z:hz}});}
  des.sort((a,b)=>Math.hypot(a.x-a.hacia.x,a.z-a.hacia.z)-Math.hypot(b.x-b.hacia.x,b.z-b.hacia.z));
  out.push({objeto:v,accion:'cortina',pose:{x:des[0].x,z:des[0].z,yaw:Math.atan2(-v.nx,-v.nz)},de:des[0],des});}
 // asomarse: delante del vidrio, mirando hacia afuera; el ojo, junto al vidrio
 for(const v of miradores){const mx=(v.x0+v.x1)/2,mz=(v.z0+v.z1)/2,tx=v.nz?1:0,tz=v.nx?1:0,la=Math.hypot(v.x1-v.x0,v.z1-v.z0)/2,A=USOS.asomarse,des=[];
  const ts=[0];for(let t=A.paso;t<=la+A.costado+1e-6;t+=A.paso)ts.push(t,-t);
  for(const d of A.fondos)for(const t of ts){const tc=Math.max(-la,Math.min(la,t)),hx=mx+tx*tc,hz=mz+tz*tc,px=mx+tx*t+v.nx*d,pz=mz+tz*t+v.nz*d,r=Math.hypot(px-hx,pz-hz);
   if(r<=A.brazo+1e-6)des.push({x:px,z:pz,sobre:r>A.cerca+1e-6,hacia:{x:hx,z:hz}});}
  des.sort((a,b)=>Math.hypot(a.x-a.hacia.x,a.z-a.hacia.z)-Math.hypot(b.x-b.hacia.x,b.z-b.hacia.z));
  out.push({objeto:v,accion:'asomarse',pose:{x:mx+v.nx*A.ojo,z:mz+v.nz*A.ojo,yaw:Math.atan2(-v.nx,-v.nz)},de:des[0],des});}
 return out;}

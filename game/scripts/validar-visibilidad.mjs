// Valida qué paredes se aclaran para ver adentro (2026-10-16, engine/visibilidad.js; Miguel: «si entro a un cuarto, que
// se ponga semitransparente la pared que acabo de atravesar»). La cámara, como la del 3D: CAMARA.distancia detrás de la
// cabeza, sin salir del lote (con su margen); las paredes aclaradas no la frenan.
//  1. se ve al jugador: la línea de la cámara a la cabeza sólo cruza paredes aclaradas (y no pasa del máximo del 3D);
//  2. no se aclara de más: ni medianeras, ni otro piso, ni otro edificio;
//  3. al cruzar una puerta se aclara la pared de esa puerta; ya adentro, con la cámara en el mismo cuarto, ninguna;
//  4. sin parpadeo: caminando derecho, una pared que se apaga no vuelve a prenderse antes de 0,6 m;
//  5. desde la calle, nada.
// Uso: node scripts/validar-visibilidad.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {paredesAClarar,bordesDe,loteEn,VISIBILIDAD} from '../src/engine/visibilidad.js';
import {rng} from '../src/engine/veredas.js';
import City from '../src/engine/ciudad.js';

const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),CAMARA={distancia:4,margen:.35,paso:.15};
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={vistas:0,aclaradas:[],puertas:0,caminatas:0,cambios:0,metros:0,calle:0};
const cruza=(ax,az,bx,bz,cx,cz,dx,dz)=>{const d=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(d)<1e-9)return false;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/d,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/d;return t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6;};
// la cámara: hacia atrás de a CAMARA.paso mientras el punto (y su margen) siga en el lote
const camaraDe=(L,x,z,dx,dz)=>{const ok=(px,pz)=>[[0,0],[CAMARA.margen,0],[-CAMARA.margen,0],[0,CAMARA.margen],[0,-CAMARA.margen]].every(([a,b])=>(L.parts||[]).some(p=>px+a>p.x&&px+a<p.x+p.w&&pz+b>p.y&&pz+b<p.y+p.h));
 let s=0;for(let t=CAMARA.paso;t<=CAMARA.distancia+1e-6;t+=CAMARA.paso){if(!ok(x-dx*t,z-dz*t))break;s=t;}return {x:x-dx*s,z:z-dz*s};};
const dPS=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,L=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/L));return Math.hypot(ax+dx*t-px,az+dz*t-pz);};
const dSS=(a,b)=>cruza(...a,...b)?0:Math.min(dPS(a[0],a[1],...b),dPS(a[2],a[3],...b),dPS(b[0],b[1],...a),dPS(b[2],b[3],...a));
const DIRS=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4),Math.sin(i*Math.PI/4)]);
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),r=rng(s*31);
 for(const L of bp.lots)for(const lv of L.levels){const B=bordesDe(bp,L,lv),esp=[...lv.rooms,...(lv.corridor||[])];
  // 1 y 2: desde puntos de cada espacio, en 8 direcciones
  for(const q of esp)for(const [fx,fz] of [[.5,.5],[.25,.3],[.75,.7]]){const x=q.x+q.w*fx,z=q.y+q.h*fz;if(loteEn(bp,x,z)!==L)continue;
   for(const [dx,dz] of DIRS){const C=camaraDe(L,x,z,dx,dz),P=paredesAClarar(bp,{x,z,nivel:lv.level},C);med.vistas++;med.aclaradas.push(P.length);const ej={semilla:s,lote:L.type,piso:lv.level,x:+x.toFixed(1),z:+z.toFixed(1)};
    if(P.length>VISIBILIDAD.maximo)falla('más paredes que las que acepta el 3D',{...ej,n:P.length});
    const ks=new Set(P.map(p=>p.key));for(const e of B)if(cruza(C.x,C.z,x,z,...e.seg)&&!ks.has(e.key))falla(e.borde==='medianera'?'la cámara ve al jugador a través de una medianera':'una pared sin aclarar tapa al jugador',{...ej,borde:e.borde});
    for(const p of P){if(p.borde==='medianera')falla('se aclara una medianera',ej);if(p.lote!==L.id||p.nivel!==lv.level)falla('se aclara otro piso u otro edificio',ej);}}}
  // 3b: cada puerta con hoja de una pared aclarada tiene su hoja aclarada (la caja de su giro, a los dos lados)
  for(const q of esp.slice(0,6)){const x=q.x+q.w/2,z=q.y+q.h/2;if(loteEn(bp,x,z)!==L)continue;for(const [dx,dz] of DIRS.slice(0,4)){const C=camaraDe(L,x,z,dx,dz),P=paredesAClarar(bp,{x,z,nivel:lv.level},C);
   for(const d of lv.doors||[]){if(d.street||d.core||d.stair||d.hoja===false)continue;const h=Math.abs(d.y1-d.y0)<1e-6,at=h?d.y0:d.x0,u=h?(d.x0+d.x1)/2:(d.y0+d.y1)/2,w=Math.hypot(d.x1-d.x0,d.y1-d.y0);
    const sg2=h?[u-w/2,at,u+w/2,at]:[at,u-w/2,at,u+w/2],cerca=[[C.x,C.z,x,z],[C.x,C.z,q.x+q.w/2,q.y+q.h/2]].some(l=>dSS(l,sg2)<w+.5);if(!cerca)continue;
    const enPared=P.some(p=>p.borde!=='puerta'&&(h?p.seg[1]===p.seg[3]&&Math.abs(p.seg[1]-at)<.02&&u>Math.min(p.seg[0],p.seg[2])&&u<Math.max(p.seg[0],p.seg[2]):p.seg[0]===p.seg[2]&&Math.abs(p.seg[0]-at)<.02&&u>Math.min(p.seg[1],p.seg[3])&&u<Math.max(p.seg[1],p.seg[3])));if(!enPared)continue;med.hojas=(med.hojas||0)+1;
    // (la hoja abierta llega a w de la línea, de un lado o del otro, en toda la vuelta: la caja tiene que cubrir eso)
    const cubre=P.some(p=>p.borde==='puerta'&&(h?p.x0<=u-w/2+1e-6&&p.x1>=u+w/2-1e-6&&p.z0<=at-w+1e-6&&p.z1>=at+w-1e-6:p.z0<=u-w/2+1e-6&&p.z1>=u+w/2-1e-6&&p.x0<=at-w+1e-6&&p.x1>=at+w-1e-6));
    if(!cubre)falla('la hoja de una puerta de una pared aclarada no se aclara',{semilla:s,lote:L.type,piso:lv.level});}}}
  // 3: las puertas entre dos espacios
  for(const d of lv.doors||[]){if(d.street)continue;const h=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,e=B.find(b=>b.h===h&&Math.abs(b.at-(h?mz:mx))<.02&&(h?mx:mz)>b.a&&(h?mx:mz)<b.b);if(!e||e.borde==='medianera')continue;
   for(const sg of [1,-1]){const nx=h?0:sg,nz=h?sg:0,x=mx+nx*.6,z=mz+nz*.6;if(loteEn(bp,x,z)!==L)continue;med.puertas++;
    const C=camaraDe(L,x,z,nx,nz),P=paredesAClarar(bp,{x,z,nivel:lv.level},C);
    if((C.x-mx)*nx+(C.z-mz)*nz<-.1&&!P.some(p=>p.key===e.key||p.borde!=='medianera'&&(p.seg[0]===e.seg[0]&&p.seg[1]===e.seg[1]||Math.abs((h?p.seg[1]:p.seg[0])-(h?mz:mx))<.02&&(h?mx:mz)>Math.min(p.seg[h?0:1],p.seg[h?2:3])&&(h?mx:mz)<Math.max(p.seg[h?0:1],p.seg[h?2:3]))))falla('se cruza una puerta y su pared no se aclara',{semilla:s,lote:L.type,piso:lv.level});}}}
 // 4: caminatas derechas por los edificios
 for(let k=0;k<200;k++){const L=bp.lots[Math.floor(r()*bp.lots.length)],lv=L.levels[Math.floor(r()*L.levels.length)],q=(lv.corridor?.length&&r()<.5?lv.corridor:lv.rooms)[Math.floor(r()*lv.rooms.length)]||lv.rooms[0];if(!q)continue;
  const a=r()*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);let x=q.x+q.w/2,z=q.y+q.h/2,prev=null;const apagada=new Map();med.caminatas++;
  for(let t=0;t<8;t+=.1){x+=dx*.1;z+=dz*.1;if(loteEn(bp,x,z)!==L)break;med.metros+=.1;const C=camaraDe(L,x,z,dx,dz),P=paredesAClarar(bp,{x,z,nivel:lv.level},C,prev);
   const ahora=new Set(P.map(p=>p.key)),antes=new Set((prev||[]).map(p=>p.key));
   for(const k2 of antes)if(!ahora.has(k2)){apagada.set(k2,t);med.cambios++;}
   for(const k2 of ahora)if(!antes.has(k2)){if(apagada.has(k2)&&t-apagada.get(k2)<.6)falla('una pared parpadea al caminar',{semilla:s,lote:L.type,piso:lv.level});med.cambios++;}
   prev=P;}}
 // 4b: la cámara que tiembla (el mouse, ±1°) cerca de una puerta: el conjunto cambia como mucho una vez
 for(const L of bp.lots.slice(0,40))for(const lv of L.levels.slice(0,2))for(const d of (lv.doors||[]).filter(d=>!d.street).slice(0,6)){const h=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2;
  for(const sg of [1,-1]){const x=mx+(h?0:sg)*.8,z=mz+(h?sg:0)*.8;if(loteEn(bp,x,z)!==L)continue;const a0=Math.atan2(h?sg:0,h?0:sg);
   for(let a=-1.2;a<=1.2;a+=.05){let prev=null,cambios=0,ultimo=null;med.temblores=(med.temblores||0)+1;
    for(let i=0;i<10;i++){const b=a0+a+(i%2?.0175:0),dx=Math.cos(b),dz=Math.sin(b),C=camaraDe(L,x,z,dx,dz),P=paredesAClarar(bp,{x,z,nivel:lv.level},C,prev),k=P.map(p=>p.key).sort().join('|');if(ultimo!=null&&k!==ultimo)cambios++;ultimo=k;prev=P;}
    if(cambios>1){falla('una pared parpadea con la cámara que tiembla',{semilla:s,lote:L.type,piso:lv.level,cambios});break;}}}}
 // 5: desde la calle
 const K=City.K,m=bp.map;for(let i=0;i<m.W*m.H;i+=7){if(m.kind[i]!==K.street)continue;const x=(i%m.W+.5)*CELL,z=(Math.floor(i/m.W)+.5)*CELL;med.calle++;if(paredesAClarar(bp,{x,z,nivel:0},{x:x+3,z}).length)falla('se aclara algo con el jugador en la calle',{semilla:s,x,z});}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))];};
console.log(`visibilidad · ${med.vistas} vistas (paredes aclaradas: mediana ${q(med.aclaradas,.5)}, p99 ${q(med.aclaradas,.99)}, máx ${q(med.aclaradas,1)} de ${VISIBILIDAD.maximo}) · ${med.puertas} cruces de puerta · ${med.hojas||0} hojas en paredes aclaradas · ${med.caminatas} caminatas (${med.metros.toFixed(0)} m, ${med.cambios} cambios) · ${med.temblores||0} temblores de cámara · ${med.calle} puntos de calle`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

// ======== El botín: lo que se roba son cosas del mundo (2026-10-16, idea de Miguel) ========
// Pocos objetivos por ciudad (BOTIN.porCiudad, según el tamaño del equipo) y cada uno un objeto con su peso en el juego:
// la caja fuerte del Banco, las joyas de la Joyería, una escultura en el vestíbulo de un hotel o de unas oficinas, un
// cuadro en una oficina, una sala de lectura o la sala de una casa del monte (el juego también sale de la ciudad).
// Todo en planta baja (el motor juega en un piso). Dónde, calculado:
//  · el objeto va contra una pared libre (sin puerta a menos de PUERTA m, sin ventana, sin tocar un mueble) y se toma
//    de frente: el punto de adelante tiene que alcanzarse caminando desde la calle (nav-interior);
//  · la escultura va suelta, con HOLGURA a todo lo que la rodea, lo más al centro del cuarto;
//  · puesto el objeto, se vuelve a medir el piso con él como estorbo: nadie pierde un cuarto por su culpa.
//  · los objetivos se reparten por el mapa (el más lejano de los ya elegidos, desde la comisaría), los obligados
//    primero (los objetivos del plano: Banco y Joyería).
// bp.botines = [{id, objeto, nombre, valor, carga, tiempo, lote|casa, cuarto, x, z, ang, largo, fondo, frente:{x,z},
//  pared, local:{x0,x1,z0,z1} (en el marco del plano: el mundo para los edificios, u-v para las casas)}].
import {BOTIN} from './medidas.js';
import {navEdificio,navHogar} from './nav-interior.js';

const CELL=6,PUERTA=.7,HOLGURA=1.1,PASO=.25,PARED=.1,DELANTE=.45;
// el plano de una casa (hogar.js: u a lo ancho del frente, v desde el frente) llevado al mundo
export function casaAMundo(h){const P0=h.spec?.hogar,Wc=P0?.W??h.w,Dc=P0?.D??h.d,f=h.frente,dF=Dc-h.d/2;
 return (u,v)=>f==='S'?[h.x-Wc/2+u,h.z+dF-v]:f==='N'?[h.x+Wc/2-u,h.z-dF+v]:f==='W'?[h.x-dF+v,h.z-Wc/2+u]:[h.x+dF-v,h.z+Wc/2-u];}
const cruza=(a,b,m=0)=>a.x0<b.x1+m&&b.x0<a.x1+m&&a.z0<b.z1+m&&b.z0<a.z1+m;
const aSeg=(r,s)=>{// distancia de un rectángulo a un segmento (horizontal o vertical)
 const dx=Math.max(0,Math.min(s.x0,s.x1)-r.x1,r.x0-Math.max(s.x0,s.x1)),dz=Math.max(0,Math.min(s.z0,s.z1)-r.z1,r.z0-Math.max(s.z0,s.z1));return Math.hypot(dx,dz);};

// ---- Un piso en su marco: cuartos, puertas, ventanas, muebles y su navegación ----
// (nivel y unidad, 2026-10-17: la caja de una guarida va en un apartamento de un piso de arriba —sólo sus cuartos—)
export const pisoLote=(L,nivel=0,unidad=null)=>{const lv=L.levels.find(l=>l.level===nivel);if(!lv)return null;
 return {cuartos:lv.rooms.filter(q=>unidad==null||q.unit===unidad).map(q=>({tipo:q.type,x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h})),
  puertas:(lv.doors||[]).map(d=>({x0:d.x0,z0:d.y0,x1:d.x1,z1:d.y1})),ventanas:(lv.windows||[]).map(d=>({x0:d.x0,z0:d.y0,x1:d.x1,z1:d.y1})),
  muebles:[...(lv.furniture||[]).map(f=>({x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h})),...(lv.core?[{x0:lv.core.x,x1:lv.core.x+lv.core.w,z0:lv.core.y,z1:lv.core.y+lv.core.h}]:[])],
  // (arriba se llega por la escalera: la navegación del edificio entero, y el piso que toca)
  nav:()=>nivel?navEdificio(L).find(p=>p.nivel===nivel):navEdificio({...L,levels:[lv]})[0],
  conObjeto:r=>{const lv2={...lv,furniture:[...(lv.furniture||[]),{kind:'botin',x:r.x0,y:r.z0,w:r.x1-r.x0,h:r.z1-r.z0}]};return nivel?navEdificio({...L,levels:L.levels.map(l=>l===lv?lv2:l)}).find(p=>p.nivel===nivel):navEdificio({...L,levels:[lv2]})[0];},
  aMundo:(x,z)=>[x,z]};};
const seg=d=>d.axis==='u'?{x0:d.from,x1:d.from+d.len,z0:d.at,z1:d.at}:{x0:d.at,x1:d.at,z0:d.from,z1:d.from+d.len};
export const pisoCasa=h=>{const P=h.spec?.hogar,lv=P?.levels.find(l=>l.level===0);if(!lv)return null;
 return {cuartos:lv.rooms.map(q=>({tipo:q.type,x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1})),puertas:(lv.doors||[]).map(seg),ventanas:(lv.windows||[]).map(seg),
  muebles:(lv.furniture||[]).map(f=>({x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1})),
  nav:()=>navHogar({...P,levels:[lv]})[0],
  conObjeto:r=>navHogar({...P,levels:[{...lv,furniture:[...(lv.furniture||[]),{kind:'botin',u0:r.x0,u1:r.x1,v0:r.z0,v1:r.z1}]}]})[0],
  aMundo:casaAMundo(h)};};
// la distancia caminando (m) en un punto del piso, o -1 (mira las vecinas a ≤ 0.2 m)
const enNav=(n,x,z)=>{const k=n.g.idx(x,z);if(k<0)return -1;let b=-1;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*n.g.nx+di;if(kk>=0&&kk<n.dist.length&&n.dist[kk]>=0&&(b<0||n.dist[kk]<b))b=n.dist[kk];}return b<0?-1:b*.1;};

// ---- Dónde va un objeto en un piso: la mejor posición (o null) ----
export function colocar(P,o,n){let mejor=null;
 for(const tipo of o.cuartos){for(const c of P.cuartos.filter(c=>c.tipo===tipo)){
  const libre=r=>!P.muebles.some(m=>cruza(r,m,.05))&&!P.puertas.some(d=>aSeg(r,d)<PUERTA);
  if(o.pared){// contra cada pared, a lo largo, de a PASO
   for(const [eje,a0,a1,at,nx,nz] of [['x',c.x0,c.x1,c.z0,0,1],['x',c.x0,c.x1,c.z1,0,-1],['z',c.z0,c.z1,c.x0,1,0],['z',c.z0,c.z1,c.x1,-1,0]]){
    const muro=eje==='x'?{x0:a0,x1:a1,z0:at,z1:at}:{x0:at,x1:at,z0:a0,z1:a1};
    for(let t=a0+.3;t+o.largo<=a1-.3+1e-9;t+=PASO){const p0=at+(nx+nz>0?PARED:-PARED),p1=p0+(nx+nz>0?o.fondo:-o.fondo);
     const r=eje==='x'?{x0:t,x1:t+o.largo,z0:Math.min(p0,p1),z1:Math.max(p0,p1)}:{x0:Math.min(p0,p1),x1:Math.max(p0,p1),z0:t,z1:t+o.largo};
     if(!libre(r))continue;
     if(P.ventanas.some(w=>{const ws=eje==='x'?Math.abs(w.z0-at)<.3&&Math.abs(w.z1-at)<.3:Math.abs(w.x0-at)<.3&&Math.abs(w.x1-at)<.3;if(!ws)return false;const w0=eje==='x'?Math.min(w.x0,w.x1):Math.min(w.z0,w.z1),w1=eje==='x'?Math.max(w.x0,w.x1):Math.max(w.z0,w.z1);return w0<t+o.largo&&t<w1;}))continue;
     const cx=(r.x0+r.x1)/2,cz=(r.z0+r.z1)/2,fx=cx+nx*(o.fondo/2+DELANTE),fz=cz+nz*(o.fondo/2+DELANTE),d=enNav(n,fx,fz);if(d<0)continue;
     // lo valioso, lo más adentro (más camino desde la calle); lo demás, también: el que lo roba tiene que entrar
     if(!mejor||d>mejor.d+1e-9)mejor={d,r,c,frente:[fx,fz],normal:[nx,nz],muro};}}}
  else{// suelta: de a PASO por el cuarto, con holgura alrededor; la más al centro
   const mx=(c.x0+c.x1)/2,mz=(c.z0+c.z1)/2;
   for(let x=c.x0+HOLGURA;x+o.largo<=c.x1-HOLGURA+1e-9;x+=PASO)for(let z=c.z0+HOLGURA;z+o.fondo<=c.z1-HOLGURA+1e-9;z+=PASO){const r={x0:x,x1:x+o.largo,z0:z,z1:z+o.fondo};
    if(P.muebles.some(m=>cruza(r,m,HOLGURA))||P.puertas.some(d=>aSeg(r,d)<HOLGURA+PUERTA))continue;
    const cx=x+o.largo/2,cz=z+o.fondo/2,fx=cx,fz=z-DELANTE,d=enNav(n,fx,fz)>=0?enNav(n,fx,fz):enNav(n,cx,z+o.fondo+DELANTE);if(d<0)continue;
    const cen=-Math.hypot(cx-mx,cz-mz);if(!mejor||cen>mejor.cen)mejor={d,cen,r,c,frente:[fx,fz],normal:[0,-1]};}}}
  if(mejor)return mejor;}
 return null;}

// ---- Puesto el objeto: el piso sigue alcanzándose entero (salvo la huella del objeto y su borde) ----
export function noEstorba(P,n,r){const n2=P.conObjeto(r),huella=(r.x1-r.x0+.8)*(r.z1-r.z0+.8)+.5;
 for(let i=0;i<n.espacios.length;i++){const a=n.espacios[i].alcanzado,b=n2.espacios[i].alcanzado;if(a>0&&b<=0)return false;if(a-b>huella)return false;}return true;}

export function repartir(bp){const team=bp.team||3,ks=Object.keys(BOTIN.porCiudad).map(Number),tk=ks.reduce((b,k)=>Math.abs(k-team)<Math.abs(b-team)?k:b,ks[0]);
 const N=BOTIN.porCiudad[tk],NM=BOTIN.monte[tk],O=BOTIN.objetos;
 const centro=L=>{const p=L.parts;const x0=Math.min(...p.map(q=>q.x)),x1=Math.max(...p.map(q=>q.x+q.w)),z0=Math.min(...p.map(q=>q.y)),z1=Math.max(...p.map(q=>q.y+q.h));return [(x0+x1)/2,(z0+z1)/2];};
 const est=bp.lots.find(L=>L.type==='comisaria'),origen=est?centro(est):[bp.map.W*CELL/2,bp.map.H*CELL/2];
 // los candidatos: cada lote o casa con el objeto que le toca
 const lotKey=L=>L.type==='objetivo'?'objetivo:'+(L.siteName||L.name):L.type,cand=[];
 bp.lots.forEach((L,li)=>{if(!L.levels)return;for(const [k,o] of Object.entries(O))if(o.lotes.includes(lotKey(L))){cand.push({objeto:k,lote:li,pos:centro(L),obligado:L.type==='objetivo',P:()=>pisoLote(L),nombre:L.siteName||L.name});break;}});
 const casas=(bp.isla?.casas||[]).map((h,ci)=>({h,ci})).filter(({h})=>h.spec?.hogar);
 for(const {h,ci} of casas)for(const [k,o] of Object.entries(O))if(o.lotes.includes('casa_monte')){cand.push({objeto:k,casa:ci,monte:true,pos:[h.x,h.z],P:()=>pisoCasa(h),nombre:'Casa '+h.manzana});break;}
 const elegidos=[],usados=[origen];
 const probar=c=>{const P=c.P();if(!P)return false;const o=O[c.objeto],n=P.nav(),m=colocar(P,o,n);if(!m||!noEstorba(P,n,m.r))return false;
  const [x,z]=P.aMundo((m.r.x0+m.r.x1)/2,(m.r.z0+m.r.z1)/2),[fx,fz]=P.aMundo(...m.frente),[ax,az]=P.aMundo(m.frente[0]+m.normal[0],m.frente[1]+m.normal[1]),[bx,bz]=P.aMundo(...m.frente);
  elegidos.push({id:'b'+elegidos.length,objeto:c.objeto,nombre:o.nombre,lugar:c.nombre,valor:o.valor,carga:o.carga,tiempo:o.tiempo,...(c.casa!=null?{casa:c.casa}:{lote:c.lote}),monte:!!c.monte,
   cuarto:m.c.tipo,x:+x.toFixed(2),z:+z.toFixed(2),ang:+Math.atan2(ax-bx,az-bz).toFixed(4),largo:o.largo,fondo:o.fondo,pared:o.pared,frente:{x:+fx.toFixed(2),z:+fz.toFixed(2)},adentro:+m.d.toFixed(1),
   local:{x0:+m.r.x0.toFixed(3),x1:+m.r.x1.toFixed(3),z0:+m.r.z0.toFixed(3),z1:+m.r.z1.toFixed(3)}});usados.push(c.pos);return true;};
 const lejos=c=>Math.min(...usados.map(u=>Math.hypot(u[0]-c.pos[0],u[1]-c.pos[1])));
 const tomar=(pool,k)=>{const resto=[...pool];let n=0;while(n<k&&resto.length){resto.sort((a,b)=>lejos(b)-lejos(a)||a.pos[0]-b.pos[0]||a.pos[1]-b.pos[1]);const c=resto.shift();if(probar(c))n++;}return n;};
 // 1) los obligados (los objetivos del plano), 2) la ciudad, alternando escultura y cuadro, 3) el monte
 tomar(cand.filter(c=>c.obligado),N);
 const ciudad=cand.filter(c=>!c.obligado&&!c.monte),faltan=N-NM-elegidos.length;
 for(let i=0,hechos=0;hechos<faltan&&i<faltan*3;i++){const k=i%2?'cuadro':'escultura',pool=ciudad.filter(c=>c.objeto===k&&!elegidos.some(e=>e.lote===c.lote));hechos+=tomar(pool.length?pool:ciudad.filter(c=>!elegidos.some(e=>e.lote===c.lote)),1);}
 tomar(cand.filter(c=>c.monte),N-elegidos.length);
 return elegidos;}

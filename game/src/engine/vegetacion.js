/* La vegetación del mundo y la playa, por cálculo (FUGA, 2026-10-15): árboles de calle en las veredas de la ciudad y del
   monte, la alameda del borde verde, los parques (30 % de copa), el bosque del monte natural, las palmeras del paseo y de
   la arena y las sombrillas de la playa. Todo con las medidas de medidas.js VEGETACION y CALLE, sobre el plano ya armado
   (generateBlueprint): no cambia nada de lo que ya estaba —tiene su propio azar—, sólo agrega puntos.
   Coordenadas del plano: metros, x a la derecha, z (= y del plano) hacia abajo. Cada punto: {x, z, r (radio de copa)}. */
import {VEGETACION as V,CALLE} from './medidas.js';
import City from './ciudad.js';
import {islaDe,mascaraRebaje} from './isla.js';
import {mapaDeZonas,prohibidasDe} from './zonas.js';
import {cuerpoCasa} from './circulacion.js';

import {CELL,rng,mix,vecinos,aLoLargo,veredasCiudad,ejesMonte,distSeg} from './veredas.js';

export function plantar(bp){
 const {map:m,isla:I}=bp,{W,H}=m,K=City.K,Wm=W*CELL,Hm=H*CELL,r=rng(mix(bp.seed,bp.team||0,4711));
 const arboles=[],palmeras=[],sombrillas=[],todo=vecinos(),
  pon=(lista,p)=>{lista.push(p);todo.add(p);return p;};
 const celdas=new Map((I?.cells||[]).map(c=>[c.x+','+c.y,c])),at=(x,z)=>celdas.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 // (los edificios —lotes de la ciudad, edificios del monte y la planta entera de cada casa, con su porche: su alero también
 // choca— y la distancia de un punto al más cercano, con su dirección: para que ninguna copa se meta en uno, V.poda)
 const P=V.poda,edif=[...bp.lots.flatMap(L=>L.parts||[]).map(p=>[p.x,p.y,p.x+p.w,p.y+p.h]),...(I?.lots||[]).filter(L=>L.parts).flatMap(L=>L.parts).map(p=>[p.x,p.y,p.x+p.w,p.y+p.h]),
  ...(I?.casas||[]).map(h=>{const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;return [h.x-w/2,h.z-d/2,h.x+w/2,h.z+d/2];})];
 const B12=12,cub=new Map();for(const r of edif)for(let i=Math.floor((r[0]-8)/B12);i<=Math.floor((r[2]+8)/B12);i++)for(let j=Math.floor((r[1]-8)/B12);j<=Math.floor((r[3]+8)/B12);j++){const k=i+','+j;(cub.get(k)||cub.set(k,[]).get(k)).push(r);}
 const alEdificio=(x,z)=>{let d=1e9,dx=0,dz=0;for(const r of cub.get(Math.floor(x/B12)+','+Math.floor(z/B12))||[]){const px=Math.max(r[0],Math.min(x,r[2])),pz=Math.max(r[1],Math.min(z,r[3])),dd=Math.hypot(px-x,pz-z);if(dd<d){d=dd;dx=px-x;dz=pz-z;}}return {d,dx,dz};};
 // el radio de copa que cabe en (x, z): el pedido, o lo que deja el edificio más cercano (null si ni copaMin)
 const cabe=(x,z,rad)=>{const l=alEdificio(x,z).d-P.holgura;return l>=rad?rad:l>=P.copaMin?Math.floor(l*100)/100:null;};
 // el borde de una copa (óvalo: r a lo largo de eje, ra de ancho) toca un edificio con su holgura
 const tocaBorde=(a)=>{const c=Math.cos(a.eje||0),sn=Math.sin(a.eje||0),rb=a.ra||a.r,H=P.holgura;for(let i=0;i<24;i++){const t=i/24*Math.PI*2,u=a.r*Math.cos(t),v=rb*Math.sin(t),x=a.x+u*c-v*sn,z=a.z+u*sn+v*c;
  for(const r of cub.get(Math.floor(x/B12)+','+Math.floor(z/B12))||[])if(Math.hypot(Math.max(r[0]-x,0,x-r[2]),Math.max(r[1]-z,0,z-r[3]))<H)return true;}return false;};
 const kindAt=(x,y)=>x<0||y<0||x>=W||y>=H?-1:m.kind[y*W+x];
 const calleK=k=>k===K.street||k===K.avenue;
 const vereda=CALLE.vereda,alc=V.alcorque;
 // las puertas de calle de la ciudad (su centro): ningún árbol delante
 // (medido a lo largo de la vereda: el árbol no cae a menos de V.puerta del borde del vano; la distancia de frente —la
 // vereda— no cuenta: en línea recta descartaba casi todos, los lotes de la ciudad tienen muchas puertas)
 const puertas=[];for(const L of bp.lots)for(const d of L.levels?.[0]?.doors||[])if(d.street)puertas.push({x:(d.x0+d.x1)/2,z:(d.y0+d.y1)/2,a:Math.hypot(d.x1-d.x0,d.y1-d.y0)/2,h:Math.abs(d.y1-d.y0)<1e-6});
 const frenteAPuerta=(x,z)=>puertas.some(p=>{const along=p.h?Math.abs(p.x-x):Math.abs(p.z-z),frente=p.h?Math.abs(p.z-z):Math.abs(p.x-x);return frente<vereda+.5&&along<p.a+V.puerta;});
 // (2026-10-18, FACHADAS.md B4: las copas tapaban las vitrinas. Ningún tronco frente al vidrio de una vidriera —la ventana
 // de local de la planta baja—: a lo largo, a menos de su medio ancho menos V.vidriera; queda en la columna entre dos)
 const vidrieras=[];for(const L of bp.lots)for(const w of L.levels?.[0]?.windows||[])if(w.shop)vidrieras.push({x:(w.x0+w.x1)/2,z:(w.y0+w.y1)/2,a:Math.hypot(w.x1-w.x0,w.y1-w.y0)/2,h:Math.abs(w.y1-w.y0)<1e-6});
 const frenteAVidriera=(x,z)=>vidrieras.some(p=>{const along=p.h?Math.abs(p.x-x):Math.abs(p.z-z),frente=p.h?Math.abs(p.z-z):Math.abs(p.x-x);return frente<vereda+.5&&along<p.a-V.vidriera;});
 // ---- 1. Árboles de calle de la ciudad: por cada vereda (el lado de una casilla de calle que da a algo que no es calle
 // ni el muro), tramos seguidos; el árbol en el alcorque junto al cordón (a vereda − alcorque/2 del borde del lote) ----
 // los ejes de las calles del monte: ningún tronco que no sea de calle a menos de su medio ancho
 const ejes=ejesMonte(I),enCalle=(x,z)=>ejes.some(({a,b,an})=>distSeg(x,z,a,b)<an/2);
 const tramosCiudad=veredasCiudad(m);
 for(const t of tramosCiudad){const T=t.av?V.avenida:V.calle,horiz=t.lado==='N'||t.lado==='S',L=(t.b1-t.b0)*CELL;
  // la línea de los árboles: dentro de la casilla de calle, a (vereda − alcorque/2) del lado que da al lote
  const borde=t.lado==='N'?t.a*CELL:t.lado==='S'?(t.a+1)*CELL:t.lado==='W'?t.a*CELL:(t.a+1)*CELL,s=t.lado==='N'||t.lado==='W'?1:-1,linea=borde+s*(vereda-alc/2);
  // (si cae delante de una puerta, se corre hasta 3 m al hueco libre más cercano —sin acercarse a la esquina ni al árbol
  // anterior a menos de 3/4 del espaciado—)
  let ult=-1e9;for(const u0 of aLoLargo(L,V.esquina,T.espaciado))for(const du of [0,.5,-.5,1,-1,1.5,-1.5,2,-2,2.5,-2.5,3,-3]){const u=u0+du;if(u<V.esquina||u>L-V.esquina||u-ult<.75*T.espaciado)continue;
   const v=t.b0*CELL+u,x=horiz?v:linea,z=horiz?linea:v;if(frenteAPuerta(x,z)||frenteAVidriera(x,z))continue;pon(arboles,{x,z,r:T.copa,tipo:t.av?'avenida':'calle',grupo:t.grupo});ult=u;break;}}
 // ---- 2. Árboles de calle del monte: por cada tramo de calle, a los dos lados, junto al cordón ----
 for(const [ci,c] of (I?.carreteras||[]).entries()){if(c.tipo!=='grilla'||!c.puntos)continue;const an=c.ancho||12,T=an>12?V.avenida:V.calle,calzada=an-2*vereda,o=calzada/2+alc/2;
  for(let i=1;i<c.puntos.length;i++){const a=c.puntos[i-1],b=c.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<1)continue;const ux=(b.x-a.x)/L,uz=(b.z-a.z)/L;
   for(const t of aLoLargo(L,V.esquina,T.espaciado))for(const s of [-1,1]){const x=a.x+ux*t-uz*o*s,z=a.z+uz*t+ux*o*s;
    if(x>=0&&z>=0&&x<=Wm&&z<=Hm)continue;// (dentro de la ciudad no)
    const q=at(x,z);if(!q?.carretera||q.escalinata)continue;if(todo.cerca(x,z,T.espaciado*.6))continue;pon(arboles,{x,z,r:T.copa,tipo:'calle',grupo:'m'+ci});}}}
 // ---- 3. La alameda (el borde verde): filas paralelas al muro, a 1/3 y 2/3 de su ancho, cada V.alameda.espaciado ----
 const anillo=(d,paso)=>{const pts=[];for(const v of aLoLargo(Wm+2*d,0,paso)){pts.push({x:v-d,z:-d},{x:v-d,z:Hm+d});}for(const v of aLoLargo(Hm+2*d,0,paso)){pts.push({x:-d,z:v-d},{x:Wm+d,z:v-d});}return pts;};
 {const ancho=Math.max(...(I?.cells||[]).filter(c=>c.borde).map(()=>18),18);
  for(let f=1;f<=V.alameda.filas;f++)for(const p of anillo(ancho*f/(V.alameda.filas+1),V.alameda.espaciado)){const q=at(p.x,p.z);if(!q?.borde)continue;if(todo.cerca(p.x,p.z,V.alameda.espaciado*.7))continue;pon(arboles,{...p,r:V.alameda.copa,tipo:'alameda',grupo:'a'+(p.z<0?'N':p.z>Hm?'S':p.x<0?'W':'E')});}}
 // ---- 4. Parques (los de barrio, las mitades que quedaron jardín): hasta V.parque.cobertura de copa, al azar con separación ----
 {const ps=(I?.cells||[]).filter(c=>c.parque);const visto=new Set();
  for(const c0 of ps){const k0=c0.x+','+c0.y;if(visto.has(k0))continue;const comp=[c0];visto.add(k0);
   for(let i=0;i<comp.length;i++){const c=comp[i];for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const k=(c.x+dx)+','+(c.y+dy),o=celdas.get(k);if(o?.parque&&!visto.has(k)){visto.add(k);comp.push(o);}}}
   const area=comp.length*CELL*CELL,[r0,r1]=V.parque.copa,meta=V.parque.cobertura*area,A=V.parque.arboledas;let copa=0;
   // las arboledas: de a una, entera —de 3 a 6 árboles alrededor de un centro (normal de radio A.radio), a ≥ A.separacion
   // entre ellos y de lo que ya hay—; si no le caben 3, no se planta (sin árboles sueltos). Hasta la cobertura; el resto
   // del parque queda de prado.
   const enParque=(x,z)=>{const q=at(x,z);return q?.parque&&x-Math.floor(x/CELL)*CELL>.6&&x-Math.floor(x/CELL)*CELL<CELL-.6&&z-Math.floor(z/CELL)*CELL>.6&&z-Math.floor(z/CELL)*CELL<CELL-.6&&comp.includes(q);};
   for(let g=0;g<comp.length*4&&copa<meta;g++){const c=comp[Math.floor(r()*comp.length)],cx=(c.x+.5)*CELL,cz=(c.y+.5)*CELL,quiere=3+Math.floor(r()*4),nueva=[];
    for(let t=0;t<40&&nueva.length<quiere;t++){const gg=Math.sqrt(-2*Math.log(r()+1e-9)),th=r()*Math.PI*2,x=cx+Math.cos(th)*gg*A.radio,z=cz+Math.sin(th)*gg*A.radio;
     if(!enParque(x,z)||todo.cerca(x,z,A.separacion)||enCalle(x,z)||nueva.some(p=>Math.hypot(p.x-x,p.z-z)<A.separacion)||(nueva.length&&!nueva.some(p=>Math.hypot(p.x-x,p.z-z)<=2*A.radio)))continue;/* (encadenada: a ≤ 2 radios de otro de la arboleda) */const rc=cabe(x,z,+(r0+r()*(r1-r0)).toFixed(2));if(rc==null)continue;nueva.push({x,z,r:rc,tipo:'parque'});}
    if(nueva.length<3)continue;for(const p of nueva){pon(arboles,p);copa+=Math.PI*p.r*p.r;}}}}
 // ---- 4b. Plazas y patios de manzana de la ciudad: hasta V.parque.cobertura de copa ----
 {const zonas=[K.plaza,K.courtyard];for(const kz of zonas){const cs=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(m.kind[y*W+x]===kz)cs.push([x,y]);if(!cs.length)continue;
  const meta=V.parque.cobertura*cs.length*CELL*CELL,[r0,r1]=V.parque.copa;let copa=0;
  for(let t=0;t<cs.length*40&&copa<meta;t++){const [cx,cy]=cs[Math.floor(r()*cs.length)],x=(cx+.2+.6*r())*CELL,z=(cy+.2+.6*r())*CELL,rad=r0+r()*(r1-r0);
   const rc=cabe(x,z,+rad.toFixed(2));if(todo.cerca(x,z,V.parque.separacion)||rc==null)continue;pon(arboles,{x,z,r:rc,tipo:kz===K.plaza?'plaza':'patio'});copa+=Math.PI*rc*rc;}}}
 // ---- 4c. Los jardines del monte: en cada media manzana con casas, lo que no es casa (a V.jardin.casa de ellas), hasta
 // V.jardin.cobertura de copa, árboles chicos ----
 {const casas=(I?.casas||[]).map(h=>{const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;return {x0:h.x-w/2,x1:h.x+w/2,z0:h.z-d/2,z1:h.z+d/2,m:h.manzana};});
  const resid=(I?.lots||[]).filter(L=>L.parts).flatMap(L=>L.parts.map(p=>({x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h})));
  const cerca=(x,z,b,d)=>x>b.x0-d&&x<b.x1+d&&z>b.z0-d&&z<b.z1+d;
  const porM=new Map();for(const c of I?.cells||[])if(c.lote&&!c.parque&&!c.mirador&&!c.edificio)(porM.get(c.manzana)||porM.set(c.manzana,[]).get(c.manzana)).push(c);
  // (y fuera de los pasajes peatonales que cruzan la manzana)
  const pasajes=(I?.grilla?.pasajes||[]).map(pj=>pj.vert?{x0:pj.u0,x1:pj.u1,z0:pj.d0,z1:pj.d1}:{x0:pj.d0,x1:pj.d1,z0:pj.u0,z1:pj.u1});
  for(const [k,cs] of porM){const [r0,r1]=V.jardin.copa,libre=(x,z)=>!casas.some(b=>cerca(x,z,b,V.jardin.casa))&&!resid.some(b=>cerca(x,z,b,V.jardin.casa))&&!pasajes.some(b=>cerca(x,z,b,.6));
   let area=0;for(const c of cs)for(const [dx,dz] of [[1.5,1.5],[4.5,1.5],[1.5,4.5],[4.5,4.5]])if(libre(c.x*CELL+dx,c.y*CELL+dz))area+=9;
   const meta=V.jardin.cobertura*area;let copa=0;
   for(let t=0;t<cs.length*30&&copa<meta;t++){const c=cs[Math.floor(r()*cs.length)],x=(c.x+.1+.8*r())*CELL,z=(c.y+.1+.8*r())*CELL,rad=r0+r()*(r1-r0);
    const rc=cabe(x,z,+rad.toFixed(2));if(!libre(x,z)||todo.cerca(x,z,V.jardin.separacion)||enCalle(x,z)||rc==null)continue;pon(arboles,{x,z,r:rc,tipo:'jardin'});copa+=Math.PI*rc*rc;}}}
 // ---- 5. El bosque del monte natural (fuera de la huella: ni lotes, ni calles, ni parques, ni el borde) y algún árbol en la pradera ----
 // (el manchón: ruido de valor suave —una grilla de B.escala m con valores al azar, interpolada—; donde pasa de umbral, la
 // densidad sube de 0 a B.denso veces la de base, y los árboles se juntan)
 const B=V.bosque.manchon,nodo=(i,j)=>{let h=Math.imul(i^0x5bd1e995,0x27d4eb2d)^Math.imul(j+bp.seed*131,0x165667b1);h^=h>>>15;h=Math.imul(h,0x85ebca6b);return ((h^(h>>>13))>>>0)/4294967296;};
 const manchon=(x,z)=>{const u=x/B.escala,v=z/B.escala,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j,su=fu*fu*(3-2*fu),sv=fv*fv*(3-2*fv);
  return (nodo(i,j)*(1-su)+nodo(i+1,j)*su)*(1-sv)+(nodo(i,j+1)*(1-su)+nodo(i+1,j+1)*su)*sv;};
 for(const c of I?.cells||[]){if(c.lote||c.carretera||c.parque||c.borde||c.mirador||c.escalinata)continue;
  const base=c.zona==='montaña'?V.bosque.densidad:c.zona==='pradera'?V.bosque.densidad*.25:0;if(!base)continue;
  if(c.edge!=null&&c.edge<CELL)continue;// (no al borde del acantilado)
  const n=manchon((c.x+.5)*CELL,(c.y+.5)*CELL),k=Math.max(0,Math.min(1,(n-B.umbral)/B.ancho)),dens=base*B.denso*k,[s0,s1]=V.bosque.separacion,sep=s1-(s1-s0)*k;
  for(let t=0;t<2;t++){if(r()>=dens/2)continue;
   const x=(c.x+.15+.7*r())*CELL,z=(c.y+.15+.7*r())*CELL,[r0,r1]=V.bosque.copa;if(todo.cerca(x,z,sep)||enCalle(x,z))continue;pon(arboles,{x,z,r:+(r0+r()*(r1-r0)).toFixed(2),tipo:'bosque'});}}
 // ---- 6. La playa: el agua (para medir la franja libre), el paseo con palmeras, las sombrillas y grupos de palmeras ----
 // (a menos de d del borde de una casilla de agua: la distancia al rectángulo de la casilla, exacta)
 const aAgua=(x,z,d)=>{const i0=Math.floor((x-d)/CELL)-1,i1=Math.floor((x+d)/CELL)+1,j0=Math.floor((z-d)/CELL)-1,j1=Math.floor((z+d)/CELL)+1;
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const c=celdas.get(i+','+j);if(!c||(c.zona!=='agua'&&c.zona!=='agua_honda'))continue;if(Math.hypot(Math.max(i*CELL-x,0,x-(i+1)*CELL),Math.max(j*CELL-z,0,z-(j+1)*CELL))<d)return true;}return false;};
 // (la arena: casilla de playa y, además, el terreno —el del 3D: islaDe con el rebaje del plano— a la altura de una playa
 // y lejos del borde de la isla: V.arena)
 const suelo=I?islaDe(m):null;if(suelo)suelo.setMascara(mascaraRebaje(I.huella||[]));
 const arena=(x,z)=>{const q=at(x,z);if(!q||q.zona!=='playa'||q.carretera||q.lote)return false;if(!suelo)return true;const h=suelo.height(x,z);return suelo.beyond(x,z)<=-V.arena.borde&&h>=V.arena.alto[0]&&h<=V.arena.alto[1];};
 // el paseo: una fila de palmeras a media casilla del muro, cada V.palmera.espaciado
 for(const p of anillo(CELL/2,V.palmera.espaciado))if(arena(p.x,p.z)&&!todo.cerca(p.x,p.z,V.palmera.espaciado*.6))pon(palmeras,{...p,r:V.palmera.copa,tipo:'paseo',especie:'palma_real'});
 // las sombrillas: filas paralelas al muro desde la casilla siguiente al paseo, cada V.sombrilla.espaciado, a ≥ agua del agua,
 // con un paso libre de V.sombrilla.paso cada V.sombrilla.cada m a lo largo
 const S=V.sombrilla,libreDe=v=>((v%S.cada)+S.cada)%S.cada<S.paso;
 // al azar (Poisson por dardos: S.reparto): cada dardo cae en una casilla de arena; se queda si es arena, no está en la franja
 // libre del agua ni en un paso libre, está a ≥ espaciado de todo y pasa la probabilidad de su distancia al agua
 {const RP=S.reparto,arenas=(I?.cells||[]).filter(c=>c.zona==='playa'&&!c.carretera&&!c.lote);
  // (el lado del muro y la posición a lo largo: el lado del que está más lejos, para las esquinas)
  const ladoDe=(x,z)=>{const o=[[-z,0,x],[z-Hm,1,x],[-x,2,z],[x-Wm,3,z]].sort((a,b)=>b[0]-a[0])[0];return [o[1],o[2]];};
  const distAgua=(x,z)=>{for(let d=S.agua+S.radio;d<=RP.vacio;d+=5)if(aAgua(x,z,d))return d;return RP.vacio;};
  const prob=d=>d<=RP.lleno?1:RP.minimo+(1-RP.minimo)*Math.max(0,(RP.vacio-d)/(RP.vacio-RP.lleno));
  for(let t=0;t<arenas.length*RP.dardos;t++){const c=arenas[Math.floor(r()*arenas.length)],x=(c.x+r())*CELL,z=(c.y+r())*CELL;
   if(!arena(x,z)||aAgua(x,z,S.agua+S.radio)||todo.cerca(x,z,S.espaciado+.02))continue;/* (+2 cm: las coordenadas se guardan con 2 decimales) */const [lado,along]=ladoDe(x,z);if(libreDe(along+1e4))continue;
   if(r()>=prob(distAgua(x,z)))continue;
   // (la tela: la de su concesión —el tramo entre dos pasos libres, de su lado del muro—)
   const con=Math.floor((along+1e4)/S.cada),tela=S.telas[Math.floor(rng(mix(bp.seed,lado*1000+con,77))()*S.telas.length)];
   pon(sombrillas,{x,z,r:S.radio,tela});}}
 // grupos de palmeras en la arena que quedó libre
 {const [g0,g1]=V.palmera.grupo,centros=vecinos(24);
  for(const c of I?.cells||[]){if(c.zona!=='playa'||r()>=.35)continue;const x=(c.x+.5)*CELL,z=(c.y+.5)*CELL;if(!arena(x,z)||centros.cerca(x,z,V.palmera.separacionGrupos)||todo.cerca(x,z,4))continue;
   centros.add({x,z});const n=g0+Math.floor(r()*(g1-g0+1));for(let k=0;k<n*6&&n>0;k++){const a=r()*Math.PI*2,rad=1.5+r()*2.5,px=x+Math.cos(a)*rad,pz=z+Math.sin(a)*rad;
    if(!arena(px,pz)||aAgua(px,pz,1)||todo.cerca(px,pz,2.2))continue;pon(palmeras,{x:px,z:pz,r:V.palmera.copa,tipo:'grupo',especie:'coco'});if(palmeras.filter(p=>Math.hypot(p.x-x,p.z-z)<5).length>=n)break;}}}
 // ---- 7. Las especies (medidas.js VEGETACION.especies y .diversidad): en el arbolado de la ciudad (todo menos el bosque)
 // cada calle y cada lado de la alameda, una especie —la que menos empuja los topes de especie, género y familia (la
 // regla 10-20-30)—; en parques, plazas, patios y jardines, árbol por árbol con la misma cuenta; el bosque, mezclado.
 const ES=V.especies,porId=new Map(ES.map(e=>[e.id,e])),uso=u=>ES.filter(e=>e.usos.includes(u));
 const urbanos=arboles.filter(a=>a.tipo!=='bosque'),T=urbanos.length||1,D=V.diversidad,cuenta={sp:new Map(),ge:new Map(),fa:new Map()};
 const suma=(e,n)=>{cuenta.sp.set(e.id,(cuenta.sp.get(e.id)||0)+n);cuenta.ge.set(e.genero,(cuenta.ge.get(e.genero)||0)+n);cuenta.fa.set(e.familia,(cuenta.fa.get(e.familia)||0)+n);};
 const peso=(e,n)=>Math.max(((cuenta.sp.get(e.id)||0)+n)/(D.especie*T),((cuenta.ge.get(e.genero)||0)+n)/(D.genero*T),((cuenta.fa.get(e.familia)||0)+n)/(D.familia*T));
 const elige=(lista,n)=>{let best=null,bw=1e9;for(const e of lista){const w=peso(e,n)+r()*1e-3;if(w<bw){bw=w;best=e;}}suma(best,n);return best;};
 const grupos=new Map();for(const a of urbanos)if(a.grupo)(grupos.get(a.grupo)||grupos.set(a.grupo,[]).get(a.grupo)).push(a);
 // (los grupos más grandes primero: así los topes se reparten donde más pesan)
 for(const g of [...grupos.values()].sort((x,y)=>y.length-x.length)){const u=g[0].tipo==='avenida'?'avenida':g[0].tipo==='alameda'?'alameda':'calle',e=elige(uso(u),g.length);for(const a of g)a.especie=e.id;}
 // (rebalanceo: si una especie pasó su tope —una calle larga entra entera—, sus calles más chicas pasan a la especie del
 // mismo uso que más margen tenga, sin pasar los topes de especie, género ni familia)
 {const usoDe=g=>g[0].tipo==='avenida'?'avenida':g[0].tipo==='alameda'?'alameda':'calle',gs=[...grupos.values()];
  for(let vuelta=0;vuelta<40;vuelta++){const pasada=[...cuenta.sp].find(([id,n])=>n>D.especie*T);if(!pasada)break;const id=pasada[0];
   const suyos=gs.filter(g=>g[0].especie===id).sort((a,b)=>a.length-b.length);let movido=false;
   for(const g of suyos){const de=porId.get(id),cands=uso(usoDe(g)).filter(e=>e.id!==id&&peso(e,g.length)<=1);if(!cands.length)continue;
    const e=cands.sort((a,b)=>peso(a,g.length)-peso(b,g.length))[0];suma(de,-g.length);suma(e,g.length);for(const a of g)a.especie=e.id;movido=true;break;}
   if(!movido)break;}}
 for(const a of urbanos)if(!a.especie)a.especie=elige(uso(a.tipo==='jardin'?'jardin':'parque'),1).id;
 // el bosque, por pisos (V.bosque.pisos): la banda por la altura relativa del árbol —con el límite borroso—, y en cada
 // manchón la especie dominante de su banda (dominio de los árboles; el resto, las otras de la banda)
 {const PB=V.bosque.pisos,bos=arboles.filter(a=>a.tipo==='bosque'),hs=bos.map(a=>suelo?suelo.height(a.x,a.z):0),h0=Math.min(...hs),h1=Math.max(...hs),rango=Math.max(1e-6,h1-h0);
  const campo=(x,z,k)=>{const u=x/PB.escala,v=z/PB.escala,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j,su=fu*fu*(3-2*fu),sv=fv*fv*(3-2*fv),nd=(a,b)=>rng(mix(bp.seed,a*7919+b,k))();
   return (nd(i,j)*(1-su)+nd(i+1,j)*su)*(1-sv)+(nd(i,j+1)*(1-su)+nd(i+1,j+1)*su)*sv;};
  bos.forEach((a,i)=>{const t=(hs[i]-h0)/rango+(campo(a.x,a.z,31)-.5)*2*PB.borroso,band=PB.bandas.find(b=>t<=b.hasta)||PB.bandas.at(-1),E=band.especies;
   const dom=E[Math.floor(campo(a.x,a.z,37)*E.length*.999)];a.especie=r()<PB.dominio?dom:E[Math.floor(r()*E.length)];a.piso=PB.bandas.indexOf(band);});}
 for(const a of [...arboles,...palmeras]){const e=porId.get(a.especie);a.follaje=e.follaje;a.color=e.flor||e.follaje;delete a.grupo;}
 const red=p=>({...p,x:+p.x.toFixed(2),z:+p.z.toFixed(2)});
 // ---- Al final: ninguna copa dentro de un edificio (V.poda) ----
 // (la distancia del tronco al edificio más cercano —lotes de la ciudad, edificios del monte, cuerpos de las casas—, y
 // hacia dónde: la copa de calle se poda en óvalo, con su eje a lo largo de la calle —perpendicular a esa dirección—)
 const descPoda={};const podados=arboles.filter(a=>{const e=alEdificio(a.x,a.z),lugar=e.d-P.holgura;if(a.r<=lugar)return true;
  if(a.tipo==='calle'||a.tipo==='avenida'){if(lugar<P.copaMin/2){descPoda[a.tipo]=(descPoda[a.tipo]||0)+1;return false;}
   // el óvalo: hacia la fachada (y hacia la calle) lugar; a lo largo, lo que tenía, como mucho P.largo veces lo de ancho
   const L=Math.hypot(e.dx,e.dz)||1;a.ra=Math.floor(lugar*100)/100;a.r=+Math.min(a.r,P.largo*lugar).toFixed(2);a.eje=+Math.atan2(e.dx/L,-e.dz/L).toFixed(4);
   // (a lo largo, hasta que su borde no toque otro edificio —el de la esquina—)
   while(a.r>a.ra&&tocaBorde(a))a.r=+(a.r-.25).toFixed(2);if(tocaBorde(a)){descPoda[a.tipo]=(descPoda[a.tipo]||0)+1;return false;}return true;}
  if(lugar>=P.copaMin&&(a.r=Math.floor(lugar*100)/100,!tocaBorde(a)))return true;descPoda[a.tipo]=(descPoda[a.tipo]||0)+1;return false;});
 arboles.length=0;arboles.push(...podados);
 // ---- Al final: nada en una zona prohibida (ZONAS de medidas.js; las cebras todavía no están: las mira el validador) ----
 const Z=mapaDeZonas(bp,{cebras:[]}),descartes={},deja=(lista,tipo)=>lista.map(red).filter(o=>{if(prohibidasDe(Z,o,tipo,tipo==='sombrilla'?'':o.tipo).length){descartes[tipo]=(descartes[tipo]||0)+1;return false;}return true;});
 return {arboles:deja(arboles,'arbol'),palmeras:deja(palmeras,'palmera'),sombrillas:deja(sombrillas,'sombrilla'),descartes,podados:descPoda};
}

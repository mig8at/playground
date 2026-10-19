/* El equipamiento urbano, por cálculo (FUGA, 2026-10-15): faroles, pasos de cebra, semáforos, paradas de bus,
   hidrantes, bancas y papeleras, con las medidas de medidas.js EQUIPAMIENTO, sobre el plano y la vegetación ya puestos
   (generateBlueprint): esquiva los troncos y las puertas, y no cambia nada de lo que ya estaba.
   Cada objeto: {tipo, x, z} y, los que tienen forma, ang (radianes, el largo a lo largo de x si 0), largo, fondo. */
import {EQUIPAMIENTO as Q,VEGETACION as V,CALLE} from './medidas.js';
import {CELL,rng,mix,vecinos,veredasCiudad,ejesMonte,distSeg,crucesCiudad} from './veredas.js';
import City from './ciudad.js';
import {mapaDeZonas,prohibidasDe} from './zonas.js';
import {altoSuelo} from './circulacion.js';

export function equipar(bp){
 const {map:m,isla:I,vegetacion:VG}=bp,{W,H}=m,K=City.K,Wm=W*CELL,Hm=H*CELL,r=rng(mix(bp.seed,bp.team||0,8191)),vereda=CALLE.vereda;
 const objs=[],ocup=vecinos(8),arboles=vecinos(8);for(const a of [...(VG?.arboles||[]),...(VG?.palmeras||[]),...(VG?.sombrillas||[])])arboles.add(a);// (las sombrillas también: su mástil choca)
 // (2026-10-16, medido sin pantalla —validar-oclusion—: un objeto no se pone donde su planta pisa la de otro —antes se
 // miraba la distancia entre centros: un farol quedaba adentro de una parada, dos bancas una encima de la otra— ni, si es
 // de base plana, donde el suelo no está parejo bajo sus esquinas —una papelera quedaba con una esquina 92 cm hundida al
 // borde de una terraza—. Una parada, que hace falta donde va, saca el farol que pisa)
 const alto=altoSuelo(bp),PLANA=new Set(['banca','papelera','kiosco','parada','salvavidas','hidrante']);
 const huellaEq=o=>{if(o.largo&&o.fondo){const c=Math.cos(o.ang||0),s=Math.sin(o.ang||0),a=o.largo/2,b=o.fondo/2;return {x:o.x,z:o.z,c,s,a,b,esq:[[-a,-b],[a,-b],[a,b],[-a,b]].map(([u,v])=>[o.x+u*c+v*s,o.z-u*s+v*c])};}
  const r=o.tipo==='papelera'?Q.papelera.lado/2:o.tipo==='farol'||o.tipo==='farol_parque'?.15:.2;return {x:o.x,z:o.z,disco:true,r};};
 const radio=h=>h.disco?h.r:Math.hypot(h.a,h.b),proyH=(E,ax)=>{const p=E.map(([x,z])=>x*ax[0]+z*ax[1]);return [Math.min(...p),Math.max(...p)];};
 const pisan=(P,Q2,hol=.3)=>{if(Math.hypot(P.x-Q2.x,P.z-Q2.z)>radio(P)+radio(Q2)+hol)return false;if(P.disco&&Q2.disco)return Math.hypot(P.x-Q2.x,P.z-Q2.z)<P.r+Q2.r+hol;
  if(P.disco||Q2.disco){const [D,R]=P.disco?[P,Q2]:[Q2,P],dx=D.x-R.x,dz=D.z-R.z,u=Math.max(-R.a,Math.min(R.a,dx*R.c-dz*R.s)),v=Math.max(-R.b,Math.min(R.b,dx*R.s+dz*R.c));return Math.hypot(D.x-(R.x+u*R.c+v*R.s),D.z-(R.z-u*R.s+v*R.c))<D.r+hol;}
  for(const R of [P,Q2])for(const ax of [[R.c,-R.s],[R.s,R.c]]){const a=proyH(P.esq,ax),b=proyH(Q2.esq,ax);if(a[1]+hol<=b[0]||b[1]+hol<=a[0])return false;}return true;};
 // (y entero sobre una calle del monte —andén incluido— o entero afuera, con 15 cm: una banca sobre el borde del andén quedaba
 // con dos patas en el andén y dos en el terreno, 10 cm más abajo)
 const enCalleMonte=(x,z)=>ejes.some(g=>distSeg(x,z,g.a,g.b)<g.an/2);
 const parejo=o=>{if(!PLANA.has(o.tipo))return true;const h=huellaEq(o),pts=h.disco?[[o.x+h.r,o.z],[o.x-h.r,o.z],[o.x,o.z+h.r],[o.x,o.z-h.r]]:h.esq,h0=alto(o.x,o.z);if(h0==null)return true;
  const borde=pts.map(([x,z])=>[x+(x-o.x)*.15/(Math.hypot(x-o.x,z-o.z)||1),z+(z-o.z)*.15/(Math.hypot(x-o.x,z-o.z)||1)]),lado=enCalleMonte(o.x,o.z);if(borde.some(([x,z])=>enCalleMonte(x,z)!==lado))return false;
  return pts.every(([x,z])=>{const v=alto(x,z);return v==null||Math.abs(v-h0)<=Q.apoyo;});};
 // (la parada hace falta donde va —la cobertura de las viviendas—: no se descarta; saca lo que pisa de lo que sobra —farol,
 // banca, papelera— y en el terreno natural la aplana su plataforma, island3d)
 const SOBRA=new Set(['farol','banca','papelera']);
 const pon=o=>{if(o.tipo!=='cebra'){if(o.tipo!=='parada'&&!parejo(o))return null;const h=huellaEq(o),choca=objs.filter(q=>q.tipo!=='cebra'&&!q.quitado&&pisan(h,huellaEq(q)));
   if(choca.length){if(o.tipo==='parada'){for(const q of choca)if(SOBRA.has(q.tipo))q.quitado=true;}else return null;}}
  objs.push(o);ocup.add(o);return o;};
 const celdas=new Map((I?.cells||[]).map(c=>[c.x+','+c.y,c])),at=(x,z)=>celdas.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const puertas=[];for(const L of bp.lots)for(const d of L.levels?.[0]?.doors||[])if(d.street)puertas.push({x:(d.x0+d.x1)/2,z:(d.y0+d.y1)/2,a:Math.hypot(d.x1-d.x0,d.y1-d.y0)/2,h:Math.abs(d.y1-d.y0)<1e-6});
 const frenteAPuerta=(x,z)=>puertas.some(p=>{const along=p.h?Math.abs(p.x-x):Math.abs(p.z-z),fr=p.h?Math.abs(p.z-z):Math.abs(p.x-x);return fr<vereda+.5&&along<p.a+V.puerta;});
 // un lugar libre: lejos de troncos (d), de otros objetos (1 m) y de las puertas
 const libre=(x,z,dArbol=1)=>!arboles.cerca(x,z,dArbol)&&!ocup.cerca(x,z,1)&&!frenteAPuerta(x,z)&&!enCalzada(x,z);
 // corre el punto a lo largo de su vereda (du) hasta que quede libre; null si no hay lugar
 const correr=(f,u0,L,dArbol,max)=>{for(const du of [0,1,-1,2,-2,3,-3,4,-4,5,-5].filter(v=>Math.abs(v)<=max)){const u=u0+du;if(u<.5||u>L-.5)continue;const p=f(u);if(libre(p.x,p.z,dArbol))return {...p,u};}return null;};
 const veredas=veredasCiudad(m),ejes=ejesMonte(I);
 const enCalzada=(x,z)=>ejes.some(g=>distSeg(x,z,g.a,g.b)<(g.an-2*vereda)/2);
 // los puntos de vereda de la ciudad, cada 1 m, en la franja junto al cordón: donde se acomodan semáforos e hidrantes
 const franja=[];for(const t of veredas)for(let u=.5;u<t.L;u+=1)franja.push(t.en(u,vereda-Q.farol.cordon));
 const acomodar=(x,z,max=8)=>{let best=null,bd=max;for(const p of franja){const d=Math.hypot(p.x-x,p.z-z);if(d<bd&&libre(p.x,p.z,1)){bd=d;best=p;}}return best;};
 // ---- 1. Faroles de la ciudad: alternados (una vereda en la fase 0, la de enfrente en la mitad), a 0,5 m del cordón ----
 for(const t of veredas){const S=t.av?Q.farolAvenida.separacion:Q.farol.separacion,alto=t.av?Q.farolAvenida.alto:Q.farol.alto,fase=t.lado==='N'||t.lado==='W'?0:S/2;
  const v0=t.b0*CELL,u1=Math.ceil((v0-fase)/S)*S+fase-v0;
  // (hacia: el ángulo, en x-z, de la dirección a la calzada —de la fachada al cordón—: por ahí sale el brazo)
  const e0=t.en(0,0),e1=t.en(0,1),hacia=+Math.atan2(e1.z-e0.z,e1.x-e0.x).toFixed(4);
  for(let u=u1;u<=t.L;u+=S){const p=correr(uu=>t.en(uu,vereda-Q.farol.cordon),u,t.L,Q.farol.arbol,Q.farol.corre);if(p)pon({tipo:'farol',x:p.x,z:p.z,alto,hacia});}}
 // ---- 2. Faroles del monte: a los dos lados, alternados, a 0,5 m del cordón ----
 for(const g of ejes){const L=Math.hypot(g.b.x-g.a.x,g.b.z-g.a.z);if(L<2)continue;const ux=(g.b.x-g.a.x)/L,uz=(g.b.z-g.a.z)/L,S=g.an>12?Q.farolAvenida.separacion:Q.farol.separacion,o=(g.an-2*vereda)/2+Q.farol.cordon;
  for(const s of [1,-1])for(let u=s>0?S/2:S;u<L;u+=S){const f=uu=>({x:g.a.x+ux*uu-uz*o*s,z:g.a.z+uz*uu+ux*o*s}),p=correr(f,u,L,Q.farol.arbol,Q.farol.corre);
   if(p&&!(p.x>=0&&p.z>=0&&p.x<=Wm&&p.z<=Hm)&&at(p.x,p.z)?.carretera&&!enCalzada(p.x,p.z))pon({tipo:'farol',x:p.x,z:p.z,alto:g.an>12?Q.farolAvenida.alto:Q.farol.alto,hacia:+Math.atan2(-ux*s,uz*s).toFixed(4)});}}
 // ---- 3. La alameda y el paseo: faroles peatonales y bancas (filas paralelas al muro) ----
 const anillo=(d,paso,ini=0)=>{const pts=[];for(let v=ini;v<=Wm+2*d;v+=paso)pts.push({x:v-d,z:-d,ang:0},{x:v-d,z:Hm+d,ang:0});for(let v=ini;v<=Hm+2*d;v+=paso)pts.push({x:-d,z:v-d,ang:Math.PI/2},{x:Wm+d,z:v-d,ang:Math.PI/2});return pts;};
 const borde=(x,z)=>at(x,z)?.borde,arena=(x,z)=>{const c=at(x,z);return c?.zona==='playa'&&!c.carretera;};
 const anchoBorde=18,senda=anchoBorde/2;
 for(const p of anillo(senda,Q.farolPeatonal.separacion))if(borde(p.x,p.z)&&libre(p.x,p.z,1.5))pon({tipo:'farol',x:p.x,z:p.z,alto:Q.farolPeatonal.alto,peatonal:true});
 // (una punta libre: nada a menos de 0,9 m más allá de una de sus puntas —para una silla de ruedas, Helsinki—; si no, se
 // corre a lo largo hasta 4 m)
 const puntaLibre=(x,z,ang,s0)=>{const ca=Math.cos(ang),sa=Math.sin(ang);for(let t=Q.banca.largo/2+.2;t<=Q.banca.largo/2+Q.banca.libre;t+=.35){const px=x+ca*t*s0,pz=z+sa*t*s0;if(arboles.cerca(px,pz,.5)||ocup.cerca(px,pz,.5))return false;}return true;};
 // (ni sobre una vereda del monte: donde una calle cruza el borde verde, la banca le quitaba el paso libre)
 const enVeredaMonte=(x,z,m=0)=>ejes.some(g=>distSeg(x,z,g.a,g.b)<g.an/2+m);
 const banca=(x0,z0,ang)=>{let x=x0,z=z0,ok=false;for(const d of [0,1,-1,2,-2,3,-3,4,-4]){x=x0+Math.cos(ang)*d;z=z0+Math.sin(ang)*d;if(libre(x,z,1.2)&&!enVeredaMonte(x,z,Q.banca.largo/2+.3)&&(puntaLibre(x,z,ang,1)||puntaLibre(x,z,ang,-1))){ok=true;break;}}if(!ok)return null;
  const b=pon({tipo:'banca',x,z,ang,largo:Q.banca.largo,fondo:Q.banca.fondo});if(!b)return null;
  const px=x+Math.cos(ang)*(Q.banca.largo/2+Q.banca.libre+Q.papelera.lado*.5),pz=z+Math.sin(ang)*(Q.banca.largo/2+Q.banca.libre+Q.papelera.lado*.5);if(libre(px,pz,.8)&&!enVeredaMonte(px,pz,.6))pon({tipo:'papelera',x:px,z:pz});return b;};
 for(const p of anillo(senda+1.5,Q.banca.alameda,Q.banca.alameda/2))if(borde(p.x,p.z))banca(p.x,p.z,p.ang);
 for(const p of anillo(1.5,Q.farolPeatonal.separacion,Q.farolPeatonal.separacion/2))if(arena(p.x,p.z)&&libre(p.x,p.z,1.5))pon({tipo:'farol',x:p.x,z:p.z,alto:Q.farolPeatonal.alto,peatonal:true});
 for(const p of anillo(4.5,Q.banca.paseo,Q.banca.paseo/4))if(arena(p.x,p.z))banca(p.x,p.z,p.ang);
 // ---- 4. Parques, plazas y el mirador: una banca cada Q.banca.area m² ----
 {const zonas=[];const vis=new Set();for(const c0 of I?.cells||[]){if(!(c0.parque||c0.mirador)||vis.has(c0))continue;const comp=[c0];vis.add(c0);
   for(let i=0;i<comp.length;i++){const c=comp[i];for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const o=celdas.get((c.x+dx)+','+(c.y+dy));if(o&&(o.parque||o.mirador)&&!vis.has(o)){vis.add(o);comp.push(o);}}}zonas.push(comp.map(c=>[c.x,c.y]));}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){}// (las plazas de la ciudad, abajo)
  const pl=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(m.kind[y*W+x]===K.plaza)pl.push([x,y]);if(pl.length)zonas.push(pl);
  for(const cs of zonas){const n=Math.max(1,Math.round(cs.length*CELL*CELL/Q.banca.area));let k=0;
   for(let t=0;t<n*30&&k<n;t++){const [cx,cy]=cs[Math.floor(r()*cs.length)],x=(cx+.25+.5*r())*CELL,z=(cy+.25+.5*r())*CELL;if(banca(x,z,r()<.5?0:Math.PI/2))k++;}}}
 // ---- 5. Pasos de cebra, semáforos e hidrantes en los cruces de la ciudad ----
 for(const c of crucesCiudad(m)){const {x0,x1,z0,z1}=c.caja,Cz=Q.cebra.ancho,pare=Q.cebra.pare;
  for(const b of c.brazos){// la cebra: en el brazo, pegada a la caja del cruce, de cordón a cordón
   const vert=b==='N'||b==='S',cx=vert?(x0+x1)/2:b==='W'?x0-Cz/2:x1+Cz/2,cz=vert?(b==='N'?z0-Cz/2:z1+Cz/2):(z0+z1)/2,largo=(vert?x1-x0:z1-z0)-2*vereda;
   pon({tipo:'cebra',x:cx,z:cz,ang:vert?0:Math.PI/2,largo,fondo:Cz});
   if(c.av){// el semáforo: en la vereda a la derecha del que llega, pasando la línea de pare
    const sx=b==='N'?x0+vereda/2:b==='S'?x1-vereda/2:b==='W'?x0-Cz-pare-.5:x1+Cz+pare+.5,sz=b==='N'?z0-Cz-pare-.5:b==='S'?z1+Cz+pare+.5:b==='W'?z1-vereda/2:z0+vereda/2;
    const q=acomodar(sx,sz);if(q)pon({tipo:'semaforo',x:q.x,z:q.z,brazo:b});}}
  // el hidrante: en la esquina del primer brazo, en la vereda, pasando la cebra
  const b=c.brazos[0];if(b){const hx=b==='N'?x1-vereda/2:b==='S'?x0+vereda/2:b==='W'?x0-Cz-2:x1+Cz+2,hz=b==='N'?z0-Cz-2:b==='S'?z1+Cz+2:b==='W'?z0+vereda/2:z1-vereda/2;{const q=acomodar(hx,hz);if(q)pon({tipo:'hidrante',x:q.x,z:q.z});}}}
 // ---- 6. Pasos de cebra e hidrantes en los cruces del monte (los de 3 o más calles) ----
 {const puntas=new Map(),k=p=>Math.round(p.x)+','+Math.round(p.z);
  for(const c of I?.carreteras||[]){if(c.tipo!=='grilla'||!c.puntos||c.puntos.length<2)continue;for(const [p,q] of [[c.puntos[0],c.puntos[1]],[c.puntos.at(-1),c.puntos.at(-2)]]){const kk=k(p);(puntas.get(kk)||puntas.set(kk,[]).get(kk)).push({p,q,an:c.ancho||12});}}
  for(const ps of puntas.values()){if(ps.length<3)continue;const ancho=Math.max(...ps.map(e=>e.an));let hid=false;
   for(const {p,q,an} of ps){const L=Math.hypot(q.x-p.x,q.z-p.z)||1,ux=(q.x-p.x)/L,uz=(q.z-p.z)/L,o=ancho/2+Q.cebra.ancho/2,calzada=an-2*vereda;
    pon({tipo:'cebra',x:p.x+ux*o,z:p.z+uz*o,ang:Math.atan2(-ux,uz),largo:calzada,fondo:Q.cebra.ancho});
    if(!hid){const d=ancho/2+Q.cebra.ancho+2,e=an/2-vereda+CALLE.mobiliario/2;/* (en la franja del mobiliario, junto al cordón: el paso libre queda entero) */const hx=p.x+ux*d-uz*e,hz=p.z+uz*d+ux*e;if(libre(hx,hz,1)&&!enCalzada(hx,hz)){pon({tipo:'hidrante',x:hx,z:hz});hid=true;}}}}}
 // ---- 6b. La playa: torres de salvavidas y kioscos en los pasos libres entre sombrillas (los de VEGETACION.sombrilla: un
 // paso de .paso m cada .cada m a lo largo del muro; su centro, a .paso/2 del comienzo) ----
 {const SB=V.sombrilla,aAgua=(x,z)=>{let best=1e9;const i0=Math.floor(x/CELL)-3,j0=Math.floor(z/CELL)-3;for(let i=i0;i<=i0+6;i++)for(let j=j0;j<=j0+6;j++){const c=celdas.get(i+','+j);if(!c||(c.zona!=='agua'&&c.zona!=='agua_honda'))continue;best=Math.min(best,Math.hypot(Math.max(i*CELL-x,0,x-(i+1)*CELL),Math.max(j*CELL-z,0,z-(j+1)*CELL)));}return best;};
  const arena=(x,z)=>{const c=at(x,z);return c?.zona==='playa'&&!c.carretera&&!c.lote;};
  // (hacia: la torre y el kiosco miran al mar: al punto de agua más cercano —el borde de su casilla—, a ≤ 200 m)
  const aguas=[...celdas.values()].filter(c=>c.zona==='agua'||c.zona==='agua_honda');
  const alMar=(x,z)=>{let b=null,bd=200;for(const c of aguas){const px=Math.max(c.x*CELL,Math.min(x,(c.x+1)*CELL)),pz=Math.max(c.y*CELL,Math.min(z,(c.y+1)*CELL)),d=Math.hypot(px-x,pz-z);if(d<bd){bd=d;b=[px,pz];}}return b?+Math.atan2(b[1]-z,b[0]-x).toFixed(4):null;};
  for(const [lado,largo] of [['N',Wm],['S',Wm],['W',Hm],['E',Hm]]){let n=0;
   for(let v=-200+SB.paso/2;v<largo+200;v+=SB.cada){const pt=d=>lado==='N'?{x:v,z:-d}:lado==='S'?{x:v,z:Hm+d}:lado==='W'?{x:-d,z:v}:{x:Wm+d,z:v};
    // el paso: del muro hacia el agua, mientras haya arena
    let ult=null,primera=null;for(let d=3;d<220;d+=1){const p=pt(d);if(!arena(p.x,p.z)){if(ult)break;continue;}if(!primera)primera={...p,d};const w=aAgua(p.x,p.z);if(w>=Q.salvavidas.agua[0]&&w<=Q.salvavidas.agua[1])ult=p;if(w<Q.salvavidas.agua[0])break;}
    if(!primera)continue;const ang=lado==='N'||lado==='S'?0:Math.PI/2;
    if(ult&&libre(ult.x,ult.z,1.5))pon({tipo:'salvavidas',x:ult.x,z:ult.z,ang,hacia:alMar(ult.x,ult.z),largo:Q.salvavidas.lado,fondo:Q.salvavidas.lado,alto:Q.salvavidas.alto});
    if(n++%Q.kiosco.cada===0){const k=pt(Math.max(primera.d,4.5));if(arena(k.x,k.z)&&libre(k.x,k.z,Q.kiosco.lado/2*Math.SQRT2+.3))pon({tipo:'kiosco',x:k.x,z:k.z,ang,hacia:alMar(k.x,k.z),largo:Q.kiosco.lado,fondo:Q.kiosco.lado});}}}}
 // ---- 7. Los hogares (para paradas e hidrantes) y los lugares de vereda donde puede ir algo ----
 const hogares=[...bp.lots.filter(L=>['vivienda','comercio','casa','residencial','oficinas','hotel','hospital','colegio','biblioteca','bomberos','comisaria','objetivo','local'].includes(L.type)).map(L=>({x:L.rect.x+L.rect.w/2,z:L.rect.y+L.rect.h/2,casa:['vivienda','comercio','casa','residencial'].includes(L.type)})),
  ...(I?.lots||[]).filter(L=>L.type==='residencial'&&L.parts).map(L=>({x:L.parts[0].x+L.parts[0].w/2,z:L.parts[0].y+L.parts[0].h/2,casa:true})),...(I?.casas||[]).map(h=>({x:h.x,z:h.z,casa:true}))];
 const lugares=[];// en la vereda: los refugios, junto al cordón (detrás queda el paso libre: CALLE.paso)
 // (hacia: el refugio mira a la calzada —de la fachada al cordón—)
 for(const t of veredas){const e0=t.en(0,0),e1=t.en(0,1),hacia=+Math.atan2(e1.z-e0.z,e1.x-e0.x).toFixed(4);for(let u=Q.parada.esquina;u<=t.L-Q.parada.esquina;u+=3){const p=t.en(u,vereda-.1-Q.parada.fondo/2);lugares.push({...p,ang:t.horiz?0:Math.PI/2,hacia,ruta:t.av||t.a<=2||t.a>=(t.horiz?H:W)-3});}}
 for(const g of ejes){const L=Math.hypot(g.b.x-g.a.x,g.b.z-g.a.z),ux=(g.b.x-g.a.x)/L,uz=(g.b.z-g.a.z)/L,o=g.an/2-vereda+.1+Q.parada.fondo/2;for(let u=Q.parada.esquina;u<=L-Q.parada.esquina;u+=3)for(const s of [1,-1]){const x=g.a.x+ux*u-uz*o*s,z=g.a.z+uz*u+ux*o*s;if(!(x>=0&&z>=0&&x<=Wm&&z<=Hm)&&at(x,z)?.carretera)lugares.push({x,z,ang:Math.atan2(uz,ux),hacia:+Math.atan2(-ux*s,uz*s).toFixed(4),ruta:true});}}
 // ---- 8. Paradas de bus: sobre la ruta (avenidas, la circunvalación y las calles del monte), la que cubre más hogares
 // todavía sin parada a ≤ radio, a ≥ separación de las otras, hasta cubrirlos a todos ----
 // (voraz: puede dejar un hueco que ya no se cubre sin juntar dos paradas; entonces vuelve a empezar desde otra primera
 // parada —la k-ésima mejor—, hasta 12 veces, y se queda con el primer reparto que cubre a todos o, si ninguno, el que
 // deja menos viviendas sin parada)
 // (sin los lugares donde una parada cae en una zona prohibida: se descartaba al final, después de contar a quién cubría,
 // y sus viviendas quedaban sin parada —ciudad 3, 2026-10-17: 28 viviendas a más de 200 m—)
 {const Zp=mapaDeZonas(bp,{cebras:objs.filter(o=>o.tipo==='cebra'&&!o.quitado)}),deja=l=>!prohibidasDe(Zp,{tipo:'parada',x:l.x,z:l.z,ang:l.ang,hacia:l.hacia,largo:Q.parada.largo,fondo:Q.parada.fondo},'parada','').length;
  const casas=hogares.filter(h=>h.casa),ruta=lugares.filter(l=>l.ruta),libres=lugares.filter(l=>libre(l.x,l.z,2)&&deja(l)),libreR=new Set(libres);
  const repartir=k0=>{const cubierta=new Array(casas.length).fill(false),paradas=[];
   for(let it=0;it<60;it++){const cand=[];for(const l of (it<30?ruta:lugares)){if(!libreR.has(l)||paradas.some(p=>Math.hypot(p.x-l.x,p.z-l.z)<Q.parada.separacion))continue;
     let n=0;for(let i=0;i<casas.length;i++)if(!cubierta[i]&&Math.hypot(casas[i].x-l.x,casas[i].z-l.z)<=Q.parada.radio)n++;if(n>0)cand.push([n,l]);}
    if(!cand.length){if(it<30){it=29;continue;}break;}cand.sort((a,b)=>b[0]-a[0]);const best=cand[it===0?Math.min(k0,cand.length-1):0][1];paradas.push(best);
    for(let i=0;i<casas.length;i++)if(Math.hypot(casas[i].x-best.x,casas[i].z-best.z)<=Q.parada.radio)cubierta[i]=true;if(cubierta.every(Boolean))break;}
   return {paradas,faltan:cubierta.filter(c=>!c).length};};
  let mejor=null;for(let k=0;k<12;k++){const R=repartir(k);if(!mejor||R.faltan<mejor.faltan||(R.faltan===mejor.faltan&&R.paradas.length<mejor.paradas.length&&k===0))mejor=R;if(!R.faltan)break;}
  for(const b of mejor.paradas)pon({tipo:'parada',x:b.x,z:b.z,ang:b.ang,hacia:b.hacia,largo:Q.parada.largo,fondo:Q.parada.fondo});}
 // ---- 9. Hidrantes que faltan: ningún edificio a más de Q.hidrante.edificio de uno ----
 {const hs=()=>objs.filter(o=>o.tipo==='hidrante');for(const h of hogares){if(hs().some(o=>Math.hypot(o.x-h.x,o.z-h.z)<=Q.hidrante.edificio))continue;
   let best=null,bd=1e9;for(const l of lugares){const d=Math.hypot(l.x-h.x,l.z-h.z);if(d<bd&&libre(l.x,l.z,1)){bd=d;best=l;}}if(best&&bd<=Q.hidrante.edificio)pon({tipo:'hidrante',x:best.x,z:best.z});}}
 // ---- Al final: nada en una zona prohibida (ZONAS de medidas.js, el mismo clasificador del validador); lo que cae mal
 // no se pone (descartes: cuántos de cada tipo, para medirlo)
 const fin=objs.filter(o=>!o.quitado).map(o=>{const {quitado,...q}=o;return {...q,x:+o.x.toFixed(2),z:+o.z.toFixed(2)};}),Z=mapaDeZonas(bp,{cebras:fin}),descartes={};
 const out=fin.filter(o=>{const p=prohibidasDe(Z,o,o.tipo,o.peatonal?'peatonal':'');if(p.length){descartes[o.tipo]=(descartes[o.tipo]||0)+1;return false;}return true;});out.descartes=descartes;return out;
}

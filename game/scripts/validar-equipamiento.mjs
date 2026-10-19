// Valida el equipamiento urbano con matemática, sin el 3D (2026-10-15, equipamiento.js): dónde va cada farol, cebra,
// semáforo, parada, hidrante, banca y papelera (medidas.js EQUIPAMIENTO), y mide la cobertura: veredas iluminadas,
// edificios a ≤ 75 m de un hidrante, viviendas a ≤ radio de una parada.
// Uso: node scripts/validar-equipamiento.mjs [ciudades=6] [semilla0=1] [jugadores=3]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {EQUIPAMIENTO as Q,VEGETACION as V,CALLE} from '../src/engine/medidas.js';
import {veredasCiudad,ejesMonte,distSeg,crucesCiudad} from '../src/engine/veredas.js';
import City from '../src/engine/ciudad.js';

const N=+(process.argv[2]||6),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3),E=1e-6,K=City.K,vereda=CALLE.vereda;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const tot={},luz=[0,0],hid=[0,0],par=[0,0],orilla=[0,0];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),m=bp.map,I=bp.isla,EQ=bp.equipamiento,{W,H}=m,Wm=W*CELL,Hm=H*CELL;
 for(const o of EQ)tot[o.tipo]=(tot[o.tipo]||0)+1;
 const cel=new Map(I.cells.map(c=>[c.x+','+c.y,c])),at=(x,z)=>cel.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const kind=(x,z)=>{const cx=Math.floor(x/CELL),cy=Math.floor(z/CELL);return cx<0||cy<0||cx>=W||cy>=H?null:m.kind[cy*W+cx];},calle=k=>k===K.street||k===K.avenue;
 const rects=[...bp.lots.flatMap(L=>L.parts||[]),...I.lots.filter(L=>L.parts).flatMap(L=>L.parts),...I.casas.map(h=>{const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;return {x:h.x-w/2,y:h.z-d/2,w,h:d};})];
 const dentro=(x,z)=>rects.some(r=>x>r.x+E&&x<r.x+r.w-E&&z>r.y+E&&z<r.y+r.h-E);
 const ejes=ejesMonte(I),troncos=[...bp.vegetacion.arboles,...bp.vegetacion.palmeras];
 const puertas=bp.lots.flatMap(L=>(L.levels?.[0]?.doors||[]).filter(d=>d.street));
 const enCiudad=(x,z)=>x>=0&&z>=0&&x<Wm&&z<Hm;
 for(const o of EQ){const ej={semilla:s,tipo:o.tipo,x:o.x,z:o.z};
  if(dentro(o.x,o.z))falla('objeto dentro de un edificio o una casa',ej);
  if(o.tipo!=='cebra'){
   if(enCiudad(o.x,o.z)){const k=kind(o.x,o.z);if(calle(k)){const cx=Math.floor(o.x/CELL),cy=Math.floor(o.z/CELL),dd=[[o.z-cy*CELL,0,-1],[(cy+1)*CELL-o.z,0,1],[o.x-cx*CELL,-1,0],[(cx+1)*CELL-o.x,1,0]];
     if(!dd.some(([d,dx,dy])=>d<=vereda+E&&!calle(kind(o.x+dx*CELL,o.z+dy*CELL))&&kind(o.x+dx*CELL,o.z+dy*CELL)!==K.kiosk))falla('objeto de la ciudad sobre la calzada',ej);}
    else if(k!==K.plaza&&k!==K.courtyard)falla('objeto de la ciudad fuera de la vereda y de las plazas',{...ej,casilla:k});}
   else for(const g of ejes){if(distSeg(o.x,o.z,g.a,g.b)<(g.an-2*vereda)/2-E){falla('objeto del monte sobre la calzada',ej);break;}}
   for(const d of puertas){const h=Math.abs(d.y1-d.y0)<E,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,an=Math.hypot(d.x1-d.x0,d.y1-d.y0)/2,along=h?Math.abs(mx-o.x):Math.abs(mz-o.z),fr=h?Math.abs(mz-o.z):Math.abs(mx-o.x);
    if(fr<vereda+.5&&along<an+V.puerta-E){falla('objeto delante de una puerta',ej);break;}}}
  if(o.tipo==='farol'){const dmin=o.peatonal?1.5:Q.farol.arbol;if(troncos.some(a=>Math.hypot(a.x-o.x,a.z-o.z)<dmin-E))falla(`farol a menos de ${dmin} m de un tronco`,ej);}
  if(o.tipo==='banca'){// 0,9 m libres en una punta: nada (ni tronco ni objeto) en el rectángulo de esa punta
   const ca=Math.cos(o.ang),sa=Math.sin(o.ang),punta=s0=>[...troncos,...EQ.filter(q=>q!==o&&q.tipo!=='cebra')].some(q=>{const dx=q.x-o.x,dz=q.z-o.z,u=dx*ca+dz*sa,v=-dx*sa+dz*ca;return s0*u>o.largo/2&&s0*u<o.largo/2+Q.banca.libre&&Math.abs(v)<o.fondo/2+.3;});
   if(punta(1)&&punta(-1))falla('banca sin 0,9 m libres en ninguna punta',ej);}}
 // objetos encimados (menos las cebras): a ≥ 0,8 m entre sí
 {const ps=EQ.filter(o=>o.tipo!=='cebra');for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const d=Math.hypot(ps[i].x-ps[j].x,ps[i].z-ps[j].z);if(d<.8-E)falla('objetos encimados',{semilla:s,a:ps[i].tipo,b:ps[j].tipo,m:+d.toFixed(2)});}}
 // los cruces de la ciudad: una cebra por brazo; con avenida, un semáforo por brazo
 const cebras=EQ.filter(o=>o.tipo==='cebra'),sem=EQ.filter(o=>o.tipo==='semaforo');
 for(const c of crucesCiudad(m)){const {x0,x1,z0,z1}=c.caja;for(const b of c.brazos){const cx=b==='N'||b==='S'?(x0+x1)/2:b==='W'?x0-Q.cebra.ancho/2:x1+Q.cebra.ancho/2,cz=b==='N'?z0-Q.cebra.ancho/2:b==='S'?z1+Q.cebra.ancho/2:(z0+z1)/2;
   if(!cebras.some(q=>Math.hypot(q.x-cx,q.z-cz)<.5))falla('brazo de un cruce sin paso de cebra',{semilla:s,brazo:b});
   if(c.av&&!sem.some(q=>q.brazo===b&&Math.hypot(q.x-cx,q.z-cz)<12))falla('cruce con avenida sin semáforo en un brazo',{semilla:s,brazo:b});}}
 // la luz: puntos de cada vereda cada 2 m, a ≤ separación·0,6 de un farol (alternados, la luz de enfrente cuenta)
 const fs=EQ.filter(o=>o.tipo==='farol'&&!o.peatonal);
 for(const t of veredasCiudad(m)){const S=t.av?Q.farolAvenida.separacion:Q.farol.separacion;for(let u=1;u<t.L;u+=2){const p=t.en(u,vereda-.5);luz[1]++;if(fs.some(f=>Math.hypot(f.x-p.x,f.z-p.z)<=S*.6))luz[0]++;}}
 for(const g of ejes){const L=Math.hypot(g.b.x-g.a.x,g.b.z-g.a.z),S=g.an>12?Q.farolAvenida.separacion:Q.farol.separacion;for(let u=1;u<L;u+=2){const x=g.a.x+(g.b.x-g.a.x)*u/L,z=g.a.z+(g.b.z-g.a.z)*u/L;luz[1]++;if(fs.some(f=>Math.hypot(f.x-x,f.z-z)<=S*.6))luz[0]++;}}
 // la playa: torres y kioscos sobre la arena; la torre, a 3–9 m del agua; la orilla, a ≤ 150 m de una torre (Cancún)
 {const agua=I.cells.filter(c=>c.zona==='agua'||c.zona==='agua_honda'),aAgua=(x,z)=>Math.min(...agua.map(c=>Math.hypot(Math.max(c.x*CELL-x,0,x-(c.x+1)*CELL),Math.max(c.y*CELL-z,0,z-(c.y+1)*CELL))));
  const torres=EQ.filter(o=>o.tipo==='salvavidas');
  for(const o of EQ.filter(o=>o.tipo==='salvavidas'||o.tipo==='kiosco')){const q=at(o.x,o.z),ej={semilla:s,tipo:o.tipo,x:o.x,z:o.z};if(q?.zona!=='playa')falla(`${o.tipo} fuera de la arena`,{...ej,zona:q?.zona});
   if(o.tipo==='salvavidas'){const w=aAgua(o.x,o.z);if(w<Q.salvavidas.agua[0]-E||w>Q.salvavidas.agua[1]+E)falla('torre de salvavidas lejos o encima del agua',{...ej,m:+w.toFixed(1)});}}
  const n4=(c,f)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>f(cel.get((c.x+dx)+','+(c.y+dy))));
  for(const c of I.cells){if(c.zona!=='playa'||!n4(c,o=>o&&(o.zona==='agua'||o.zona==='agua_honda')))continue;orilla[1]++;if(torres.some(t=>Math.hypot(t.x-(c.x+.5)*CELL,t.z-(c.y+.5)*CELL)<=150))orilla[0]++;}}
 // hidrantes y paradas
 const hs=EQ.filter(o=>o.tipo==='hidrante'),ps=EQ.filter(o=>o.tipo==='parada');
 const edif=[...bp.lots.map(L=>({x:L.rect.x+L.rect.w/2,z:L.rect.y+L.rect.h/2,casa:['vivienda','comercio','casa','residencial'].includes(L.type)})),...I.lots.filter(L=>L.type==='residencial'&&L.parts).map(L=>({x:L.parts[0].x+L.parts[0].w/2,z:L.parts[0].y+L.parts[0].h/2,casa:true})),...I.casas.map(h=>({x:h.x,z:h.z,casa:true}))];
 for(const e of edif){hid[1]++;if(hs.some(h=>Math.hypot(h.x-e.x,h.z-e.z)<=Q.hidrante.edificio))hid[0]++;else falla(`edificio a más de ${Q.hidrante.edificio} m de un hidrante`,{semilla:s,x:+e.x.toFixed(0),z:+e.z.toFixed(0)});
  if(e.casa){par[1]++;if(ps.some(p=>Math.hypot(p.x-e.x,p.z-e.z)<=Q.parada.radio))par[0]++;else falla(`vivienda a más de ${Q.parada.radio} m de una parada`,{semilla:s,x:+e.x.toFixed(0),z:+e.z.toFixed(0)});}}
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)if(Math.hypot(ps[i].x-ps[j].x,ps[i].z-ps[j].z)<Q.parada.separacion-E)falla('paradas demasiado juntas',{semilla:s});}
const pc=([a,b])=>b?(100*a/b).toFixed(1)+' %':'—';
console.log(`${N} mundos · ${Object.entries(tot).map(([k,v])=>k+' '+v).join(' · ')}`);
console.log(`cobertura · veredas iluminadas ${pc(luz)} · edificios a ≤ ${Q.hidrante.edificio} m de un hidrante ${pc(hid)} · viviendas a ≤ ${Q.parada.radio} m de una parada ${pc(par)} · orilla a ≤ 150 m de una torre de salvavidas ${pc(orilla)}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

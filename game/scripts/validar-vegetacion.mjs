// Valida la vegetación y la playa con matemática, sin el 3D (2026-10-15, vegetacion.js): dónde va cada árbol, palmera y
// sombrilla (medidas.js VEGETACION) y mide la regla 3-30-300 (Konijnendijk 2023): cada vivienda ve ≥ 3 árboles (acá: a
// menos de 30 m), 30 % de copa por zona y ≤ 300 m a un espacio verde.
// Uso: node scripts/validar-vegetacion.mjs [ciudades=12] [semilla0=1] [jugadores=3]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {VEGETACION as V,CALLE} from '../src/engine/medidas.js';
import City from '../src/engine/ciudad.js';
import {islaDe,mascaraRebaje} from '../src/engine/isla.js';

const N=+(process.argv[2]||12),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3),E=1e-6,K=City.K;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const podas={},diversidad={},tot={arboles:0,palmeras:0,sombrillas:0},porTipo={},vista=[0,0],verde=[0,0],copa={ciudad:[0,0],monte:[0,0]};
if(CALLE.vereda-V.alcorque<CALLE.paso-E)falla('el alcorque no deja el paso libre de la vereda',{vereda:CALLE.vereda,alcorque:V.alcorque,paso:CALLE.paso});
const segDist=(px,pz,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/L2));return Math.hypot(px-a.x-t*dx,pz-a.z-t*dz);};
const armonia={disp:[],claros:[],telas:[],pisos:[],parques:[],alineadas:[]};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),m=bp.map,I=bp.isla,Vg=bp.vegetacion,{W,H}=m,Wm=W*CELL,Hm=H*CELL;
 const cel=new Map(I.cells.map(c=>[c.x+','+c.y,c])),at=(x,z)=>cel.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const kind=(x,z)=>{const cx=Math.floor(x/CELL),cy=Math.floor(z/CELL);return cx<0||cy<0||cx>=W||cy>=H?null:m.kind[cy*W+cx];};
 const enCiudad=(x,z)=>x>=0&&z>=0&&x<Wm&&z<Hm,calle=k=>k===K.street||k===K.avenue;
 // (las de plazas y patios: en su casilla)
 const enCiudadK=a=>{const k=kind(a.x,a.z);if(a.tipo==='plaza'&&k!==K.plaza||a.tipo==='patio'&&k!==K.courtyard)falla('árbol de plaza o patio fuera de su lugar',{semilla:s,tipo:a.tipo});return true;};
 const rects=[...bp.lots.flatMap(L=>L.parts||[]),...I.lots.filter(L=>L.parts).flatMap(L=>L.parts),...I.casas.map(h=>{const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;return {x:h.x-w/2,y:h.z-d/2,w,h:d};})];
 const dentroDe=(x,z)=>rects.some(r=>x>r.x+E&&x<r.x+r.w-E&&z>r.y+E&&z<r.y+r.h-E);
 const segs=I.carreteras.filter(c=>c.tipo==='grilla'&&c.puntos).flatMap(c=>c.puntos.slice(1).map((b,i)=>({a:c.puntos[i],b,an:c.ancho||12})));
 const puertas=bp.lots.flatMap(L=>(L.levels?.[0]?.doors||[]).filter(d=>d.street));
 const vidrieras=bp.lots.flatMap(L=>(L.levels?.[0]?.windows||[]).filter(w=>w.shop));
 // ninguna copa dentro de un edificio ni a menos de V.poda.holgura (su borde, en 24 puntos)
 {const H=V.poda.holgura-.02,R2=[...rects.map(r=>[r.x,r.y,r.x+r.w,r.y+r.h])];
  for(const a of Vg.arboles){const c=a.ra?Math.cos(a.eje):1,sn=a.ra?Math.sin(a.eje):0,rb=a.ra||a.r;
   for(let i=0;i<24;i++){const t=i/24*Math.PI*2,u=a.r*Math.cos(t),v=rb*Math.sin(t),x=a.x+u*c-v*sn,z=a.z+u*sn+v*c;
    if(R2.some(r=>Math.hypot(Math.max(r[0]-x,0,x-r[2]),Math.max(r[1]-z,0,z-r[3]))<H)){falla('copa que se mete en un edificio (o a menos de su holgura)',{semilla:s,tipo:a.tipo,x:a.x,z:a.z});break;}}}
  for(const [k,v] of Object.entries(Vg.podados||{}))podas[k]=(podas[k]||0)+v;}
 tot.arboles+=Vg.arboles.length;tot.palmeras+=Vg.palmeras.length;tot.sombrillas+=Vg.sombrillas.length;
 // la armonía: el bosque en manchones (dispersión por cuadrantes llenos de monte, y la parte de claros) y las telas
 {const AR=V.armonia,Q=AR.cuadrante,n6=Q/CELL,ok=new Set(I.cells.filter(c=>!c.lote&&!c.carretera&&!c.parque&&!c.borde&&c.zona==='montaña').map(c=>c.x+','+c.y)),cnt=new Map();
  for(const a of Vg.arboles)if(a.tipo==='bosque'){const k=Math.floor(a.x/Q)+','+Math.floor(a.z/Q);cnt.set(k,(cnt.get(k)||0)+1);}
  const cu=new Set([...ok].map(k=>{const [x,y]=k.split(',').map(Number);return Math.floor(x/n6)+','+Math.floor(y/n6);})),n=[];
  for(const k of cu){const [i,j]=k.split(',').map(Number);let c=0;for(let a=0;a<n6;a++)for(let b=0;b<n6;b++)if(ok.has((i*n6+a)+','+(j*n6+b)))c++;if(c>=.8*n6*n6)n.push(cnt.get(k)||0);}
  if(n.length>=10){const mm=n.reduce((x,y)=>x+y,0)/n.length,vv=n.reduce((x,y)=>x+(y-mm)**2,0)/n.length,d=vv/mm,cl=n.filter(x=>x===0).length/n.length;armonia.disp.push(d);armonia.claros.push(cl);
   if(d<AR.dispersion)falla('bosque sin manchones (parece una plantación)',{semilla:s,dispersion:+d.toFixed(2)});if(cl<AR.claros[0]||cl>AR.claros[1])falla('bosque con claros fuera de rango',{semilla:s,claros:+cl.toFixed(2)});}
  const S=Vg.sombrillas;let dif=0,par=0;for(let i=0;i<S.length;i++)for(let j=i+1;j<S.length;j++)if(Math.hypot(S[i].x-S[j].x,S[i].z-S[j].z)<=AR.vecinas){par++;if(S[i].tela!==S[j].tela)dif++;}
  {let pp=0,al=0;for(let i=0;i<S.length;i++)for(let j=i+1;j<S.length;j++)if(Math.hypot(S[i].x-S[j].x,S[i].z-S[j].z)<=6){pp++;if(Math.abs(S[i].x-S[j].x)<.2||Math.abs(S[i].z-S[j].z)<.2)al++;}
   if(pp){armonia.alineadas.push(al/pp);if(al/pp>AR.alineadas)falla('sombrillas en filas (demasiado alineadas)',{semilla:s,alineadas:+(al/pp).toFixed(2)});}}
  if(par){armonia.telas.push(dif/par);if(dif/par>AR.telas)falla('sombrillas vecinas de telas distintas (confeti)',{semilla:s,parte:+(dif/par).toFixed(2)});}
  for(const u of S)if(!V.sombrilla.telas.includes(u.tela))falla('sombrilla sin tela del catálogo',{semilla:s});}
 // los parques: arboledas y prado abierto (V.armonia.parque), en todos los parques del mundo juntos
 {const AP=V.armonia.parque,P=Vg.arboles.filter(a=>a.tipo==='parque'),cs=bp.isla.cells.filter(c=>c.parque);
  if(P.length>=6){// arboledas: componentes de árboles a ≤ grupo m; en arboleda, los de componentes de ≥ 3
   const comp=new Array(P.length).fill(-1);let nc=0;for(let i=0;i<P.length;i++){if(comp[i]>=0)continue;const pila=[i];comp[i]=nc;while(pila.length){const a=pila.pop();for(let j=0;j<P.length;j++)if(comp[j]<0&&Math.hypot(P[a].x-P[j].x,P[a].z-P[j].z)<=AP.grupo*V.parque.arboledas.radio){comp[j]=nc;pila.push(j);}}nc++;}
   const tam=new Map();for(const c of comp)tam.set(c,(tam.get(c)||0)+1);const enArb=comp.filter(c=>tam.get(c)>=3).length/P.length;
   let ab=0,tot=0;for(const c of cs)for(let a=0;a<3;a++)for(let b=0;b<3;b++){const x=(c.x+(a+.5)/3)*CELL,z=(c.y+(b+.5)/3)*CELL;tot++;if(!P.some(t=>Math.hypot(t.x-x,t.z-z)<t.r))ab++;}
   armonia.parques.push([enArb,ab/tot]);if(enArb<AP.arboleda)falla('parques sin arboledas (árboles sueltos)',{semilla:s,enArboleda:+enArb.toFixed(2)});
   if(ab/tot<AP.prado[0]||ab/tot>AP.prado[1])falla('parques con el prado abierto fuera de rango',{semilla:s,prado:+(ab/tot).toFixed(2)});}}
 // los pisos del bosque: la especie de cada árbol, la de la banda de su altura relativa (sin el borroso: ≥ 80 %), y las
 // bandas en orden (la altura media de cada una, subiendo)
 {const PB=V.bosque.pisos,T=islaDe(bp.map);T.setMascara(mascaraRebaje(bp.isla.huella||[]));const bos=Vg.arboles.filter(a=>a.tipo==='bosque'),hs=bos.map(a=>T.height(a.x,a.z)),h0=Math.min(...hs),h1=Math.max(...hs);
  let bien=0;const med=PB.bandas.map(()=>[]);bos.forEach((a,i)=>{const t=(hs[i]-h0)/Math.max(1e-6,h1-h0),b=PB.bandas.findIndex(b=>t<=b.hasta);if(PB.bandas[b].especies.includes(a.especie))bien++;if(a.piso!=null)med[a.piso].push(t);});
  const f=bien/(bos.length||1);armonia.pisos.push(f);if(f<.8)falla('bosque sin pisos: las especies no siguen la altura',{semilla:s,enSuPiso:+f.toFixed(2)});
  const m=med.map(a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null).filter(v=>v!=null);for(let i=1;i<m.length;i++)if(m[i]<=m[i-1])falla('pisos del bosque fuera de orden',{semilla:s,medias:m.map(v=>+v.toFixed(2))});}
 for(const a of Vg.arboles){porTipo[a.tipo]=(porTipo[a.tipo]||0)+1;const ej={semilla:s,tipo:a.tipo,x:a.x,z:a.z};
  if(dentroDe(a.x,a.z))falla('árbol dentro de un edificio o una casa',ej);
  if(enCiudadK(a)&&(a.tipo==='plaza'||a.tipo==='patio'))continue;
  const q=at(a.x,a.z);if(q&&(q.escalinata||q.mirador))falla('árbol en la escalinata o el mirador',ej);
  if(enCiudad(a.x,a.z)){const k=kind(a.x,a.z);if(!calle(k)){falla('árbol de la ciudad fuera de la vereda',{...ej,casilla:k});continue;}
   // en la vereda: a ≤ vereda del borde de la casilla que da a un lote (algún lado)
   const cx=Math.floor(a.x/CELL),cy=Math.floor(a.z/CELL),dd=[[a.z-cy*CELL,0,-1],[(cy+1)*CELL-a.z,0,1],[a.x-cx*CELL,-1,0],[(cx+1)*CELL-a.x,1,0]];
   if(!dd.some(([d,dx,dy])=>d<=CALLE.vereda+E&&!calle(kind(a.x+dx*CELL,a.z+dy*CELL))))falla('árbol de la ciudad sobre la calzada',ej);
   for(const d of puertas){const h=Math.abs(d.y1-d.y0)<E,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,an=Math.hypot(d.x1-d.x0,d.y1-d.y0)/2,along=h?Math.abs(mx-a.x):Math.abs(mz-a.z),fr=h?Math.abs(mz-a.z):Math.abs(mx-a.x);
    if(fr<CALLE.vereda+.5&&along<an+V.puerta-E){falla('árbol delante de una puerta',ej);break;}}
   // (2026-10-18, FACHADAS.md B4) ningún tronco de calle frente al vidrio de una vidriera de planta baja
   if(a.tipo==='calle'||a.tipo==='avenida')for(const w of vidrieras){const h=Math.abs(w.y1-w.y0)<E,mx=(w.x0+w.x1)/2,mz=(w.y0+w.y1)/2,an=Math.hypot(w.x1-w.x0,w.y1-w.y0)/2,along=h?Math.abs(mx-a.x):Math.abs(mz-a.z),fr=h?Math.abs(mz-a.z):Math.abs(mx-a.x);
    if(fr<CALLE.vereda+.5&&along<an-V.vidriera-E){falla('árbol delante de una vidriera',ej);break;}}}
  else{// afuera: el tronco nunca en la calzada; los de calle, en la vereda
   for(const g of segs){const d=segDist(a.x,a.z,g.a,g.b),calzada=g.an-2*CALLE.vereda;if(d<calzada/2-E){falla('árbol del monte sobre la calzada',ej);break;}if(a.tipo!=='calle'&&d<g.an/2-E){falla('árbol del monte en la vereda sin ser de calle',ej);break;}}
   if(q?.lote&&!q.parque&&a.tipo!=='calle'&&a.tipo!=='jardin')falla('árbol en un lote',ej);}}
 // separación de los árboles de calle entre sí (los de una misma vereda)
 {const cs=Vg.arboles.filter(a=>a.tipo==='calle'||a.tipo==='avenida');for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){const d=Math.hypot(cs[i].x-cs[j].x,cs[i].z-cs[j].z);if(d<.75*V.calle.espaciado-E&&(Math.abs(cs[i].x-cs[j].x)<E||Math.abs(cs[i].z-cs[j].z)<E))falla('árboles de calle demasiado juntos',{semilla:s,m:+d.toFixed(2)});}}
 // la playa
 const agua=I.cells.filter(c=>c.zona==='agua'||c.zona==='agua_honda');
 const aAgua=(x,z)=>Math.min(...agua.map(c=>Math.hypot(Math.max(c.x*CELL-x,0,x-(c.x+1)*CELL),Math.max(c.y*CELL-z,0,z-(c.y+1)*CELL))));
 // la arena por el terreno (el que dibuja el 3D): ni en el vacío ni en una loma (V.arena)
 const T=islaDe(bp.map);T.setMascara(mascaraRebaje(bp.isla.huella||[]));
 const terreno=(u,que)=>{const h=T.height(u.x,u.z);if(T.beyond(u.x,u.z)>-V.arena.borde+E)falla(que+' al borde o fuera de la isla',{semilla:s,x:u.x,z:u.z});else if(h<V.arena.alto[0]-E||h>V.arena.alto[1]+E)falla(que+' en un terreno que no es playa',{semilla:s,x:u.x,z:u.z,h:+h.toFixed(2)});};
 for(const p of Vg.palmeras){const q=at(p.x,p.z);if(q?.zona!=='playa')falla('palmera fuera de la arena',{semilla:s,zona:q?.zona});}
 for(const p of Vg.palmeras)terreno(p,'palmera');for(const u of Vg.sombrillas)terreno(u,'sombrilla');
 for(const u of Vg.sombrillas){const q=at(u.x,u.z),ej={semilla:s,x:u.x,z:u.z};if(q?.zona!=='playa')falla('sombrilla fuera de la arena',{...ej,zona:q?.zona});
  if(aAgua(u.x,u.z)<V.sombrilla.agua+u.r-E)falla('sombrilla en la franja libre junto al agua',{...ej,m:+aAgua(u.x,u.z).toFixed(2)});}
 for(let i=0;i<Vg.sombrillas.length;i++)for(let j=i+1;j<Vg.sombrillas.length;j++){const a=Vg.sombrillas[i],b=Vg.sombrillas[j],d=Math.hypot(a.x-b.x,a.z-b.z);if(d<V.sombrilla.espaciado-E)falla('sombrillas a menos de su espaciado',{semilla:s,m:+d.toFixed(2)});}
 // ---- la regla 10-20-30 (Santamour): en el arbolado de la ciudad —todo menos el bosque—, especie ≤ 10 %, género ≤ 20 %,
 // familia ≤ 30 %; cada calle, una sola especie; cada árbol con especie del catálogo y apta para su lugar ----
 {const ES=new Map(V.especies.map(e=>[e.id,e])),urb=Vg.arboles.filter(a=>a.tipo!=='bosque'),T=urb.length,c={especie:new Map(),genero:new Map(),familia:new Map()};
  for(const a of [...Vg.arboles,...Vg.palmeras]){const e=ES.get(a.especie);if(!e){falla('árbol sin especie del catálogo',{semilla:s,tipo:a.tipo});continue;}
   const u=a.tipo==='paseo'||a.tipo==='grupo'?'palmera':a.tipo==='plaza'||a.tipo==='patio'?'parque':a.tipo;if(!e.usos.includes(u))falla('especie fuera de su uso',{semilla:s,especie:e.id,tipo:a.tipo});
   if(a.color!==(e.flor||e.follaje))falla('color distinto del de su especie',{semilla:s,especie:e.id});}
  for(const a of urb){const e=ES.get(a.especie);if(!e)continue;for(const [k,v] of [['especie',e.id],['genero',e.genero],['familia',e.familia]])c[k].set(v,(c[k].get(v)||0)+1);}
  for(const k of ['especie','genero','familia'])for(const [v,n] of c[k]){diversidad[k]=Math.max(diversidad[k]||0,n/T);if(n/T>V.diversidad[k]+E)falla(`${k} por encima del ${100*V.diversidad[k]} % (10-20-30)`,{semilla:s,[k]:v,pct:+(100*n/T).toFixed(1)});}}
 // ---- 3-30-300 ----
 const R=V.regla3_30_300,arb=[...Vg.arboles,...Vg.palmeras];
 const hogares=[...bp.lots.filter(L=>['vivienda','comercio','casa','residencial'].includes(L.type)).map(L=>({x:L.rect.x+L.rect.w/2,z:L.rect.y+L.rect.h/2})),...I.lots.filter(L=>L.type==='residencial'&&L.parts).map(L=>({x:L.parts[0].x+L.parts[0].w/2,z:L.parts[0].y+L.parts[0].h/2})),...I.casas.map(h=>({x:h.x,z:h.z}))];
 const verdes=[...I.cells.filter(c=>c.parque||c.borde||c.mirador).map(c=>({x:(c.x+.5)*CELL,z:(c.y+.5)*CELL}))];for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(m.kind[y*W+x]===K.plaza)verdes.push({x:(x+.5)*CELL,z:(y+.5)*CELL});
 for(const h of hogares){vista[1]++;if(arb.filter(a=>Math.hypot(a.x-h.x,a.z-h.z)<=R.radioVista).length>=R.vista)vista[0]++;verde[1]++;if(verdes.some(g=>Math.hypot(g.x-h.x,g.z-h.z)<=R.verde))verde[0]++;}
 // la copa: en una grilla de 2 m, sobre la ciudad y sobre el monte urbanizado (lotes, calles, parques, borde)
 // (la copa podada en óvalo: a.r a lo largo de a.eje, a.ra de ancho)
 const dentroCopa=(a,x,z)=>{if(!a.ra)return Math.hypot(a.x-x,a.z-z)<=a.r;const c=Math.cos(a.eje),sn=Math.sin(a.eje),u=(x-a.x)*c+(z-a.z)*sn,v=-(x-a.x)*sn+(z-a.z)*c;return (u/a.r)**2+(v/a.ra)**2<=1;};
 const enCopa=(x,z)=>arb.some(a=>dentroCopa(a,x,z));
 for(let z=1;z<Hm;z+=2)for(let x=1;x<Wm;x+=2){copa.ciudad[1]++;if(enCopa(x,z))copa.ciudad[0]++;}
 for(const c of I.cells){if(!(c.lote||c.carretera||c.parque||c.borde))continue;for(let dz=1;dz<CELL;dz+=2)for(let dx=1;dx<CELL;dx+=2){copa.monte[1]++;if(enCopa(c.x*CELL+dx,c.y*CELL+dz))copa.monte[0]++;}}}
const pc=([a,b])=>b?Math.round(100*a/b)+' %':'—';
console.log(`armonía · bosque: dispersión ${armonia.disp.map(x=>x.toFixed(1)).join('/')} (≥ ${V.armonia.dispersion}), claros ${armonia.claros.map(x=>Math.round(100*x)+'%').join('/')} · sombrillas vecinas de otra tela ${armonia.telas.map(x=>Math.round(100*x)+'%').join('/')}, alineadas ${armonia.alineadas.map(x=>Math.round(100*x)+'%').join('/')} · bosque en su piso ${armonia.pisos.map(x=>Math.round(100*x)+'%').join('/')} · parques: en arboleda/prado ${armonia.parques.map(([a,b])=>Math.round(100*a)+'/'+Math.round(100*b)+'%').join(' ')}`);
console.log(`${N} mundos · árboles ${tot.arboles} (${Object.entries(porTipo).map(([k,v])=>k+' '+v).join(', ')}) · palmeras ${tot.palmeras} · sombrillas ${tot.sombrillas}`);
console.log(`3-30-300 · viviendas que ven ≥ ${V.regla3_30_300.vista} árboles a ${V.regla3_30_300.radioVista} m: ${pc(vista)} · copa: ciudad ${pc(copa.ciudad)}, monte urbanizado ${pc(copa.monte)} (meta ${100*V.regla3_30_300.cobertura} %) · verde a ≤ ${V.regla3_30_300.verde} m: ${pc(verde)}`);
console.log(`10-20-30 · lo más alto: especie ${(100*(diversidad.especie||0)).toFixed(1)} % · género ${(100*(diversidad.genero||0)).toFixed(1)} % · familia ${(100*(diversidad.familia||0)).toFixed(1)} %`);
console.log(`poda · árboles que no cabían ni chicos (no se plantan): ${Object.entries(podas).map(([k,v])=>k+' '+v).join(', ')||'ninguno'}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

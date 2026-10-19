// Valida «dónde estoy» y «sobre dónde cae quien suelta el dron» (2026-10-16, Miguel: «que me diga en qué calle y en
// qué carrera estoy mientras camino o sobrevuelo», «que caiga de la altura donde esté»):
// La ubicación (direcciones.js ubicacionDe):
//  · cada casilla abierta de la ciudad (calle, avenida, callejón, plaza) tiene una;
//  · en una casilla de una calle o carrera con nombre, la ubicación la nombra (y en el cruce de dos, las dos);
//  · frente a cada puerta de calle (a 1,5 m), la ubicación dice la vía, la cruzada y los metros de su placa (±3,5 m);
//  · a lo largo de cada vía, el número (cruzada y metros) crece;
//  · sobre las vías rectas del monte, la ubicación las nombra.
// El aterrizaje (aterrizaje.js aterrizajeDe), en una grilla de columnas sobre toda la isla y el mar de alrededor:
//  · siempre hay dónde caer, en un punto donde se camina y desde donde se llega a pie a la calle, fuera de todo
//    edificio y casa, y a ATERRIZAJE.fachada de las fachadas (los balcones salen de ellas);
//  · si la columna ya sirve, se cae ahí mismo; si no, en el punto que sirve más cercano (comprobado a fuerza bruta).
// Uso: node scripts/validar-ubicacion.mjs [ciudades=4] [semilla0=1] [--ver]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {ubicacionDe} from '../src/engine/direcciones.js';
import {zonaDeAterrizaje,aterrizajeDe} from '../src/engine/aterrizaje.js';
import {cuerpoCasa} from '../src/engine/circulacion.js';
import {CELL} from '../src/engine/veredas.js';
import {ATERRIZAJE} from '../src/engine/medidas.js';
import City from '../src/engine/ciudad.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),VER=process.argv.includes('--ver'),K=City.K;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const ABIERTA=new Set([K.street,K.avenue,K.alley,K.plaza,K.kiosk]);
const num=c=>{const m=/^(\d+)([A-H]?)$/.exec(c||'');return m?+m[1]+(m[2]?(m[2].charCodeAt(0)-64)/10:0):NaN;};
const med={casillas:0,tipos:{},puertas:0,bis:0,monte:0,columnas:0,tierra:0,enSitio:0,corridos:[],mar:[],ejemplos:[]};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),m=bp.map,V=bp.vias,{W,H}=m,n=m.names;
 const viaDeLinea=id=>{const l=n.lines[id];return V[l.axis].find(v=>v.ciudad&&v.nombre===l.name);};
 // las casillas abiertas, y el orden a lo largo de cada línea
 const porLinea=new Map();
 for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){const k=cy*W+cx;if(!ABIERTA.has(m.kind[k]))continue;const x=(cx+.5)*CELL,z=(cy+.5)*CELL,u=ubicacionDe(V,x,z),ej={semilla:s,x,z};med.casillas++;
  if(!u){falla('casilla de la ciudad sin ubicación',ej);continue;}med.tipos[u.tipo]=(med.tipos[u.tipo]||0)+1;if(VER&&med.ejemplos.length<8&&(cx+cy)%37===0)med.ejemplos.push(`${u.titulo} · ${u.detalle}`);
  const h=n.hLine[k],v=n.vLine[k],vh=h>=0?viaDeLinea(h):null,vv=v>=0?viaDeLinea(v):null;
  if(vh&&u.calle!==vh.corto)falla('la ubicación no nombra la calle de la casilla',{...ej,calle:vh.corto,dice:u.titulo});
  if(vv&&u.carrera!==vv.corto)falla('la ubicación no nombra la carrera de la casilla',{...ej,carrera:vv.corto,dice:u.titulo});
  if(vh&&vv&&u.tipo!=='cruce')falla('un cruce que no se dice como cruce',{...ej,dice:u.titulo});
  for(const [id,e,vi] of [[h,'h',vh],[v,'v',vv]])if(vi&&!(vh&&vv)&&u.tipo==='via'){(porLinea.get(vi.corto)||porLinea.set(vi.corto,[]).get(vi.corto)).push({along:e==='h'?x:z,orden:num(u.cruce)*1000+u.metros,texto:u.detalle});}}
 for(const [via,g] of porLinea){g.sort((a,b)=>a.along-b.along);for(let i=1;i<g.length;i++)if(g[i].orden<g[i-1].orden){falla('el número no crece a lo largo de la vía',{semilla:s,via,a:g[i-1].texto,b:g[i].texto});break;}}
 // frente a las puertas de calle: lo de la placa
 // (desde 1,5 m frente a la puerta hacia afuera, hasta 15 m —las casas del monte quedan retiradas de su vía, tras el
 // porche y el jardín—: el primer punto sobre la vía de la placa)
 const frente=(dir,x,z,nx,nz,que)=>{if(!dir)return;if(/Bis/.test(dir.via)){med.bis++;return;}med.puertas++;let u=null,px,pz,visto=null;
  for(let d=1.5;d<=15;d+=.5){px=x+nx*d;pz=z+nz*d;const w=ubicacionDe(V,px,pz);if(w&&w.tipo!=='cerca')visto??=w;if(w&&w.tipo!=='cerca'&&(w.calle===dir.via||w.carrera===dir.via)){u=w;break;}}
  const ej={semilla:s,que,placa:dir.texto,x:+px.toFixed(1),z:+pz.toFixed(1)};
  if(!u){falla(visto?'la ubicación frente a la puerta no es la vía de su placa':'frente a la puerta no se está sobre la vía de su placa',{...ej,dice:visto?.titulo});return;}
  if(u.tipo==='via'&&(u.cruce!==dir.cruce||Math.abs(u.metros-dir.metros)>3.5))falla('el número frente a la puerta no es el de su placa',{...ej,dice:u.detalle});};
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)]){const lv=L.levels?.find(l=>l.level===0);if(!lv)continue;const dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
  for(const d of lv.doors||[]){if(!d.street)continue;const hz=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,nx=hz?0:(dentro(mx+.3,mz)?-1:1),nz=hz?(dentro(mx,mz+.3)?-1:1):0;frente(d.direccion,mx,mz,nx,nz,L.type);}}
 for(const h of bp.isla.casas||[]){const c=cuerpoCasa(h);frente(h.direccion,c.puerta.x,c.puerta.z,c.afuera.x,c.afuera.z,'casa');}
 // las vías rectas del monte
 for(const e of ['h','v'])for(const v of V[e].filter(v=>v.monte))for(let a=v.desde;a<=v.hasta;a+=4){const x=e==='h'?a:v.coord,z=e==='h'?v.coord:a,u=ubicacionDe(V,x,z);med.monte++;
  if(!u||u.tipo==='cerca'||(e==='h'?u.calle:u.carrera)!==v.corto)falla('punto de una vía del monte que no la nombra',{semilla:s,via:v.corto,x:+x.toFixed(1),z:+z.toFixed(1),dice:u?.titulo});}
 // el aterrizaje
 const Z=zonaDeAterrizaje(bp),g=Z.g,b=bp.isla.bounds,M=60,paso=6;
 const partes=[...bp.lots.flatMap(L=>L.parts),...(bp.isla.lots||[]).flatMap(L=>L.parts||[])].map(p=>({x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h})),cuerpos=(bp.isla.casas||[]).map(cuerpoCasa);
 const adentro=(x,z)=>partes.some(p=>x>p.x0&&x<p.x1&&z>p.z0&&z<p.z1)||cuerpos.some(c=>x>c.x0&&x<c.x1&&z>c.z0&&z<c.z1);let k=0;
 for(let z=b.y0*CELL-M;z<=(b.y1+1)*CELL+M;z+=paso)for(let x=b.x0*CELL-M;x<=(b.x1+1)*CELL+M;x+=paso){med.columnas++;const L=aterrizajeDe(Z,x,z),ej={semilla:s,x,z},k0=g.idx(x,z),tierra=k0>=0&&(g.libre[k0]||adentro(x,z));if(tierra)med.tierra++;
  if(!L){falla('sin dónde aterrizar',ej);continue;}const kL=g.idx(L.x,L.z);
  if(!Z.ok(kL))falla('aterriza donde no se camina o no se llega a la calle',{...ej,cae:[L.x,L.z]});
  if(adentro(L.x,L.z))falla('aterriza adentro de un edificio o una casa',{...ej,cae:[L.x,L.z]});
  {const F=ATERRIZAJE.fachada-g.celda/2-1e-6,dF=Math.min(...partes.map(p=>Math.hypot(Math.max(p.x0-L.x,0,L.x-p.x1),Math.max(p.z0-L.z,0,L.z-p.z1))));if(dF<F)falla('aterriza pegado a una fachada (sus balcones)',{...ej,cae:[L.x,L.z],m:+dF.toFixed(2)});med.fachada=Math.min(med.fachada??9,dF);}
  if(Z.ok(k0)){if(L.corrido>0)falla('se corre aunque la columna sirve',ej);med.enSitio++;continue;}(tierra?med.corridos:med.mar).push(L.corrido);
  // (a fuerza bruta, una de cada 7: ningún punto que sirve más cerca)
  if(k++%7||L.corrido>ATERRIZAJE.busca)continue;const R=Math.ceil(L.corrido/g.celda)+1,ci=Math.floor((x-g.X0)/g.celda),cj=Math.floor((z-g.Z0)/g.celda);let mejor=Infinity;
  for(let j=cj-R;j<=cj+R;j++)for(let i=ci-R;i<=ci+R;i++){if(i<0||j<0||i>=g.nx||j>=g.nz)continue;const q=j*g.nx+i;if(!Z.ok(q))continue;mejor=Math.min(mejor,Math.hypot(g.X0+(i+.5)*g.celda-x,g.Z0+(j+.5)*g.celda-z));}
  if(mejor<L.corrido-.01)falla('aterriza lejos habiendo un punto que sirve más cerca',{...ej,corrido:L.corrido,habia:+mejor.toFixed(2)});}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
console.log(`ubicación · ${med.casillas} casillas de la ciudad (${Object.entries(med.tipos).map(([k,v])=>k+' '+v).join(', ')}) · ${med.puertas} puertas con la ubicación de su placa (${med.bis} en callejón, sin revisar) · ${med.monte} puntos de vías del monte`);
console.log(`aterrizaje · ${med.columnas} columnas, ${med.tierra} sobre la isla · sobre la isla cae en el sitio ${(100*med.enSitio/med.tierra).toFixed(1)} %, si no se corre: mediana ${q(med.corridos,.5).toFixed(1)} m, p90 ${q(med.corridos,.9).toFixed(1)} m, máx ${q(med.corridos,1).toFixed(1)} m · sobre el mar o el vacío, a la orilla: mediana ${q(med.mar,.5).toFixed(1)} m · lo más cerca de una fachada: ${med.fachada.toFixed(2)} m`);
if(VER)console.log(med.ejemplos.map(e=>'  '+e).join('\n'));
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

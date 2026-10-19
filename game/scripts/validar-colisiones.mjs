// Valida las colisiones del mundo calibradas en el 2D (2026-10-16, src/engine/colisiones.js y COLISION de medidas.js):
//  · todo lo que dibuja el 3D tiene su regla de colisión (o dice por qué no choca);
//  · nada que choque se encima con otra cosa que choca;
//  · el paso libre: en cada sección de vereda (cada 0,5 m, de la fachada al cordón —en el monte, del borde a la calzada—)
//    queda un tramo continuo sin choques de al menos CALLE.paso;
//  · todo sigue alcanzándose a pie: las puertas de calle que se alcanzan sin colisiones se alcanzan con ellas.
// Uso: node --max-old-space-size=8192 scripts/validar-colisiones.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {CALLE,CIRCULACION} from '../src/engine/medidas.js';
import {colisiones,indiceColisiones,distForma} from '../src/engine/colisiones.js';
import {veredasCiudad,ejesMonte} from '../src/engine/veredas.js';
import {grillaPeatonal,caminar,cuerpoCasa} from '../src/engine/circulacion.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),R=CIRCULACION.peaton.radio;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const med={objetos:0,formas:0,porClave:{},sin:{},secciones:0,anchos:[],puertas:[0,0]};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),{lista,sin}=colisiones(bp),I=indiceColisiones(lista);
 Object.assign(med.sin,sin);for(const [k,v] of Object.entries(sin))if(v==='sin entrada en COLISION')falla('objeto sin regla de colisión',{semilla:s,clave:k});
 med.objetos+=lista.length;for(const c of lista){med.formas+=c.formas.length;med.porClave[c.clave]=(med.porClave[c.clave]||0)+1;}
 // encimados: una forma que se mete en otra (de otro objeto) —el centro de un círculo a menos de su radio, el de una caja adentro—
 for(const c of lista)for(const f of c.formas)for(const [g,d] of I.cerca(f.x,f.z)){if(d===c||d.id<c.id)continue;
  const sol=f.r!=null?distForma(g,f.x,f.z)<f.r-.01:g.r!=null?distForma(f,g.x,g.z)<g.r-.01:distForma(g,f.x,f.z)<0;if(sol){falla(`se enciman: ${c.clave} con ${d.clave}`,{semilla:s,a:c.id,b:d.id,x:+f.x.toFixed(2),z:+f.z.toFixed(2)});break;}}
 // el paso libre: el tramo continuo más largo sin choques en la sección
 const seccion=pts=>{let best=0,run=0,prev=null;for(const [x,z] of pts){if(I.choca(x,z,0)){run=0;}else{run+=prev?Math.hypot(x-prev[0],z-prev[1]):0;best=Math.max(best,run);}prev=[x,z];}return best;};
 const paso=CALLE.paso-.05;
 for(const t of veredasCiudad(bp.map))for(let u=.25;u<t.L;u+=.5){const pts=[];for(let d=0;d<=CALLE.vereda+1e-9;d+=.05){const p=t.en(u,d);pts.push([p.x,p.z]);}
  const w=seccion(pts);med.secciones++;med.anchos.push(w);if(w<paso)falla('vereda de la ciudad con el paso libre angosto',{semilla:s,x:+pts[0][0].toFixed(1),z:+pts[0][1].toFixed(1),libre:+w.toFixed(2)});}
 // (en un cruce, la sección de una calle atraviesa la otra: ahí no es vereda de esta, y se salta)
 const EJ=ejesMonte(bp.isla),dirDe=g=>{const L=Math.hypot(g.b.x-g.a.x,g.b.z-g.a.z)||1;return [(g.b.x-g.a.x)/L,(g.b.z-g.a.z)/L];},segD=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2));return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);};
 const enCruce=(g,x,z)=>{const [ux,uz]=dirDe(g);return EJ.some(h=>{if(h===g)return false;const [vx,vz]=dirDe(h);return Math.abs(ux*vx+uz*vz)<.9&&segD(x,z,h.a,h.b)<h.an/2+.3;});};
 for(const g of EJ){const L=Math.hypot(g.b.x-g.a.x,g.b.z-g.a.z);if(L<8)continue;const ux=(g.b.x-g.a.x)/L,uz=(g.b.z-g.a.z)/L;
  for(let u=3;u<L-3;u+=.5)for(const sg of [1,-1]){const pts=[];for(let d=g.an/2;d>=g.an/2-CALLE.vereda-1e-9;d-=.05)pts.push([g.a.x+ux*u-uz*d*sg,g.a.z+uz*u+ux*d*sg]);if(pts.some(([x,z])=>enCruce(g,x,z)))continue;
   const w=seccion(pts);med.secciones++;med.anchos.push(w);if(w<paso)falla('vereda del monte con el paso libre angosto',{semilla:s,x:+pts[0][0].toFixed(1),z:+pts[0][1].toFixed(1),libre:+w.toFixed(2)});}}
 // a pie: las puertas, sin y con colisiones
 const gp=grillaPeatonal(bp),{W}=bp.map;let s0=0;for(let i=0;i<W*bp.map.H;i++)if(bp.map.kind[i]===0){s0=i;break;}const x0=(s0%W+.5)*6,z0=(Math.floor(s0/W)+.5)*6;
 const puertas=[...bp.lots.flatMap(L=>(L.levels?.[0]?.doors||[]).filter(d=>d.street).flatMap(d=>{const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,hz=Math.abs(d.y1-d.y0)<1e-6;return [[hz?mx:mx-.8,hz?mz-.8:mz],[hz?mx:mx+.8,hz?mz+.8:mz]];})),
  ...(bp.isla.casas||[]).map(h=>{const c=cuerpoCasa(h);return [c.puerta.x+c.afuera.x*.8,c.puerta.z+c.afuera.z*.8];})];
 const llega=(d,x,z)=>{const k=gp.idx(x,z);if(k<0)return false;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*gp.nx+di;if(kk>=0&&kk<d.length&&d[kk]<Infinity)return true;}return false;};
 const d0=caminar(gp,x0,z0),antes=puertas.map(([x,z])=>llega(d0,x,z));
 for(const c of lista)for(const f of c.formas){const Rr=(f.r??Math.hypot(f.hl,f.hf))+R;for(let z=f.z-Rr;z<=f.z+Rr;z+=gp.celda)for(let x=f.x-Rr;x<=f.x+Rr;x+=gp.celda){const k=gp.idx(x,z);if(k>=0&&distForma(f,x,z)<R)gp.libre[k]=0;}}
 const d1=caminar(gp,x0,z0);puertas.forEach(([x,z],i)=>{if(!antes[i])return;med.puertas[1]++;if(llega(d1,x,z))med.puertas[0]++;else falla('puerta que deja de alcanzarse por las colisiones',{semilla:s,x:+x.toFixed(1),z:+z.toFixed(1)});});}
console.log(`${N} mundos · ${med.objetos} objetos que chocan (${med.formas} formas: ${Object.entries(med.porClave).map(([k,v])=>k+' '+v).join(', ')}) · no chocan: ${Object.entries(med.sin).map(([k,v])=>k+' ('+v+')').join(', ')}`);
console.log(`paso libre · ${med.secciones} secciones de vereda · ancho libre: p1 ${q(med.anchos,.01).toFixed(2)} m · mediana ${q(med.anchos,.5).toFixed(2)} m (mínimo ${CALLE.paso}) · puertas que se alcanzan a pie con colisiones: ${med.puertas[0]}/${med.puertas[1]}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of [...fallas].sort((a,b)=>b[1].n-a[1].n))console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

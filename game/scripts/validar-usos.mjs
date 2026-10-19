// Valida los usos de los objetos (2026-10-16, engine/usos.js; Miguel: «después quiero acciones: abrir una cortina,
// sentarse en una silla, acostarse en una cama»): que cada uso se pueda hacer en el juego —
//  · se llega caminando (la grilla de nav-interior, desde la calle, con los muebles y paredes inflados por el radio) al
//    punto donde se para el personaje;
//  · ese punto está en el mismo cuarto (una silla que mira a la pared no se usa);
//  · al sentarse, delante de las rodillas no hay otro mueble que choque (salvo la mesa o el escritorio al que mira);
//  · cada objeto tiene al menos un uso que se puede (una cama, por un costado; un sofá, alguna plaza);
//  · cada ventana de afuera se puede asomar (2026-10-17): parado delante, o inclinado sobre algo bajo.
// Uso: node scripts/validar-usos.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {usosDePiso,USOS,miradoresDePiso,miradoresDeCasa} from '../src/engine/usos.js';
import {navEdificio,navCasa,NAV_RES} from '../src/engine/nav-interior.js';
import {cuartoDeVentana} from '../src/engine/cortinas.js';
import {CHOQUE_MUEBLE,CORTINA} from '../src/engine/medidas.js';

const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),VER=process.argv.includes('--ver');
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const cuenta={};const anota=(k,ok)=>{const c=cuenta[k]||(cuenta[k]={n:0,ok:0});c.n++;if(ok)c.ok++;};
const MESAS=new Set(['mesa','mesa_centro','mesa_reunion','mesa_lectura','escritorio','pupitre','mostrador','meson','tv']),CU=new Set(CORTINA.cuartos);
// (¿se llega? la celda del punto o una a menos de 20 cm —la grilla es de 10—)
const llega=(p,x,z)=>{for(const [dx,dz] of [[0,0],[.1,0],[-.1,0],[0,.1],[0,-.1],[.2,0],[-.2,0],[0,.2],[0,-.2]]){const k=p.g.idx(x+dx,z+dz);if(k>=0&&p.dist[k]>=0)return true;}return false;};
function revisar(muebles,ventanas,cuartos,piso,ej,miradores=[]){
 const usos=usosDePiso(muebles,ventanas,miradores),porObjeto=new Map();
 const choca=m=>(CHOQUE_MUEBLE[m.kind]?.choque??'solido')!=='ninguno';
 for(const u of usos){const q=cuartos.find(c=>u.pose.x>c.x0-.05&&u.pose.x<c.x1+.05&&u.pose.z>c.z0-.05&&u.pose.z<c.z1+.05);let ok=true,por=null;
  // (de dónde: alguno de los puntos del uso, en el cuarto y al que se llegue)
  const enQ=p=>q&&p.x>q.x0&&p.x<q.x1&&p.z>q.z0&&p.z<q.z1,des=(u.des||[u.de]).filter(enQ);
  if(!des.length){ok=false;por=u.accion==='sentarse'?'mira a la pared':'el lugar para usarlo queda fuera del cuarto';}
  // (con el brazo estirado: en el medio, nada más alto que USOS.cortina.bajo —una cama sí, un armario no—)
  const sobreBajo=p=>{if(!p.sobre)return true;const bajo=u.accion==='asomarse'?USOS.asomarse.bajo:USOS.cortina.bajo;for(let t=.1;t<.95;t+=.1){const x=p.x+(p.hacia.x-p.x)*t,z=p.z+(p.hacia.z-p.z)*t;for(const n of muebles){if(!(x>n.x0&&x<n.x1&&z>n.z0&&z<n.z1))continue;const r=CHOQUE_MUEBLE[n.kind];if(r&&r.choque!=='ninguno'&&r.alto>bajo)return false;}}return true;};
  if(des.length&&!des.some(p=>llega(piso,p.x,p.z)&&sobreBajo(p))){ok=false;por='no se llega caminando';}
  else if(u.accion==='sentarse'){const m=u.objeto,fo=Math.abs(m.fx)>.5?m.x1-m.x0:m.z1-m.z0,kx=u.pose.x+m.fx*(fo/2+.25),kz=u.pose.z+m.fz*(fo/2+.25);
   const o=muebles.find(n=>n!==m&&choca(n)&&!MESAS.has(n.kind)&&kx>n.x0&&kx<n.x1&&kz>n.z0&&kz<n.z1);if(o){ok=false;por='un mueble delante de las rodillas: '+o.kind;}}
  const k=u.accion==='cortina'||u.accion==='asomarse'?u.accion:u.objeto.kind;(porObjeto.get(u.objeto)||porObjeto.set(u.objeto,{k,a:u.accion,oks:[],por:[]}).get(u.objeto));const r=porObjeto.get(u.objeto);r.oks.push(ok);if(por)r.por.push(por);}
 for(const [o,r] of porObjeto){const ok=r.oks.some(Boolean);anota(r.k,ok);if(!ok)falla(`${r.a} · ${r.k}: ${r.por[0]}`,VER?{...ej,caja:[o.x0,o.x1,o.z0,o.z1].map(v=>+v.toFixed(2)),f:[+o.fx.toFixed(2),+o.fz.toFixed(2)],puntos:usos.filter(u=>u.objeto===o).flatMap(u=>u.des).map(p=>{const k=piso.g.idx(p.x,p.z);return [+p.x.toFixed(2),+p.z.toFixed(2),k>=0?piso.g.libre[k]:'x',k>=0?piso.dist[k]:'x'];}),cuartos:cuartos.filter(c=>Math.max(c.x0-o.x1,o.x0-c.x1,c.z0-o.z1,o.z0-c.z1)<0).map(c=>[c.tipo,c.x0,c.x1,c.z0,c.z1])}:ej);}}
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)]){const pisos=navEdificio(L);
  for(const lv of L.levels){const piso=pisos.find(p=>p.nivel===lv.level);if(!piso)continue;
   const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h,fx:Math.sin(f.ry||0),fz:Math.cos(f.ry||0)}));
   const cuartos=[...lv.rooms,...(lv.corridor||[])].map(q=>({x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h,tipo:q.type}));
   const ventanas=[];for(const w of lv.windows||[]){if(w.shop)continue;const c=cuartoDeVentana(lv,w);if(!c||!CU.has(c.q.type))continue;const m=(c.u+c.v)/2;ventanas.push(c.h?{x0:c.u,x1:c.v,z0:c.at,z1:c.at,nx:0,nz:c.edge}:{x0:c.at,x1:c.at,z0:c.u,z1:c.v,nx:c.edge,nz:0});}
   revisar(muebles,ventanas,cuartos,piso,{semilla:s,lote:L.type,piso:lv.level},miradoresDePiso(lv));}}
 for(const h of bp.isla.casas||[]){const P=h.spec?.hogar;if(!P)continue;const pisos=navCasa(h);
  for(const lv of P.levels){const piso=pisos.find(p=>p.nivel===lv.level);if(!piso)continue;
   const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1,fx:(f.dir||[0,1])[0],fz:(f.dir||[0,1])[1]}));
   const cuartos=lv.rooms.map(q=>({x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1,tipo:q.type}));
   revisar(muebles,[],cuartos,piso,{semilla:s,casa:true,piso:lv.level},miradoresDeCasa(lv));}}}
console.log('usos · '+Object.entries(cuenta).sort((a,b)=>b[1].n-a[1].n).map(([k,c])=>`${k} ${c.ok}/${c.n} (${Math.round(100*c.ok/c.n)} %)`).join(' · '));
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of [...fallas].sort((a,b)=>b[1].n-a[1].n))console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

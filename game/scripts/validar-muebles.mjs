// Valida el choque de los muebles (2026-10-16, CHOQUE_MUEBLE de medidas.js; Miguel: «cuáles merecen colisionadores,
// para que se pueda subir a las mesas, sofás, estufas, cajas»):
//  · cada tipo de mueble que ponen los planos (edificios y casas) tiene su regla;
//  · lo pisable se alcanza (alto ≤ ALCANCE: el salto más un escalón) y lo sólido que se alcanzaría dice por qué no se pisa;
//  · el alto nunca pasa de lo que mide el modelo que lo dibuja (MUEBLES_MEDIDOS), con 5 cm de holgura;
//  · (que con estos choques se llegue caminando a cada cuarto lo prueba validar-interiores: nav-interior usa esta regla).
// Uso: node scripts/validar-muebles.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {CHOQUE_MUEBLE,ALCANCE} from '../src/engine/medidas.js';
import {MUEBLES_MEDIDOS} from '../src/engine/muebles-medidos.js';

const N=+(process.argv[2]||4),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const cuenta={pisable:0,solido:0,ninguno:0},tipos=new Set();
for(const [k,r] of Object.entries(CHOQUE_MUEBLE)){
 if(r.choque==='pisable'&&r.alto>ALCANCE)falla('pisable que no se alcanza',{tipo:k,alto:r.alto,alcance:ALCANCE});
 if(r.choque==='solido'&&r.alto<=ALCANCE&&!r.razon)falla('sólido que se alcanzaría, sin decir por qué no se pisa',{tipo:k,alto:r.alto});
 const m=MUEBLES_MEDIDOS[k]?.modelo?.alto;if(r.choque!=='ninguno'&&m&&r.alto>m/1000+.05)falla('más alto que su modelo',{tipo:k,alto:r.alto,modelo:m/1000});}
const solapa=(a,b)=>Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)>.02&&Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0)>.02;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 const revisar=(muebles,puertas,ej)=>{for(const m of muebles){tipos.add(m.kind);const r=CHOQUE_MUEBLE[m.kind];if(!r){falla('mueble sin regla de choque',{...ej,tipo:m.kind});continue;}cuenta[r.choque]++;}
};
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)])for(const lv of L.levels){
  const ms=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h}));
  // (el paso delante de cada vano: 0,8 m a cada lado de la línea, a lo ancho del vano)
  const ps=(lv.doors||[]).filter(d=>!d.street||true).map(d=>{const h=Math.abs(d.y1-d.y0)<1e-6,u0=h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),u1=h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1),at=h?d.y0:d.x0;return h?{x0:u0+.05,x1:u1-.05,z0:at-.8,z1:at+.8}:{x0:at-.8,x1:at+.8,z0:u0+.05,z1:u1-.05};});
  revisar(ms,ps,{semilla:s,lote:L.type,piso:lv.level});}
 for(const h of bp.isla.casas||[])for(const lv of h.spec?.hogar?.levels||[]){const ms=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1}));
  const ps=(lv.doors||[]).map(d=>d.axis==='u'?{x0:d.from+.05,x1:d.from+d.len-.05,z0:d.at-.8,z1:d.at+.8}:{x0:d.at-.8,x1:d.at+.8,z0:d.from+.05,z1:d.from+d.len-.05});revisar(ms,ps,{semilla:s,casa:true,piso:lv.level});}}
const lista=t=>Object.entries(CHOQUE_MUEBLE).filter(([,r])=>r.choque===t).map(([k,r])=>k+' '+r.alto?.toFixed?.(2)).join(', ');
console.log(`muebles · alcance ${ALCANCE} m (salto + escalón) · ${tipos.size} tipos en los planos · pisables ${cuenta.pisable}, sólidos ${cuenta.solido}, sin choque ${cuenta.ninguno}`);
console.log(`  pisables: ${lista('pisable')}\n  sólidos: ${lista('solido')}\n  sin choque: ${Object.entries(CHOQUE_MUEBLE).filter(([,r])=>r.choque==='ninguno').map(([k])=>k).join(', ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

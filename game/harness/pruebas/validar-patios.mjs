// Nivel 3 del probador (2026-10-16, Miguel: «que uno pueda tener acceso a los patios del centro en los edificios y casas»):
//  · cada patio de manzana de la ciudad se alcanza a pie desde la calle (por las casillas abiertas: calle, callejón —el
//    zaguán que deja el generador—, plaza, patio);
//  · cada casa del monte tiene su puerta al patio de atrás (hogar.js), en la pared del fondo, desde un cuarto que la toca;
//  · (2026-10-17, Miguel: «entrar a los edificios desde el parque interior, como si fueran tiendas también por ahí») cada
//    puerta al patio de un edificio abre, del otro lado, a una casilla a la que se llega a pie desde la calle; y cada
//    patio de manzana tiene al menos una puerta de un edificio (y se cuentan los locales con vidriera al patio).
// Uso: node scripts/validar-patios.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import City from '../src/engine/ciudad.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),K=City.K;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const ANDA=new Set([K.street,K.avenue,K.alley,K.plaza,K.kiosk,K.courtyard]);let patios=0,casas=0,conPuerta=0,puertasPatio=0,localesPatio=0,patiosConPuerta=0;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),m=bp.map,{W,H}=m;
 const vis=new Uint8Array(W*H),q=[];for(let i=0;i<W*H;i++)if(m.kind[i]===K.street||m.kind[i]===K.avenue){vis[i]=1;q.push(i);}
 for(let h=0;h<q.length;h++){const i=q[h],x=i%W,y=(i-x)/W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=ny*W+nx;if(!vis[j]&&ANDA.has(m.kind[j])){vis[j]=1;q.push(j);}}}
 // las puertas al patio de los edificios: del lado de afuera (a 0,5 m de la puerta, fuera de las partes del edificio), una casilla a pie
 const puertasDe=new Map();
 for(const L of bp.lots){const lv=L.levels?.[0];if(!lv)continue;for(const d of lv.doors.filter(d=>d.patio)){puertasPatio++;if(lv.rooms.find(r=>r.id===d.a)?.type==='local')localesPatio++;
  const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,h=Math.abs(d.y0-d.y1)<1e-6,afuera=[h?[mx,mz-.5]:[mx-.5,mz],h?[mx,mz+.5]:[mx+.5,mz]].find(([x,z])=>!(L.parts||[]).some(q=>x>q.x&&x<q.x+q.w&&z>q.y&&z<q.y+q.h))?.map(v=>Math.floor(v/CELL));// (afuera de las partes del edificio: un lote en L tiene patio dentro de su rectángulo)
  if(!afuera){falla('puerta al patio que no da afuera del edificio',{semilla:s,lote:L.id});continue;}const [ax,ay]=afuera,i=ay*W+ax;
  if(ax<0||ay<0||ax>=W||ay>=H||!vis[i])falla('puerta al patio que da a donde no se llega a pie',{semilla:s,lote:L.id,casilla:[ax,ay]});
  for(const [k,ct] of bp.courts.entries())if(ax>=ct.x0-1&&ax<=ct.x1+1&&ay>=ct.y0-1&&ay<=ct.y1+1)puertasDe.set(k,(puertasDe.get(k)||0)+1);}}
 for(const [k,ct] of bp.courts.entries()){patios++;if(puertasDe.get(k))patiosConPuerta++;else falla('patio de manzana sin ninguna puerta de edificio',{semilla:s,patio:[ct.x0,ct.y0,ct.x1,ct.y1]});let ok=false;for(let y=ct.y0;y<=ct.y1&&!ok;y++)for(let x=ct.x0;x<=ct.x1;x++)if(vis[y*W+x]){ok=true;break;}if(!ok)falla('patio de manzana encerrado (no se llega a pie desde la calle)',{semilla:s,patio:[ct.x0,ct.y0,ct.x1,ct.y1]});}
 for(const h of bp.isla.casas||[]){const G=h.spec?.hogar;if(!G)continue;casas++;const L=G.levels[0],d=L.doors.find(d=>d.patio);
  if(!d){falla('casa sin puerta al patio de atrás',{semilla:s,casa:h.manzana});continue;}conPuerta++;
  const q=L.rooms.find(r=>r.id===d.a);if(!q||Math.abs(d.at-q.v1)>1e-6||Math.abs(q.v1-G.D)>1e-6||d.from<q.u0-1e-6||d.from+d.len>q.u1+1e-6)falla('puerta al patio fuera de la pared del fondo de su cuarto',{semilla:s,casa:h.manzana});}}
console.log(`patios · ${N} ciudades · ${patios} patios de manzana, todos a pie desde la calle salvo los que fallan; ${patiosConPuerta} con puertas de edificios (${puertasPatio} puertas, ${localesPatio} de locales con vidriera) · ${conPuerta}/${casas} casas con puerta al patio`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

// ======== Las cortinas cerradas (2026-10-16, idea de Miguel) ========
// cerrarCortinas(bp): por unidad —un departamento, una oficina, un cuarto de hotel (los cuartos con el mismo q.unit, o
// cada cuarto si no tiene)— un sorteo fijo con la probabilidad del tipo del edificio (CORTINA.cerradas) decide si tiene
// las cortinas cerradas; si sí, cada ventana de sus cuartos de CORTINA.cuartos lleva w.cortina = la tela (un color por
// unidad). Las vidrieras de los locales, nunca. Las casas del monte: h.cortinas = {tela, cuartos: [ids]} en la casa —su
// plano se comparte entre casas (hogar.js)—. Determinista. Puro.
import {CORTINA} from './medidas.js';

const sorteo=(...k)=>{let h=0x811C9DC5;for(const v of k){const s=String(v);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;h=Math.imul(h^0x2c,0x01000193)>>>0;}h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;return (h>>>0)/4294967296;};
const CUARTOS=new Set(CORTINA.cuartos);
// El cuarto de una ventana (la ventana en uno de sus bordes y dentro de él) y el lado: edge 1 si el cuarto está hacia +.
export function cuartoDeVentana(lv,w){const h=Math.abs(w.y0-w.y1)<1e-3,at=h?w.y0:w.x0,[u,v]=h?[Math.min(w.x0,w.x1),Math.max(w.x0,w.x1)]:[Math.min(w.y0,w.y1),Math.max(w.y0,w.y1)];
 for(const q of lv.rooms){const a=h?q.x:q.y,b=h?q.x+q.w:q.y+q.h,edge=h?(Math.abs(at-q.y)<.02?1:Math.abs(at-q.y-q.h)<.02?-1:0):(Math.abs(at-q.x)<.02?1:Math.abs(at-q.x-q.w)<.02?-1:0);
  if(edge&&u>=a-.01&&v<=b+.01)return {q,edge,h,at,u,v,a,b};}return null;}
export const pideCerrar=(tipo,...k)=>sorteo(...k)<(CORTINA.cerradas[tipo]??0);
export const telaDe=(...k)=>CORTINA.telas[Math.floor(sorteo('tela',...k)*CORTINA.telas.length)];

export function cerrarCortinas(bp){let unidades=0,cerradas=0,ventanas=0;
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(l=>l.levels)]){const tipo=bp.lots.includes(L)?L.type:'monte';
  for(const lv of L.levels||[]){const vistas=new Set();
   for(const w of lv.windows||[]){delete w.cortina;if(w.shop)continue;const c=cuartoDeVentana(lv,w);if(!c||!CUARTOS.has(c.q.type))continue;
    const u=c.q.unit??'c'+c.q.id,k=[bp.seed,L.id,lv.level,u];if(!vistas.has(u)){vistas.add(u);unidades++;if(pideCerrar(tipo,...k))cerradas++;}
    if(pideCerrar(tipo,...k)){w.cortina=telaDe(...k);ventanas++;}}}}
 for(const h of bp.isla?.casas||[]){delete h.cortinas;const P=h.spec?.hogar;if(!P)continue;unidades++;const k=[bp.seed,'casa',h.x.toFixed(1),h.z.toFixed(1)];if(!pideCerrar('casa',...k))continue;cerradas++;
  const cuartos=[];for(const lv of P.levels)for(const w of lv.windows||[]){const q=lv.rooms.find(r=>r.id===w.a);if(q&&CUARTOS.has(q.type)){cuartos.push(lv.level+':'+q.id);ventanas++;}}
  h.cortinas={tela:telaDe(...k),cuartos:[...new Set(cuartos)]};}
 return {unidades,cerradas,ventanas};}

// El paño cerrado de una ventana (c: cuartoDeVentana), en cajas del mundo {x,y,z,sx,sy,sz,color}: la tela de lado a lado
// —hasta CORTINA.panio.ancho centrado en la ventana, sin pasar del cuarto (margen)— de panio.bajo a panio.alto sobre el
// piso yb, a cara (m) de la línea de la fachada hacia adentro; el barral arriba y dos pliegues un poco más oscuros.
const oscuro=(hex,k=.82)=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*k).toString(16).padStart(2,'0')).join('');
export function panioCerrado(c,tela,yb,cara){const P=CORTINA.panio,m=(c.u+c.v)/2,u0=Math.max(c.a+P.margen,m-P.ancho/2),u1=Math.min(c.b-P.margen,m+P.ancho/2),L=u1-u0,mu=(u0+u1)/2;
 const at=c.at+c.edge*cara,out=[];
 const caja=(du,y,hh,ancho,off,esp,color)=>{const p=at+c.edge*off;out.push(c.h?{x:mu+du,y,z:p,sx:ancho,sy:hh,sz:esp,color}:{x:p,y,z:mu+du,sx:esp,sy:hh,sz:ancho,color});};
 caja(0,yb+P.bajo,P.alto-P.bajo,L,0,.03,tela);
 for(const t of [-1/3,1/3])caja(t*L,yb+P.bajo,P.alto-P.bajo-.04,.12,.02,.02,oscuro(tela));
 caja(0,yb+P.alto,.04,L+.1,.03,.04,'#5b4330');
 return {cajas:out,u0,u1,y0:yb+P.bajo,y1:yb+P.alto};}

// La cortina abierta de una ventana DIBUJADA (2026-10-16, Miguel: «reubicá y organizá las cortinas para que estén bien en
// las ventanas»: iban una por ventana del plano, medidas con su largo; donde el 3D dibuja una ventana doble para dos del
// plano quedaban dos juegos con los paños en el medio del vidrio). v: {c (centro a lo largo), x0, x1, y0, y1 (el vidrio,
// relativo al centro y al piso)}; [a, b]: la pared del cuarto a lo largo. Los paños, a los costados del vidrio (más
// el marco); el barral, sobre el vidrio. null si no caben los paños dentro de la pared del cuarto.
// (los paños: tres pliegues de 9 cm; si la pared no da, dos o uno —lo que ocupa cada lado, panio(n), con el barral—)
export const CORTINA_ABIERTA={marco:.08,sobre:.18,techo:2.82,bajo:.12,solapa:.3,panio:n=>.06+.09*(n-1)+.08};
export function cortinaAbierta(v,a,b){const K=CORTINA_ABIERTA,w=v.x1-v.x0+2*K.marco,m=v.c+(v.x0+v.x1)/2;
 for(const n of [3,2,1]){const pa=K.panio(n);if(m-w/2-pa>=a+.02&&m+w/2+pa<=b-.02)return {m,w,h:Math.min(K.techo,v.y1+K.sobre),bajo:K.bajo,u0:m-w/2,u1:m+w/2,paño:pa,pliegues:n};}
 // (el vidrio casi tan ancho como la pared —las de metal de vidrio entero, 1,8 m en 2—: de pared a pared, con los paños
 // sobre los bordes del vidrio, hasta K.solapa por lado, como en una casa de verdad)
 const pa=K.panio(3),u0=Math.max(a+.02,m-w/2-pa)+pa,u1=Math.min(b-.02,m+w/2+pa)-pa;
 if(u1-u0>.4&&v.c+v.x0-u0<=0&&(v.c+v.x0)-(u0)>=-K.solapa-1e-6&&u1-(v.c+v.x1)>=-K.solapa-1e-6)return {m:(u0+u1)/2,w:u1-u0,h:Math.min(K.techo,v.y1+K.sobre),bajo:K.bajo,u0,u1,paño:pa,pliegues:3,solapa:true};
 return null;}
// Las cortinas de una misma pared que se pisarían (dos ventanas vecinas): un solo juego, de la primera a la última, con
// los pliegues del que menos tenía. ks: las de una pared, ordenadas a lo largo.
export function juntarCortinas(ks){const out=[];for(const k of ks){const p=out.at(-1);
  if(p&&k.u0-k.paño<p.u1+p.paño+.01){const n=Math.min(p.pliegues,k.pliegues),pa=CORTINA_ABIERTA.panio(n);Object.assign(p,{u0:p.u0,u1:k.u1,w:k.u1-p.u0,m:(p.u0+k.u1)/2,h:Math.max(p.h,k.h),pliegues:n,paño:pa});}
  else out.push({...k});}return out;}

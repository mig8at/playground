/* La sociedad en el 3D (2026-10-17, etapa 2): la gente de las familias (engine/sociedad.js) que está afuera a la hora de
   la ronda, cerca del jugador: la que camina de un lugar a otro por las calles y la que está en un parque
   (engine/juego/transeuntes.js). Reemplaza a la gente de la calle que caminaba sin rumbo.
   · Cada persona es siempre el mismo muñeco (por su id) y los chicos son más bajos.
   · Se dibujan hasta MAX, los más cercanos, a menos de RADIO m. Los muñecos se reciclan (un pozo por plantilla).
   · Adentro de los lugares (2026-10-17): los que a esa hora están en un lugar (trabajan, compran, estudian…) se ven en
     sus cuartos —en un local, los del giro; si no, cualquiera que no sea de servicio ni de un apartamento—, en su piso,
     cada uno siempre en el mismo punto. Sólo los lugares a menos de ADENTRO.radio m, hasta ADENTRO.porLugar por lugar.
   · quien(x, z): la persona a menos de NOMBRE m —para el cartel con su nombre y su oficio—.
   createSociedad3d({scene, plan, mapa, characters, suelo, reloj}) → {update(dt, x, z), quien(x, z), personas(), S, dispose}
   reloj(): {inicio, s} —el día y la hora en que empezó la ronda (s del juego) y los s reales que van—. */
import * as THREE from 'three';
import {sociedadDe,dondeEsta} from '../engine/sociedad.js';
import {RELOJ} from '../engine/medidas.js';
import {crearTranseuntes} from '../engine/juego/transeuntes.js';
import {makeCharacter,moveCharacter} from './characters3d.js';
import {makeSitter,FWD} from './sitting3d.js';
import {aspectoDe} from '../engine/juego/identidad.js';
import {rng} from '../engine/veredas.js';

export const GENTE3D={radio:90,max:45,nombre:2.6,presupuesto:4,calentar:3};// m, muñecos, m, ms por cuadro para caminos nuevos y adelantados
export const ADENTRO={radio:40,porLugar:18,max:40,cada:.5,margen:.6,lugar:.9};// m, personas por lugar y en total, s entre recuentos, m de la pared
const SERVICIO=new Set(['bano','deposito','sanitario','boveda','celda','interrogatorio','archivo','cocina','cocineta']);

const hashId=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const alto=edad=>edad<4?.55:edad<8?.68:edad<12?.8:edad<15?.92:1;

export function createSociedad3d({scene,plan,mapa,characters,suelo,reloj,alturaPiso=(lote,nivel)=>nivel*3}){
 const S=sociedadDe(plan),T=crearTranseuntes(S,mapa),grupo=new THREE.Group();grupo.name='sociedad';scene.add(grupo);
 const vivos=new Map(),pozo=new Map(),quietos=new Map();let lista=[],r=rng(plan.seed*7+3),adentro=[],reloj0=0;
 // los cuartos de cada lugar donde se ve gente (con su piso), una vez
 const cuartos=new Map(),cuartosDe=l=>{if(cuartos.has(l.id))return cuartos.get(l.id);const L=plan.lots[l.lote],todos=[];
  for(const lv of L?.levels||[])for(const q of lv.rooms)if(q.unit==null&&!SERVICIO.has(q.type)&&q.w>1.6&&q.h>1.6)todos.push({...q,nivel:lv.level});
  const out=todos.some(q=>q.giro)?todos.filter(q=>q.giro):todos;cuartos.set(l.id,out);return out;};
 // quién está adentro de los lugares cercanos, y dónde (cada uno en su cuarto, siempre en el mismo punto)
 function recontar(x,z,inicio,s,alturaPiso){const t=inicio+s*RELOJ.escala,out=[],cerca=[...S.lugares.values()].filter(l=>l.lote!=null&&Math.hypot(l.x-x,l.z-z)<ADENTRO.radio);if(!cerca.length)return out;
  const ids=new Set(cerca.map(l=>l.id)),por=new Map();
  for(const p of S.personas){const e=dondeEsta(S,p,t);if(!ids.has(e.donde))continue;const a=por.get(e.donde)||por.set(e.donde,[]).get(e.donde);a.push({p,que:e.que});}
  cerca.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
  for(const l of cerca){if(out.length>=ADENTRO.max)break;const qs=cuartosDe(l),gs=(por.get(l.id)||[]).sort((a,b)=>(a.que==='trabaja'?0:1)-(b.que==='trabaja'?0:1)).slice(0,ADENTRO.porLugar);if(!qs.length)continue;
   // (cada uno en un lugar de una grilla de ADENTRO.lugar m en su cuarto: nadie encima de otro; si el cuarto se llena, el
   // que sobra no se dibuja)
   const ocup=new Map();
   for(const {p,que} of gs){if(out.length>=ADENTRO.max)break;const h=hashId(p.id),q=qs[h%qs.length],m=ADENTRO.margen,L=ADENTRO.lugar,cols=Math.max(1,Math.floor((q.w-2*m)/L)),filas=Math.max(1,Math.floor((q.h-2*m)/L));
    const n=ocup.get(q)||0;if(n>=cols*filas)continue;ocup.set(q,n+1);const k=n;// (en orden: dos nunca caen en el mismo lugar)
    const px=q.x+m+(k%cols+.5)*((q.w-2*m)/cols),pz=q.y+m+(Math.floor(k/cols)+.5)*((q.h-2*m)/filas);out.push({id:p.id+'@'+l.id,persona:p,x:px,z:pz,y:alturaPiso(l.lote,q.nivel),rumbo:(h%8)*Math.PI/4,camina:false,que:`${que} en ${l.nombre}`,adentro:l.id});}}
  return out;}
 const sacar=p=>{const ti=hashId(p.id)%characters.length,q=pozo.get(ti);let c=q?.pop();if(!c){c=makeCharacter(characters[ti],r);c.ti=ti;}c.holder.scale.setScalar(alto(p.edad));c.holder.visible=true;grupo.add(c.holder);return c;};
 const guardar=c=>{if(c.holder.userData.sentado){c.mixer.stopAllAction();c.acts.idle.reset().play();c.state='idle';c.holder.userData.sentado=false;}c.holder.visible=false;grupo.remove(c.holder);(pozo.get(c.ti)||pozo.set(c.ti,[]).get(c.ti)).push(c);};
 function update(dt,x,z){if(!characters.length)return;const {inicio,s}=reloj();
  lista=T.cerca(inicio,s,x,z,GENTE3D.radio,GENTE3D.max,GENTE3D.presupuesto,[{x,z,r:.3}]);// (al jugador lo esquivan)T.calentar(GENTE3D.calentar,x,z);
  if((reloj0-=dt)<=0){reloj0=ADENTRO.cada;adentro=recontar(x,z,inicio,s,alturaPiso);}{const camina=new Set(lista.map(o=>o.persona.id));lista=lista.concat(adentro.filter(o=>!camina.has(o.persona.id)));}// (el que todavía se ve llegando no está adentro)
  const ahora=new Set();
  const ya=performance.now();for(const [k,q] of quietos)if(ya>q.hasta)quietos.delete(k);
  for(const o0 of lista){const q=quietos.get(o0.persona.id),o=q?{...o0,x:q.x,z:q.z,rumbo:q.rumbo,camina:false}:o0;ahora.add(o.id);let v=vivos.get(o.id);const nuevo=!v;if(nuevo){v={c:sacar(o.persona),y:suelo(o.x,o.z)};vivos.set(o.id,v);}
   const h=v.c.holder,dx=o.x-h.position.x,dz=o.z-h.position.z,d=Math.hypot(dx,dz);
   if(nuevo||d>3){h.position.x=o.x;h.position.z=o.z;}else{h.position.x=o.x;h.position.z=o.z;}
   v.y=o.y!=null?o.y:suelo(o.x,o.z,v.y+.6);h.position.y=v.y;
   // (sentado en una banca —transeuntes, el cansancio—: la pose de sentarse de las sillas, ya sentado, con la cadera sobre
   // el asiento; al pararse, vuelve a quieto/caminar)
   if(o.sentado){if(!v.sit){v.sit=makeSitter(v.c,characters[v.c.ti]);if(v.sit.ok)v.sit.sitNow();else v.sit=null;}
    if(v.sit){h.rotation.y=o.rumbo;h.position.x=o.x+Math.sin(o.rumbo)*FWD;h.position.z=o.z+Math.cos(o.rumbo)*FWD;h.position.y=v.y+.29;v.sit.hold(dt);v.o=o;continue;}}
   else if(v.sit){v.sit.release();v.sit=null;}
   // (gira de a poco hacia donde va —el rumbo del camino—, no de golpe; camina siempre a su paso: nadie corre)
   if(nuevo)h.rotation.y=o.rumbo;else{let da=o.rumbo-h.rotation.y;da=Math.atan2(Math.sin(da),Math.cos(da));h.rotation.y+=da*Math.min(1,dt*6);}
   // (la animación, a lo que de verdad avanza —transeuntes vAnim, 2026-10-18: con el paso nominal los pies patinaban—)
   moveCharacter(v.c,o.camina&&(o.vAnim??o.v)>.15?'walk':'idle',o.camina?o.vAnim??o.v??1.3:0,dt);v.o=o;}
  for(const [id,v] of vivos)if(!ahora.has(id)){guardar(v.c);vivos.delete(id);}}
 // (quién está cerca: su aspecto —lo que se ve: identidad.js— y su identidad; el cartel lo arma DemoView, que sabe si ya
 // se le pidieron los papeles)
 function quien(x,z){let best=null,bv=null,bd=GENTE3D.nombre;for(const v of vivos.values()){const d=Math.hypot(v.o.x-x,v.o.z-z);if(d<bd){bd=d;best=v.o;bv=v;}}
  if(!best)return null;const t=characters[bv.c.ti]||{};
  return {id:best.persona.id,aspecto:aspectoDe({look:t.look||{},outfit:t.outfit||{},nino:best.persona.edad<12}),identidad:{nombre:best.persona.nombre,oficio:best.persona.oficio,edad:best.persona.edad},que:best.que};}
 // la persona más cercana a menos de d m (y su lugar), y detenerla s segundos reales (le piden los papeles)
 function cercano(x,z,d=GENTE3D.nombre){let best=null,bd=d;for(const v of vivos.values()){const e=Math.hypot(v.o.x-x,v.o.z-z);if(e<bd){bd=e;best=v.o;}}return best;}
 function detener(id,s){const v=[...vivos.values()].find(v=>v.o.persona.id===id);if(v)quietos.set(id,{x:v.o.x,z:v.o.z,rumbo:v.o.rumbo,hasta:performance.now()+s*1000});}
 const personas=()=>[...vivos.values()].filter(v=>!v.o.adentro).map(v=>({id:v.o.persona.id,x:v.o.x,z:v.o.z,camina:v.o.camina}));
 const adentroDe=()=>[...vivos.values()].filter(v=>v.o.adentro).map(v=>({id:v.o.persona.id,x:v.o.x,z:v.o.z,y:v.o.y,lugar:v.o.adentro,que:v.o.que}));
 function dispose(){scene.remove(grupo);for(const v of vivos.values())v.c.mixer.stopAllAction();for(const q of pozo.values())for(const c of q)c.mixer.stopAllAction();vivos.clear();pozo.clear();}
 return {update,quien,personas,adentroDe,cercano,detener,dispose,S,T,grupo};}

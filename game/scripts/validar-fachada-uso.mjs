// La fachada según el uso (2026-10-18, FACHADAS.md A1 y A2), en el 2D:
//  · A1: donde se vive en la planta baja (VIVE_EN_PLANTA_BAJA: casa, vivienda) la vidriera (esVidriera: la ventana que el
//    3D dibuja de vidrio de piso a techo) va sólo en un local: no se ven el dormitorio ni la cocina desde la calle;
//  · A2: donde se vive (RESIDENCIAL: vivienda, hotel, casa) ninguna ventana es de vidrio entero (VIDRIO_ENTERO), y el
//    vidrio de cada ventana de los pisos de arriba es a lo sumo VIDRIO_VIVIENDA de su módulo de fachada (2 × 3 m);
//  · la luz: cada cuarto habitable de arriba sigue con MINIMO.luz de vidrio por piso, o con la pieza más grande que se
//    le puede dar (la que el plano subió).
// La pieza de cada ventana, como la elige town3d: w.pieza, o la del estilo (ventana1 en planta baja y primer piso si
// la ventana es de 1 m o más; ventana más arriba).
// Uso: node scripts/validar-fachada-uso.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {esVidriera,VIVE_EN_PLANTA_BAJA,RESIDENCIAL,VIDRIO,VIDRIO_VIVIENDA,VIDRIO_ENTERO,VENTANAS_VIVIENDA,HABITABLE,MINIMO} from '../src/engine/medidas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={vidrieras:0,enLocal:0,resid:0,ventanas:0,maxParte:0,cuartos:0,oscuros:0};
// (la ventana guarda sólo su segmento: su cuarto, el que la contiene en el borde)
const cuartoDe=(lv,w)=>{const mx=(w.x0+w.x1)/2,my=(w.y0+w.y1)/2,E=.05;return lv.rooms.find(q=>mx>=q.x-E&&mx<=q.x+q.w+E&&my>=q.y-E&&my<=q.y+q.h+E);};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){const fa=L.fachada||{},res=RESIDENCIAL.has(L.type);if(res)med.resid++;
  for(const lv of L.levels||[])for(const w of lv.windows){const q=cuartoDe(lv,w),len=Math.hypot(w.x1-w.x0,w.y1-w.y0),ej={semilla:s,lote:L.type,piso:lv.level,cuarto:q?.type};
   if(lv.level===0&&VIVE_EN_PLANTA_BAJA.has(L.type)&&esVidriera(L.type,w)){med.vidrieras++;if(q?.type==='local')med.enLocal++;else falla('vidriera fuera de un local donde se vive',ej);}
   if(!res||(lv.level===0&&esVidriera(L.type,w)))continue;const pz=w.pieza||(lv.level<=1&&len>=1?fa.ventana1:fa.ventana);med.ventanas++;
   if(VIDRIO_ENTERO.has(pz))falla('vidrio entero donde se vive',{...ej,pieza:pz});
   const parte=(VIDRIO.ventana[pz]??0)/6;med.maxParte=Math.max(med.maxParte,parte);if(parte>VIDRIO_VIVIENDA+1e-9)falla('ventana con más vidrio que VIDRIO_VIVIENDA donde se vive',{...ej,pieza:pz,parte:+parte.toFixed(2)});}
  if(res)for(const lv of (L.levels||[]).filter(l=>l.level>0))for(const q of lv.rooms){if(!HABITABLE.has(q.type))continue;const ws=lv.windows.filter(w=>cuartoDe(lv,w)===q);if(!ws.length)continue;med.cuartos++;
   const g=ws.reduce((a,w)=>{const len=Math.hypot(w.x1-w.x0,w.y1-w.y0);return a+(VIDRIO.ventana[w.pieza||(lv.level<=1&&len>=1?fa.ventana1:fa.ventana)]??0);},0),need=q.w*q.h*MINIMO.luz,maxG=ws.length*Math.max(...VENTANAS_VIVIENDA.map(k=>VIDRIO.ventana[k]));
   if(g<need-1e-6){med.oscuros++;if(g<maxG-1e-6)falla('cuarto sin la luz que podía tener',{semilla:s,lote:L.type,piso:lv.level,cuarto:q.type,vidrio:+g.toFixed(2),pide:+need.toFixed(2)});}}}}
console.log(`fachada y uso · ${N} ciudades · vidrieras de planta baja donde se vive ${med.vidrieras} (en un local ${med.enLocal}) · ${med.resid} lotes donde se vive, ${med.ventanas} ventanas: la de más vidrio ${(100*med.maxParte).toFixed(0)} % de su módulo (máximo ${100*VIDRIO_VIVIENDA} %) · cuartos habitables ${med.cuartos}, con menos luz que MINIMO.luz ${med.oscuros} (con la pieza más grande que cabe)`);
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`fallas: ${tot}`);

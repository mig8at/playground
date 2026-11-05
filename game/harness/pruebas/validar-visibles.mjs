// Valida qué se ve desde adentro (2026-10-16, engine/visibles.js) con rayos independientes de los de la regla: desde
// puntos al azar dentro de cada piso (a la altura de los ojos o de la cámara), en direcciones al azar de toda la esfera,
// a pasos de 25 cm. Mientras el rayo está en su edificio no sale de su piso (losa y cielo raso), y sale del edificio sólo
// por una abertura (ventana o vidriera, de 0,05 a 2,75 m sobre el piso; puerta de calle, hasta 2,2); afuera, el primer
// edificio que lo tapa (sus pisos por 3 m) es un lote que se ve: TIENE que estar en la lista de la regla.
// Uso: node scripts/validar-visibles.mjs [ciudades=2] [semilla0=1] [rayos por piso=1500]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {visiblesDesde,alturasDe,aberturasDe,VISIBLES} from '../src/engine/visibles.js';
import {ALTURA} from '../src/engine/medidas.js';
import {rng} from '../src/engine/veredas.js';

const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),R=+(process.argv[4]||1500),PASO=.25,FL=ALTURA.piso;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={celdas:0,celdasLista:[],pisos:0,rayos:0,salen:0,ven:0,lotes:[],manzanas:[],total:0,totalM:0};
const cruza=(ax,az,bx,bz,cx,cz,dx,dz)=>{const d=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(d)<1e-12)return false;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/d,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/d;return t>=0&&t<=1&&u>=-1e-6&&u<=1+1e-6;};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),A=alturasDe(bp),r=rng(s*977),{W,H,lote,alto}=A;med.total+=bp.lots.length;
 const loteEn=(x,z)=>{const cx=Math.floor(x/CELL),cz=Math.floor(z/CELL);return cx<0||cz<0||cx>=W||cz>=H?-2:lote[cz*W+cx];};
 for(const L of bp.lots)for(const lv of L.levels){med.pisos++;const V=visiblesDesde(bp,L.id,lv.level),y0=lv.level*FL,esp=[...lv.rooms,...(lv.corridor||[])];med.lotes.push(V.lotes.size/bp.lots.length);med.celdasLista.push(V.celdas.size/(W*H));med.manzanas.push(V.manzanas.size/bp.blocks.length);
  const ab=aberturasDe(L,lv).map((a,i)=>({a,puerta:i>=(lv.windows||[]).length}));
  for(let k=0;k<R;k++){const q=esp[Math.floor(r()*esp.length)];if(!q)break;let x=q.x+.2+r()*(q.w-.4),z=q.y+.2+r()*(q.h-.4),y=y0+1+r()*1.9;if(loteEn(x,z)!==L.id)continue;
   const u=2*r()-1,th=r()*Math.PI*2,c=Math.sqrt(1-u*u),dx=c*Math.cos(th),dy=u,dz=c*Math.sin(th);med.rayos++;let fuera=false,salida=null;
   for(let t=0;t<420;t+=PASO){const nx=x+dx*PASO,ny=y+dy*PASO,nz=z+dz*PASO,l=loteEn(nx,nz);
    if(!fuera){if(ny<y0+.02||ny>y0+FL-.1)break;// (la losa o el cielo raso)
     if(l!==L.id){// sale del edificio: ¿por una abertura?
      const ok=ab.some(({a,puerta})=>cruza(x,z,nx,nz,a[0],a[1],a[2],a[3])&&ny>y0+(puerta?0:.05)&&ny<y0+(puerta?2.2:2.75));if(!ok)break;fuera=true;med.salen++;salida=[+nx.toFixed(3),+ny.toFixed(3),+nz.toFixed(3),+dx.toFixed(4),+dy.toFixed(4),+dz.toFixed(4)];}}
    else{if(l===L.id)break;if(l===-2||ny>60)break;
     // (si el paso cambia de casilla en los dos ejes, también pasa por la de la esquina que cruza primero: un rayo que
     // roza la punta de un edificio en menos de un paso lo toca —sin esto, el validador veía a través de las esquinas—)
     {const ax=Math.floor(x/CELL),az=Math.floor(z/CELL),bx=Math.floor(nx/CELL),bz=Math.floor(nz/CELL);if(ax!==bx&&az!==bz){const lx=(dx>0?bx:ax)*CELL,lz=(dz>0?bz:az)*CELL,tx=(lx-x)/dx,tz=(lz-z)/dz,[mx,mz]=tx<tz?[bx,az]:[ax,bz],mi=mz*W+mx,ml=lote[mi],my=Math.min(y,ny);
      if(ml>=0&&ml!==L.id&&my<alto[mi]){med.ven++;if(!V.lotes.has(ml))falla('un lote que se ve desde adentro falta en la lista',{semilla:s,desde:L.id,piso:lv.level,ve:ml,a:+t.toFixed(1),salida});break;}}}
     // (por donde pasa el rayo, abajo de lo más alto de un árbol: esa casilla tiene que estar entre las que se ven)
     if(ny<VISIBLES.arbol){const ci=Math.floor(nz/CELL)*W+Math.floor(nx/CELL);med.celdas++;if(!V.celdas.has(ci))falla('una casilla que se ve desde adentro falta (sus árboles no se dibujarían)',{semilla:s,desde:L.id,piso:lv.level,a:+t.toFixed(1)});}if(l>=0){const cx=Math.floor(nx/CELL),cz=Math.floor(nz/CELL);if(ny<alto[cz*W+cx]){med.ven++;if(!V.lotes.has(l))falla('un lote que se ve desde adentro falta en la lista',{semilla:s,desde:L.id,piso:lv.level,ve:l,a:+t.toFixed(1),salida});break;}}}
    x=nx;y=ny;z=nz;}}}}
const prom=a=>(100*a.reduce((p,v)=>p+v,0)/a.length).toFixed(0);
console.log(`visibles · ${med.pisos} pisos · ${med.rayos} rayos desde adentro, ${med.salen} salen por una abertura, ${med.ven} dan contra un edificio · la lista: ${prom(med.lotes)} % de los lotes (por manzana sería el ${prom(med.manzanas)} %) · casillas que se ven: ${prom(med.celdasLista)} % del mapa (${med.celdas} pasos de rayo revisados)`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

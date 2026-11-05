// El tránsito en el 2D (2026-10-18, Miguel: «que giren orgánicamente, que paren en los semáforos»; engine/transito.js,
// TRANSITO en medidas.js), sin dibujar:
//  · el ciclo: nunca verde o amarillo en los dos ejes a la vez; entre uno y otro, al menos el todo rojo; cada eje con su
//    verde y su amarillo enteros;
//  · frenar ante el rojo: un auto a su velocidad tope (las del tráfico: 6 a 11 m/s), desde 2 a 120 m de la línea, con el
//    mismo control que el 3D (objetivo + paso, a 60 cuadros/s): si le da la frenada máxima, nunca pasa la línea (si no,
//    es el caso del amarillo: abajo), nunca frena más que la máxima y, si
//    venía de lejos (más que su distancia de frenado cómoda), no frena más que la cómoda;
//  · el amarillo: en toda la grilla de velocidad y distancia, o para (con la frenada máxima, a lo sumo PISA m pasada la
//    línea: sobre la cebra) o cruza el cruce entero antes de que el otro eje tenga verde: sin zona de dilema;
//  · las curvas: en cada giro de las ciudades (carriles3d: el cuarto de círculo de carril a carril, a la derecha y a la
//    izquierda) la velocidad del giro da a lo sumo TRANSITO.lateral de costado, y viniendo a la tope frena con la cómoda.
// Uso: node scripts/validar-transito.mjs [ciudades=3] [semilla0=1]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {grillaCarriles,arcoDeGiro} from '../src/engine/carriles3d.js';
import {TRANSITO as T} from '../src/engine/medidas.js';
import {luz,CICLO,parar,curva,amarillo,objetivo,paso,PISA} from '../src/engine/transito.js';
import City from '../src/engine/ciudad.js';
const A=process.argv.slice(2),N=+(A[0]||3),S0=+(A[1]||1),S=CELL,K=City.K,dt=1/60;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={frenadas:0,frenoMax:0,frenoLejos:0,amarillos:0,para:0,sigue:0,giros:0,vGiro:[],latMax:0};
// ---- el ciclo ----
{let ult=null,rojoDesde=null;const dur={h:{verde:0,amarillo:0},v:{verde:0,amarillo:0}};
 for(let t=0;t<CICLO*3;t+=.05){const h=luz(t,'h').luz,v=luz(t,'v').luz;if(h!=='rojo'&&v!=='rojo')falla('los dos ejes con paso a la vez',{t:+t.toFixed(2),h,v});
  if(t<CICLO){if(h!=='rojo')dur.h[h]+=.05;if(v!=='rojo')dur.v[v]+=.05;}
  const quien=h!=='rojo'?'h':v!=='rojo'?'v':null;if(!quien){rojoDesde??=t;}else{if(ult&&quien!==ult&&rojoDesde!=null&&t-rojoDesde<T.semaforo.todoRojo-.06)falla('sin todo rojo entre un eje y el otro',{t:+t.toFixed(2),todoRojo:+(t-rojoDesde).toFixed(2)});ult=quien;rojoDesde=null;}}
 for(const e of ['h','v'])for(const k of ['verde','amarillo'])if(Math.abs(dur[e][k]-T.semaforo[k])>.11)falla('una luz que no dura lo suyo',{eje:e,luz:k,dura:+dur[e][k].toFixed(2),debe:T.semaforo[k]});}
// ---- frenar ante el rojo ----
for(const vmax of [6,8,9.5,11])for(let d0=2;d0<=120;d0+=1.5){let v=vmax,x=0,maxDec=0;med.frenadas++;
 for(let k=0;k<60*60&&v>.01;k++){const meta=objetivo(v,vmax,[{d:d0-x-.3,v:0}],dt),nv=paso(v,meta,dt);maxDec=Math.max(maxDec,(v-nv)/dt);x+=(v+nv)/2*dt;v=nv;}
 med.frenoMax=Math.max(med.frenoMax,maxDec);const lejos=d0>vmax*vmax/(2*T.frena.comoda)+1;if(lejos)med.frenoLejos=Math.max(med.frenoLejos,maxDec);
 if(x>d0+.01&&d0>=vmax*vmax/(2*T.frena.maxima)+.3)falla('pasa la línea de pare en rojo',{vmax,d0,paro:+x.toFixed(2)});
 if(maxDec>T.frena.maxima+1e-6)falla('frena más que la máxima',{vmax,d0,frena:+maxDec.toFixed(2)});
 if(lejos&&maxDec>T.frena.comoda+.05)falla('viniendo de lejos, frena más que la cómoda',{vmax,d0,frena:+maxDec.toFixed(2)});}
// ---- el amarillo: sin zona de dilema ----
for(let v=3;v<=11;v+=.5)for(let d=0;d<=60;d+=.5){med.amarillos++;const dec=amarillo(v,d,T.semaforo.amarillo,12);
 if(dec==='para'){med.para++;if(v*v/(2*T.frena.maxima)>d+PISA+1e-6)falla('para con el amarillo y no le da la frenada máxima (ni pisando la cebra)',{v,d});}
 else{med.sigue++;if((d+12)/v>T.semaforo.amarillo+T.semaforo.todoRojo+1e-6)falla('sigue con el amarillo y no alcanza a cruzar antes del otro verde',{v,d});}}
// ---- la velocidad de giro por radio: de 1 a 12 m (la esquina más cerrada de una calle angosta es de 1,5 m), nunca más de
// lo aceptado de costado salvo en el piso de velocidad (curvaMin), y el piso mismo no pasa de lo aceptado desde 1,5 m ----
for(let r=1;r<=12;r+=.25){const v=curva(r),lat=v*v/r;if(lat>T.lateral+1e-6&&(v>T.curvaMin+1e-6||r>=1.5))falla('un giro de ese radio da más de lo aceptado de costado',{radio:r,v:+v.toFixed(2),lateral:+lat.toFixed(2)});}
// ---- las curvas de las ciudades ----
const D=[[1,0],[-1,0],[0,1],[0,-1]];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),m=bp.map,{W,H}=m,calle=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(m.kind[y*W+x]===K.street||m.kind[y*W+x]===K.avenue),G=grillaCarriles(W,H,calle,S);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!calle(x,y)||G.axis(x,y)!=='j')continue;
  for(const din of D)for(const dout of D){if(din[0]*dout[0]+din[1]*dout[1]!==0)continue;const px=x-din[0],py=y-din[1],nx=x+dout[0],ny=y+dout[1];
   if(!calle(px,py)||!calle(nx,ny)||G.axis(px,py)==='j'||G.axis(nx,ny)==='j'||!G.sentido(px,py,din[0],din[1])||!G.sentido(nx,ny,dout[0],dout[1]))continue;
   const oi=G.laneOff(px,py,din),oo=G.laneOff(nx,ny,dout);if(oi==null||oo==null)continue;const a=arcoDeGiro(din,dout,oi,oo,S);if(!a)continue;med.giros++;
   const vg=curva(a.radio),lat=vg*vg/a.radio;med.vGiro.push(vg);med.latMax=Math.max(med.latMax,lat);
   if(lat>T.lateral+1e-6&&vg>T.curvaMin+1e-6)falla('el giro da más de lo aceptado de costado',{semilla:s,radio:+a.radio.toFixed(2),v:+vg.toFixed(2),lateral:+lat.toFixed(2)});
   // viniendo a la tope (11 m/s) desde lejos: la frenada para llegar a vg es la cómoda
   let v=11,xx=0,maxDec=0;const d0=60;for(let k=0;k<60*30&&xx<d0;k++){const meta=objetivo(v,11,[{d:d0-xx,v:vg}],dt),nv=paso(v,meta,dt);maxDec=Math.max(maxDec,(v-nv)/dt);xx+=(v+nv)/2*dt;v=nv;}
   if(v>vg+.15)falla('llega a la curva más rápido que su velocidad de giro',{semilla:s,llega:+v.toFixed(2),giro:+vg.toFixed(2)});if(maxDec>T.frena.comoda+.05)falla('frena para la curva más que la cómoda',{semilla:s,frena:+maxDec.toFixed(2)});}}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
console.log(`tránsito · ciclo ${CICLO} s (verde ${T.semaforo.verde}, amarillo ${T.semaforo.amarillo}, todo rojo ${T.semaforo.todoRojo}) · ${med.frenadas} frenadas ante el rojo: máx ${med.frenoMax.toFixed(2)} m/s², de lejos ${med.frenoLejos.toFixed(2)} · amarillo: para ${med.para}, sigue ${med.sigue} de ${med.amarillos} · ${med.giros} giros en ${N} ciudades: a ${q(med.vGiro,.1).toFixed(1)}–${q(med.vGiro,.9).toFixed(1)} m/s, de costado hasta ${med.latMax.toFixed(2)} m/s²`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

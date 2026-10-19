// Valida dónde anda el tráfico del 3D (2026-10-16, Miguel: «el movimiento de los carros está mal»; engine/carriles3d.js,
// lo que usa lib/traffic3d.js), en node, contra el 2D:
//  · en cada casilla recta de calzada y en cada sentido permitido, el auto va sobre el carril del 2D de ese sentido
//    (circulacion.js redVehicular: a la derecha, a carril/2 del eje; ≤ 0,3 m);
//  · el auto entero cabe en la calzada (la vereda de CALLE.vereda a cada lado que no es calle): del borde, al menos
//    medio ancho del vehículo más ancho que pasa por ahí (el bus sólo por avenidas) y 10 cm;
//  · ningún sentido en contramano: en una calle de dos filas cada fila va por la derecha;
//  · cada giro a la derecha en una esquina de manzana es un cuarto de círculo con centro en la esquina, y el costado de
//    adentro del auto no pisa el cordón redondeado (radio CIRCULACION.vehiculo.esquina).
// Uso: node scripts/validar-trafico.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint,CELL} from '../src/engine/blueprint.js';
import {grillaCarriles,arcoDeGiro} from '../src/engine/carriles3d.js';
import {redVehicular} from '../src/engine/circulacion.js';
import {CALLE,CIRCULACION} from '../src/engine/medidas.js';
import City from '../src/engine/ciudad.js';

const N=+(process.argv[2]||4),S0=+(process.argv[3]||1),K=City.K,S=CELL,AUTO=1.76,BUS=2.45;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={casillas:0,giros:0,dist:[],holgura:[],holguraGiro:[]};const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const D=[[1,0],[-1,0],[0,1],[0,-1]];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),m=bp.map,{W,H}=m,kind=m.kind;
 const calle=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(kind[y*W+x]===K.street||kind[y*W+x]===K.avenue);
 const G=grillaCarriles(W,H,calle,S),red=redVehicular(bp);
 const tramos=[];for(const c of red.carriles)for(let i=1;i<c.puntos.length;i++)tramos.push([c.puntos[i-1],c.puntos[i]]);
 const alCarril=(x,z,fx,fz)=>{let b=1e9;for(const [a,c] of tramos){const dx=c.x-a.x,dz=c.z-a.z,L=dx*dx+dz*dz;if(!L||(dx*fx+dz*fz)<=0)continue;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L));b=Math.min(b,Math.hypot(a.x+dx*t-x,a.z+dz*t-z));}return b;};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const ax=G.axis(x,y);if(!calle(x,y)||(ax!=='h'&&ax!=='v'))continue;
  for(const d of D){if(!G.sentido(x,y,d[0],d[1]))continue;const P=G.puntoDeCarril(x,y,d);if(!P)continue;med.casillas++;
   const dd=alCarril(P.x,P.z,d[0],d[1]);med.dist.push(dd);if(dd>.3)falla('el carril del 3D no es el del 2D',{semilla:s,casilla:[x,y],sentido:d,m:+dd.toFixed(2)});
   // la calzada a lo ancho: la sección de casillas de calle, menos la vereda de cada lado que no es calle
   let p0,p1,c;if(d[0]){p0=y;p1=y;while(calle(x,p0-1))p0--;while(calle(x,p1+1))p1++;c=P.z;}else{p0=x;p1=x;while(calle(p0-1,y))p0--;while(calle(p1+1,y))p1++;c=P.x;}
   const n=p1-p0+1,v=CALLE.vereda,lo=p0*S+v,hi=(p1+1)*S-v,ancho=n>=CALLE.avenida.casillas?BUS:AUTO,h=Math.min(c-lo,hi-c)-ancho/2;med.holgura.push(h);
   if(h<.1)falla('el auto no cabe en la calzada (pisa la vereda)',{semilla:s,casilla:[x,y],sentido:d,holgura:+h.toFixed(2)});
   // contramano: el carril tiene que quedar a la derecha del eje de la sección
   const eje=(p0+p1+1)/2*S,der=d[0]?(c-eje)*d[0]:(eje-c)*d[1];if(der<=0)falla('carril en contramano (a la izquierda del eje)',{semilla:s,casilla:[x,y],sentido:d});}}
 // los giros a la derecha en las esquinas de manzana: en la casilla de cruce, viniendo de una calle (din) y saliendo a otra (dout)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!calle(x,y)||G.axis(x,y)!=='j')continue;
  for(const din of D)for(const dout of D){if(din[0]*dout[0]+din[1]*dout[1]!==0)continue;if(din[0]*dout[1]-din[1]*dout[0]<=0)continue;// (sólo a la derecha: dout = la derecha de din, (−dz, dx))
   const px=x-din[0],py=y-din[1],nx=x+dout[0],ny=y+dout[1];if(!calle(px,py)||!calle(nx,ny)||G.axis(px,py)==='j'||G.axis(nx,ny)==='j')continue;
   if(!G.sentido(px,py,din[0],din[1])||!G.sentido(nx,ny,dout[0],dout[1]))continue;
   // la esquina de manzana del lado de adentro del giro: la casilla en diagonal (delante a la derecha) no es calle
   const ex=x-din[0]+dout[0],ey=y-din[1]+dout[1];if(calle(ex,ey))continue;
   const oi=G.laneOff(px,py,din),oo=G.laneOff(nx,ny,dout);if(oi==null||oo==null)continue;med.giros++;
   const arco=arcoDeGiro(din,dout,oi,oo,S),esq=[(dout[0]-din[0])*S/2,(dout[1]-din[1])*S/2];
   if(!arco){falla('giro a la derecha que no es un cuarto de círculo',{semilla:s,casilla:[x,y],din,dout,oi,oo});continue;}
   const dc=Math.hypot(arco.centro[0]-esq[0],arco.centro[1]-esq[1]),ancho=G.hR[y*W+x]&&Math.min(G.hR[py*W+px]||9,G.vR[py*W+px]||9)>=3?BUS:AUTO,h=arco.radio-ancho/2-dc-CIRCULACION.vehiculo.esquina;med.holguraGiro.push(h);
   if(h<0)falla('el giro a la derecha pisa el cordón de la esquina',{semilla:s,casilla:[x,y],din,dout,radio:+arco.radio.toFixed(2),centroAlaEsquina:+dc.toFixed(2),holgura:+h.toFixed(2)});}}}
console.log(`tráfico · ${med.casillas} carriles de casilla recta · al carril del 2D: mediana ${q(med.dist,.5).toFixed(2)}, máx ${q(med.dist,1).toFixed(2)} m · holgura a la vereda: mín ${q(med.holgura,0).toFixed(2)} m · ${med.giros} giros a la derecha, holgura al cordón: mín ${q(med.holguraGiro,0).toFixed(2)} m`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

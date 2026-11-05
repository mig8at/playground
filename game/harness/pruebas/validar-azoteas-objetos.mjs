// Lo que hay en las azoteas (2026-10-18, engine/azoteas.js; medidas.js AZOTEA.objetos), en el 2D, en 4 ciudades:
//  · cada objeto, dentro de su techo; los que no son materas, a ≥ AZOTEA.objetos.borde del borde (la pista para tomar
//    carrera y saltar queda libre) y separados entre sí al menos AZOTEA.objetos.paso;
//  · la salida del ascensor, libre;
//  · lo que ocupan, a lo sumo AZOTEA.objetos.ocupa del techo;
//  · se camina: en una grilla de 0,5 m, el piso libre del techo (lejos de cada objeto más que el radio del cuerpo) es una
//    sola pieza, y desde ahí se llega a ≥ 95 % de la franja del borde (de donde se salta).
// Uso: node scripts/validar-azoteas-objetos.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {AZOTEA,CIRCULACION} from '../src/engine/medidas.js';
import {cajaDe} from '../src/engine/azoteas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),O=AZOTEA.objetos,RC=CIRCULACION.peaton.radio,G=.5,E=1e-6;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={techos:0,conObjetos:0,objetos:{},ocupaMax:0,franja:[],piezas:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const [li,L] of bp.lots.entries()){if(!L.parts?.length||L.fachada?.techo==='mansarda'||(L.floors||0)<2)continue;med.techos++;const os=L.azotea?.objetos||[];if(!os.length)continue;med.conObjetos++;const ej={semilla:s,lote:li,tipo:L.type};
  const en=(x,z)=>L.parts.some(p=>x>p.x-E&&x<p.x+p.w+E&&z>p.y-E&&z<p.y+p.h+E);
  const cajaDentro=(c,m)=>{for(let t=0;t<=8;t++){const u=t/8;for(const [x,z] of [[c.x0-m+u*(c.x1-c.x0+2*m),c.z0-m],[c.x0-m+u*(c.x1-c.x0+2*m),c.z1+m],[c.x0-m,c.z0-m+u*(c.z1-c.z0+2*m)],[c.x1+m,c.z0-m+u*(c.z1-c.z0+2*m)]])if(!en(x,z))return false;}return true;};
  const area=L.parts.reduce((a,p)=>a+p.w*p.h,0);let ocupa=0;
  const core=L.levels?.find(l=>l.core?.lift)?.core;
  os.forEach((o,i)=>{med.objetos[o.tipo]=(med.objetos[o.tipo]||0)+1;const c=cajaDe(o);ocupa+=o.w*o.d;
   if(!cajaDentro(c,0))falla('objeto fuera de su techo',{...ej,o:o.tipo});
   else if(o.tipo!=='matera'&&!cajaDentro(c,O.borde-.01))falla('objeto en la pista del borde',{...ej,o:o.tipo});
   if(core&&c.x0<core.x+core.w+O.salida-E&&c.x1>core.x-O.salida+E&&c.z0<core.y+core.h+O.salida-E&&c.z1>core.y-O.salida+E)falla('objeto en la salida del ascensor',{...ej,o:o.tipo});
   for(let j=0;j<i;j++){const q=cajaDe(os[j]),gx=Math.max(q.x0-c.x1,c.x0-q.x1),gz=Math.max(q.z0-c.z1,c.z0-q.z1),gap=Math.max(gx,gz);if(gap<O.paso-.01&&!(o.tipo==='matera'&&os[j].tipo==='matera'))falla('objetos sin paso entre ellos',{...ej,a:o.tipo,b:os[j].tipo,gap:+gap.toFixed(2)});}});
  med.ocupaMax=Math.max(med.ocupaMax,ocupa/area);if(ocupa>area*O.ocupa+E)falla('los objetos ocupan demasiado del techo',{...ej,parte:+(ocupa/area).toFixed(3)});
  // se camina: la grilla del piso libre
  const xs=L.parts.map(p=>[p.x,p.x+p.w]).flat(),zs=L.parts.map(p=>[p.y,p.y+p.h]).flat(),X0=Math.min(...xs),Z0=Math.min(...zs),NX=Math.round((Math.max(...xs)-X0)/G),NZ=Math.round((Math.max(...zs)-Z0)/G);
  const libre=new Uint8Array(NX*NZ),franja=[];for(let i=0;i<NX;i++)for(let k=0;k<NZ;k++){const x=X0+(i+.5)*G,z=Z0+(k+.5)*G;if(!en(x,z))continue;
   if(os.some(o=>{const c=cajaDe(o);return x>c.x0-RC&&x<c.x1+RC&&z>c.z0-RC&&z<c.z1+RC;}))continue;libre[i*NZ+k]=1;
   if(!(en(x-O.borde,z)&&en(x+O.borde,z)&&en(x,z-O.borde)&&en(x,z+O.borde)))franja.push(i*NZ+k);}
  const vis=new Uint8Array(NX*NZ);let piezas=0,mayor=null;for(let s0=0;s0<libre.length;s0++){if(!libre[s0]||vis[s0])continue;piezas++;const comp=[s0];vis[s0]=1;for(let h=0;h<comp.length;h++){const c=comp[h],i=Math.floor(c/NZ),k=c%NZ;
   for(const [di,dk] of [[1,0],[-1,0],[0,1],[0,-1]]){const ii=i+di,kk=k+dk;if(ii<0||kk<0||ii>=NX||kk>=NZ)continue;const n=ii*NZ+kk;if(libre[n]&&!vis[n]){vis[n]=1;comp.push(n);}}}if(!mayor||comp.length>mayor.size)mayor=new Set(comp);}
  med.piezas=Math.max(med.piezas,piezas);
  const llega=franja.filter(c=>mayor?.has(c)).length/Math.max(1,franja.length);med.franja.push(llega);if(llega<.95)falla('el borde no se alcanza desde la azotea',{...ej,parte:+llega.toFixed(2)});}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
console.log(`azoteas con objetos · ${N} ciudades · ${med.conObjetos} de ${med.techos} techos · ${Object.entries(med.objetos).map(([k,v])=>k+' '+v).join(', ')} · ocupan a lo sumo ${(100*med.ocupaMax).toFixed(1)} % (máximo ${100*O.ocupa} %) · franja del borde alcanzable: p1 ${(100*q(med.franja,.01)).toFixed(0)} % · piezas de piso libre: hasta ${med.piezas}`);
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`fallas: ${tot}`);

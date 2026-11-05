// Valida las piezas de fachada low poly propias (2026-10-16, src/lib/fachada3d.js), en node, con las medidas de las
// piezas originales leídas de sus .gltf (los accesores de posición, por material):
//  · cada pieza de fachada que puede pedir una fachada (fachada.js FACADE_PIECES, y las de downtown3d STYLES) tiene la suya;
//  · el vidrio es EL MISMO del original (el 2D calcula la luz de cada cuarto con él: VIDRIO de medidas.js), y en las
//    ventanas de WINDOWS, el de VIDRIO.ventana;
//  · nada se sale de la huella (el ancho y el alto del original; hacia afuera, como mucho lo suyo más 0,25 m) y ningún
//    muro tapa el vano.
// Uso: node scripts/validar-fachada3d.mjs
import {readFileSync,existsSync} from 'node:fs';
import {ES_DE_FACHADA,piezaLowPoly,puertaDobleLowPoly,PARED} from '../src/lib/fachada3d.js';
import {FACADE_PIECES,WINDOWS,STYLES,FAMILIES,facadeStyle,VIDRIO_PIEZA,DOUBLES} from '../src/engine/fachada.js';
import {VIDRIO,PUERTA,COLUMNA,VENTANAS_FAMILIA} from '../src/engine/medidas.js';

const DIR='public/models/downtown/Exports/glTF (Godot)/';
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// las medidas por material de una pieza (sus nodos no tienen transformaciones: los accesores ya están en su marco)
const medidas=n=>{const f=DIR+n+'.gltf';if(!existsSync(f))return null;const g=JSON.parse(readFileSync(f,'utf8')),M={};let X=[1e9,-1e9],Y=[1e9,-1e9];
 for(const m of g.meshes)for(const p of m.primitives){const mat=g.materials[p.material]?.name||'?';if(mat.startsWith('MI_FakeInterior'))continue;const a=g.accessors[p.attributes.POSITION],B=M[mat]||(M[mat]={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]});
  for(let i=0;i<3;i++){B.min[i]=Math.min(B.min[i],a.min[i]);B.max[i]=Math.max(B.max[i],a.max[i]);}X=[Math.min(X[0],a.min[0]),Math.max(X[1],a.max[0])];Y=[Math.min(Y[0],a.min[1]),Math.max(Y[1],a.max[1])];}
 M.__x=X;M.__y=Y;return M;};
const MURO=new Set(['MI_RedBrick','MI_RedBrick_Pale','MI_Trim_MetalConcrete','MI_Concrete','MI_InteriorWall']);
const deVentana=Object.fromEntries(Object.entries(WINDOWS).map(([k,w])=>[w.p,k]));
const todas=[...new Set(FACADE_PIECES)].filter(ES_DE_FACHADA);let n=0,vidrios=0,cajas=0;
for(const nombre of todas){const M=medidas(nombre);if(!M){falla('pieza sin su .gltf',{nombre});continue;}n++;
 const C=piezaLowPoly(nombre,M);cajas+=C.length;if(!C.length){falla('pieza sin versión propia',{nombre});continue;}
 // (hacia afuera y hacia adentro, como mucho lo del original más 0,25 —el alféizar, el dintel, la cornisa—)
 const X=M.__x,Y=M.__y,Zs=Object.entries(M).filter(([k])=>!k.startsWith('__')).map(([,v])=>v),Z=[Math.min(...Zs.map(v=>v.min[2])),Math.max(...Zs.map(v=>v.max[2]))];
 // (las columnas de esquina no: son el pilar de COLUMNA, que town3d corre hacia afuera de la esquina)
 if(!/Column_(Bottom|Center|Top)|CornerColumn/.test(nombre))for(const c of C){if(c.x0<X[0]-.01||c.x1>X[1]+.01||c.y0<Y[0]-.02||c.y1>Y[1]+.02||c.z1>Z[1]+.25||c.z0<Z[0]-.05){falla('pieza que se sale de su huella',{nombre,mat:c.mat,caja:[c.x0,c.x1,c.y0,c.y1,c.z0,c.z1].map(v=>+v.toFixed(2))});break;}}
 const g=M.MI_Glass;if(!g)continue;vidrios++;
 // (una puerta con el vidrio en la hoja —no una banderola arriba—: el vidrio va en la hoja, no en el marco)
 if(/DoorFrame/.test(nombre)&&g.min[1]<=1.9)continue;const v=C.filter(c=>c.mat==='MI_Glass');
 if(v.length!==1){falla('ventana sin un vidrio (o con varios)',{nombre,vidrios:v.length});continue;}const gv=v[0],E=.005;
 if(Math.abs(gv.x0-g.min[0])>E||Math.abs(gv.x1-g.max[0])>E||Math.abs(gv.y0-g.min[1])>E||Math.abs(gv.y1-g.max[1])>E)falla('vidrio distinto del original',{nombre});
 const k=deVentana[nombre];if(k&&VIDRIO.ventana[k]){const a=(gv.x1-gv.x0)*(gv.y1-gv.y0),b=VIDRIO.ventana[k];if(Math.abs(a-b)>.02*b)falla('vidrio distinto del que el 2D usa para la luz (VIDRIO.ventana)',{nombre,tipo:k,dibujo:+a.toFixed(3),plano:+b.toFixed(3)});}
 // ningún muro sobre el vidrio
 for(const c of C){if(!MURO.has(c.mat))continue;const ox=Math.min(c.x1,gv.x1)-Math.max(c.x0,gv.x0),oy=Math.min(c.y1,gv.y1)-Math.max(c.y0,gv.y0);if(ox>.01&&oy>.01){falla('un muro tapa el vano',{nombre,mat:c.mat});break;}}}
// Las caras que titilan (2026-10-16, Miguel: «veo mucho ruido al moverme, un parpadeo incómodo»): dos cajas de la misma
// pieza con una cara en el MISMO plano y mirando al mismo lado, que se pisan —la GPU no sabe cuál va delante y alterna
// al mover la cámara (z-fighting)—. Sólo cuentan si los materiales difieren (si son iguales se ven igual).
const titilan=(C,nombre)=>{const out=[];for(let i=0;i<C.length;i++)for(let j=i+1;j<C.length;j++){const a=C[i],b=C[j];if(a.mat===b.mat)continue;
 for(const [k,u,v] of [['x','y','z'],['y','x','z'],['z','x','y']])for(const lado of ['0','1']){if(Math.abs(a[k+lado]-b[k+lado])>1e-4)continue;
  const ou=Math.min(a[u+'1'],b[u+'1'])-Math.max(a[u+'0'],b[u+'0']),ov=Math.min(a[v+'1'],b[v+'1'])-Math.max(a[v+'0'],b[v+'0']);
  if(ou>.002&&ov>.002)out.push({nombre,cara:k+lado,en:+a[k+lado].toFixed(3),mats:[a.mat,b.mat],area:+(ou*ov).toFixed(3)});}}return out;};
let caras=0;for(const nombre of todas){const M=medidas(nombre);if(!M)continue;for(const t of titilan(piezaLowPoly(nombre,M),nombre)){caras++;falla('caras en el mismo plano que titilan',t);}}
for(const m of PARED)for(const t of titilan(puertaDobleLowPoly(m,PUERTA.doble.ancho),'puerta doble '+m)){caras++;falla('caras en el mismo plano que titilan',t);}
// La tabla del vidrio de cada ventana (VIDRIO_PIEZA, de donde salen las cortinas): la de cada pieza simple y doble, igual
// a su .gltf (±1 cm), y ninguna ventana sin la suya.
for(const n of new Set([...Object.values(WINDOWS).map(w=>w.p),...Object.values(DOUBLES).map(d=>d.p).filter(Boolean)])){const g=medidas(n)?.MI_Glass,t=VIDRIO_PIEZA[n];
 if(!t){falla('ventana sin su vidrio en VIDRIO_PIEZA',{n});continue;}if(!g)continue;const real=[g.min[0],g.max[0],g.min[1],g.max[1]];if(real.some((v,i)=>Math.abs(v-t[i])>.01))falla('VIDRIO_PIEZA distinto del .gltf',{n,tabla:t,gltf:real.map(v=>+v.toFixed(2))});}
// Las columnas de esquina contra las ventanas (2026-10-16, Miguel: «la decoración de columna oculta las ventanas»): en cada
// estilo, lo que el pilar se mete en la fachada desde la esquina (sus cajas, corridas hacia afuera como en town3d) no
// llega al vidrio de ninguna ventana que el estilo puede poner en el módulo de la esquina —la vidriera abajo; arriba, las
// del estilo y las de su familia (las que el plano elige por luz)—: el módulo es de 2 m y su centro está a 1 m de la esquina.
const vidrioDesde=n=>{const g=medidas(n)?.MI_Glass;return g?1-Math.max(-g.min[0],g.max[0]):null;};let columnas=0,cerca=9;
for(const [e] of Object.entries(STYLES)){const fs=facadeStyle({estilo:e}),F=FAMILIES[fs.spec.familia],co=COLUMNA.lado/2-COLUMNA.dentro;
 const arriba=[...new Set([fs.win1,fs.win,...(VENTANAS_FAMILIA[fs.spec.familia]||[]).map(k=>WINDOWS[k].p)])];
 for(const [col,vent] of [[fs.columnBottom,[F.shop]],[fs.column,arriba],[fs.columnTop,arriba]]){const M=medidas(col);if(!M){falla('columna sin su .gltf',{col});continue;}columnas++;
  const C=piezaLowPoly(col,M),mete=Math.max(...C.flatMap(c=>[-c.x0,c.x1,-c.z0,c.z1]))-co;
  for(const v of vent){const d=vidrioDesde(v);if(d==null)continue;cerca=Math.min(cerca,d-mete);if(mete>d-.02)falla('la columna de esquina tapa el vidrio de una ventana',{estilo:e,columna:col,ventana:v,mete:+mete.toFixed(2),vidrioDesde:+d.toFixed(2)});}}}
// la puerta doble: el vano libre (sin muro ni marco) de al menos PUERTA.doble.ancho y 2,2 m de alto (las hojas), y dentro del módulo
const MARCO=new Set(['MI_Trim']);let dobles=0;
for(const m of PARED){const C=puertaDobleLowPoly(m,PUERTA.doble.ancho),a=PUERTA.doble.ancho/2;dobles++;
 for(const c of C){if(c.x0<-1.01||c.x1>1.01||c.y1>3.01){falla('puerta doble que se sale del módulo',{pared:m});break;}
  if(c.mat==='MI_Glass')continue;const ox=Math.min(c.x1,a)-Math.max(c.x0,-a),oy=Math.min(c.y1,2.2)-Math.max(c.y0,0);if(ox>.005&&oy>.005){falla('algo tapa el vano de la puerta doble',{pared:m,mat:c.mat,caja:[c.x0,c.x1,c.y0,c.y1].map(v=>+v.toFixed(2))});break;}}}
console.log(`columnas de esquina · ${columnas} revisadas contra las ventanas de su estilo · lo más cerca que quedan del vidrio: ${cerca.toFixed(2)} m`);
console.log(`fachada low poly · ${n} piezas propias (${cajas} cajas, ${caras} pares de caras que titilan) · ${vidrios} con vidrio, todas con el del original y el de VIDRIO · puerta doble (${dobles} muros): vano libre de ${PUERTA.doble.ancho} m`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);

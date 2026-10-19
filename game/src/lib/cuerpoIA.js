// El cuerpo con IA (2026-10-13): un muñeco generado (imagen → Hunyuan) llevado a NUESTRO esqueleto, de dos maneras:
//  (a) piel nueva: la malla generada, alineada por partes a la pose de atado y con los pesos de nuestra piel actual;
//  (b) referencia: nuestra piel actual (su topología, pesos y piezas) encogida sobre la superficie generada.
// Los dos parten de alignBody: los puntos clave de cada cuerpo en pose T (suela, tobillo, entrepierna, línea de los
// brazos, hombro, punta de la mano, cuello, coronilla) y un mapeo por tramos entre ellos, con mezclas suaves en el
// hombro y la entrepierna para que no se abran grietas.
import * as THREE from 'three';
import {skinSurface,weightsAt} from './ropa3d.js';

const ss=THREE.MathUtils.smoothstep;
// Puntos clave de un cuerpo en pose T (frente +z, arriba +y). pts: [[x,y,z],...]
export function landmarks(pts){
 const ys=pts.map(p=>p[1]),sole=Math.min(...ys),top=Math.max(...ys),H=top-sole,N=240,sl=[...Array(N)].map(()=>[]);
 for(const p of pts)sl[Math.min(N-1,Math.floor((p[1]-sole)/H*N))].push(p);
 const yAt=k=>sole+H*(k+.5)/N,tip=Math.max(...pts.map(p=>Math.abs(p[0])));
 const armPts=pts.filter(p=>Math.abs(p[0])>tip*.6),mean=(a,i)=>a.reduce((s,p)=>s+p[i],0)/(a.length||1);
 const armY=mean(armPts,1),armZ=mean(armPts,2),armR=Math.sqrt(mean(armPts.map(p=>[(p[1]-armY)**2+(p[2]-armZ)**2]),0));
 // entrepierna: la franja más alta, debajo del brazo, sin puntos en el medio
 const eps=H*.012;let crotch=0;for(let k=0;k<N;k++){if(yAt(k)>armY-armR*3)break;if(sl[k].length&&!sl[k].some(p=>Math.abs(p[0])<eps))crotch=k;}
 // hombro: el medio ancho del tronco justo debajo de los brazos
 const kChest=Math.max(0,Math.floor((armY-armR*2.5-sole)/H*N)),chest=sl[kChest].map(p=>Math.abs(p[0])),shoulder=chest.length?Math.max(...chest):H*.1;
 // cuello: lo más angosto (dentro del ancho del tronco) entre los brazos y la cabeza
 let neck=0,bw=Infinity;for(let k=Math.floor((armY+armR-sole)/H*N);k<N*.95;k++){const s=sl[k].filter(p=>Math.abs(p[0])<shoulder*1.2);if(s.length<4)continue;const w=Math.max(...s.map(p=>Math.abs(p[0])));if(w<bw){bw=w;neck=k;}if(yAt(k)>armY+H*.25)break;}
 // tobillo: lo más angosto de una pierna en el 15 % de abajo
 let ankle=0,aw=Infinity;for(let k=2;k<N*.15;k++){const s=sl[k].filter(p=>p[0]>eps);if(s.length<3)continue;const xs=s.map(p=>p[0]),w=Math.max(...xs)-Math.min(...xs);if(w<aw){aw=w;ankle=k;}}
 const legs=pts.filter(p=>p[0]>eps&&p[1]<yAt(crotch)),legX=mean(legs,0),torso=pts.filter(p=>Math.abs(p[0])<shoulder&&p[1]>yAt(crotch)&&p[1]<armY-armR),torsoZ=mean(torso,2);
 return {sole,top,H,ankle:yAt(ankle),crotch:yAt(crotch)+H/N/2,armY,armZ,armR,shoulder,tip,neck:yAt(neck),legX,torsoZ};}

const lerpKnots=(v,a,b)=>{for(let i=0;i<a.length-1;i++)if(v<=a[i+1]||i===a.length-2){const t=(v-a[i])/((a[i+1]-a[i])||1);return b[i]+(b[i+1]-b[i])*t;}return v;};
// Mapeo por tramos de los puntos clave de «t» (el generado) a los de «o» (el nuestro).
export function alignMap(t,o){
 const s=o.H/t.H,ky=[t.sole,t.ankle,t.crotch,t.neck,t.top],oy=[o.sole,o.ankle,o.crotch,o.neck,o.top];
 return p=>{const [x,y,z]=p,ax=Math.abs(x),sg=Math.sign(x)||1;
  // cuerpo, piernas y cabeza: alturas por tramos; ancho y fondo con la escala general (las piernas, desde su eje)
  const legW=1-ss(y,t.crotch-t.H*.03,t.crotch+t.H*.02),bx=sg*((1-legW)*ax*s+legW*(o.legX+(ax-t.legX)*s));
  const body=[bx,lerpKnots(y,ky,oy),o.torsoZ+(z-t.torsoZ)*s];
  // brazos: el largo por tramos (hombro → punta) y el grosor alrededor de la línea del brazo
  const arm=[sg*lerpKnots(ax,[t.shoulder,t.tip],[o.shoulder,o.tip]),o.armY+(y-t.armY)*s,o.armZ+(z-t.armZ)*s];
  const wa=y<t.neck?ss(ax,t.shoulder*.9,t.shoulder*1.25)*(1-ss(Math.abs(y-t.armY),t.armR*2.5,t.armR*4)):0;
  return [0,1,2].map(i=>body[i]*(1-wa)+arm[i]*wa);};}

const pointsOf=g=>{const P=g.attributes.position,out=[];for(let i=0;i<P.count;i++)out.push([P.getX(i),P.getY(i),P.getZ(i)]);return out;};
// (a) La malla generada como piel: alineada, con los pesos del punto más cercano de nuestra piel.
export function newSkin(generated,ourSkin){
 const g=(generated.index?generated.toNonIndexed():generated.clone()),t=landmarks(pointsOf(g)),o=landmarks(pointsOf(ourSkin)),map=alignMap(t,o),P=g.attributes.position;
 for(let i=0;i<P.count;i++){const q=map([P.getX(i),P.getY(i),P.getZ(i)]);P.setXYZ(i,q[0],q[1],q[2]);}
 const near=skinSurface(ourSkin,{cache:false}),J=new Uint16Array(P.count*4),W=new Float32Array(P.count*4),v=new THREE.Vector3();let far=0;
 for(let i=0;i<P.count;i++){const n=near(v.fromBufferAttribute(P,i));if(!n){W[i*4]=1;continue;}far=Math.max(far,n.distance);const w=weightsAt(ourSkin,n.ids,n.bary);J.set(w.j,i*4);W.set(w.w,i*4);}
 g.setAttribute('skinIndex',new THREE.BufferAttribute(J,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(W,4));for(const k of Object.keys(g.attributes))if(!['position','skinIndex','skinWeight'].includes(k))g.deleteAttribute(k);
 return {geometry:g,landmarks:{t,o},maxDistance:far};}
// (b) Nuestra piel encogida sobre la superficie generada (ya alineada): cada vértice va al punto más cercano.
export function shrinkSkin(ourSkin,generated,amount=1){
 const g=(generated.index?generated.toNonIndexed():generated.clone()),t=landmarks(pointsOf(g)),o=landmarks(pointsOf(ourSkin)),map=alignMap(t,o),P=g.attributes.position;
 for(let i=0;i<P.count;i++){const q=map([P.getX(i),P.getY(i),P.getZ(i)]);P.setXYZ(i,q[0],q[1],q[2]);}
 for(const k of Object.keys(g.attributes))if(k!=='position')g.deleteAttribute(k);
 const near=skinSurface(g,{cache:false}),S=ourSkin.attributes.position,out=new Float32Array(S.count*3),v=new THREE.Vector3(),moved=new Map();let mean=0;
 for(let i=0;i<S.count;i++){v.fromBufferAttribute(S,i);const k=v.toArray().map(x=>Math.round(x*1e5)).join(',');let q=moved.get(k);if(!q){const n=near(v);q=n?v.clone().lerp(n.p,amount):v.clone();moved.set(k,q);mean+=n?n.distance:0;}out.set([q.x,q.y,q.z],i*3);}
 return {positions:out,landmarks:{t,o},meanDistance:mean/(moved.size||1)};}

// Una calcomanía (la cara) apoyada sobre otra superficie: cada vértice al punto más cercano, un poco hacia afuera.
export function projectDecal(decal,surface,lift=.008){
 const near=skinSurface(surface,{cache:false}),P=decal.attributes.position,v=new THREE.Vector3();
 for(let i=0;i<P.count;i++){const n=near(v.fromBufferAttribute(P,i));if(!n)continue;const q=n.p.clone().addScaledVector(n.n,lift);P.setXYZ(i,q.x,q.y,q.z);}P.needsUpdate=true;}
// Lo que va pegado a la piel se mueve como su vértice de piel más cercano (before/after: posiciones de la piel).
export function followDisplacement(g,before,after){
 const P=g.attributes.position,n=before.length/3,cell=.1,grid=new Map(),key=(x,y,z)=>x+','+y+','+z;
 for(let i=0;i<n;i++){const k=key(Math.floor(before[i*3]/cell),Math.floor(before[i*3+1]/cell),Math.floor(before[i*3+2]/cell));(grid.get(k)||grid.set(k,[]).get(k)).push(i);}
 for(let v=0;v<P.count;v++){const x=P.getX(v),y=P.getY(v),z=P.getZ(v),ix=Math.floor(x/cell),iy=Math.floor(y/cell),iz=Math.floor(z/cell);let best=-1,bd=Infinity;
  for(let r=1;r<=4&&best<0;r++)for(let a=ix-r;a<=ix+r;a++)for(let b=iy-r;b<=iy+r;b++)for(let c=iz-r;c<=iz+r;c++)for(const i of grid.get(key(a,b,c))||[]){const d=(before[i*3]-x)**2+(before[i*3+1]-y)**2+(before[i*3+2]-z)**2;if(d<bd){bd=d;best=i;}}
  if(best>=0)P.setXYZ(v,x+after[best*3]-before[best*3],y+after[best*3+1]-before[best*3+1],z+after[best*3+2]-before[best*3+2]);}
 P.needsUpdate=true;}

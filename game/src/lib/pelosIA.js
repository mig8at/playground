// Pelos generados por IA (2026-10-13): una cabeza low poly generada desde la lámina de referencia (fal.ai → Meshy) se
// lleva a NUESTRA cabeza y se queda sólo el pelo. Dos pasos:
//  - bakeHair (en el navegador, una vez por peinado): separa los triángulos por el color de la textura (pelo marrón,
//    piel clara, ojos/cejas casi negros), orienta la cabeza por los ojos, la escala por el ancho de la piel y la sube a
//    la altura de nuestras cejas; guarda sólo el pelo, con el sombreado relativo de cada cara (así se recolorea).
//  - loadHair (en el juego): baja ese JSON; vestier3d lo pega al hueso de la cabeza.
import * as THREE from 'three';

// Nuestra cabeza (pose de atado, unidades del modelo): ancho ±.49, cejas arriba en y 2.758, frente en +z; ojos y cejas
// ocupan x ±.369.
const HEAD={half:.49,browTop:2.758,frontZ:.49,featWidth:.738};

function sampler(texture){
 const img=texture.image,cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;
 const g=cv.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);const d=g.getImageData(0,0,cv.width,cv.height).data;
 return (u,v)=>{if(texture.flipY===false)v=v;else v=1-v;const x=Math.min(cv.width-1,Math.max(0,Math.floor((u-Math.floor(u))*cv.width))),y=Math.min(cv.height-1,Math.max(0,Math.floor((v-Math.floor(v))*cv.height))),i=(y*cv.width+x)*4;
  return [d[i]/255,d[i+1]/255,d[i+2]/255];};}
// (sin «...»: con mallas de cientos de miles de puntos el spread desborda la pila)
const maxOf=a=>{let m=-Infinity;for(const x of a)if(x>m)m=x;return m;},minOf=a=>{let m=Infinity;for(const x of a)if(x<m)m=x;return m;};
const hsv=([r,g,b])=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b);return {v:mx,s:mx?(mx-mn)/mx:0};};
// (pelo: marrón medio u oscuro; piel: clara; rasgos: casi negros)
export const kindOf=c=>{const {v,s}=hsv(c);if(v<.2)return 'rasgo';if(v<.62&&s>.3)return 'pelo';return 'piel';};

// (cada modelo pinta distinto la piel en sombra: con umbrales fijos, en Hunyuan el cuello salía como pelo. Fuera de
// los rasgos casi negros, dos grupos de color —k-medias en RGB, empezando por el más oscuro y el más claro—; el oscuro
// es el pelo)
function reclassify(tris,{backSeed=false}={}){
 // Referencias propias de cada modelo (la textura trae la luz pintada y cada modelo la pinta distinto): el PELO es el
 // color de la coronilla (lo más alto) y la PIEL el de la mejilla (adelante, a la altura de los ojos, sin los rasgos).
 // Cada triángulo va con la más cercana en tono —proporción de canales, casi no cambia con la sombra— y algo de brillo.
 const rest=tris.filter(t=>t.kind!=='rasgo'),feat=tris.filter(t=>t.kind==='rasgo');if(rest.length<10||!feat.length)return;
 const cen=t=>[0,1,2].map(i=>(t.p[0][i]+t.p[1][i]+t.p[2][i])/3),f=t=>{const s=t.c[0]+t.c[1]+t.c[2]||1;return [t.c[0]/s*3,t.c[2]/s*3,(.299*t.c[0]+.587*t.c[1]+.114*t.c[2])*.6];};
 const avg=ts=>{const a=[0,0,0];for(const t of ts){const v=f(t);a[0]+=v[0];a[1]+=v[1];a[2]+=v[2];}return a.map(x=>x/(ts.length||1));};
 const ys=rest.map(t=>cen(t)[1]).sort((a,b)=>a-b),yTop=ys[Math.floor(ys.length*.97)];
 const fy=feat.reduce((s,t)=>s+cen(t)[1],0)/feat.length,zs=rest.map(t=>cen(t)[2]).sort((a,b)=>a-b),zFront=zs[Math.floor(zs.length*.9)];
 const hairRef=avg(rest.filter(t=>cen(t)[1]>=yTop)),cheek=rest.filter(t=>{const c=cen(t);return Math.abs(c[1]-fy)<(ys[ys.length-1]-ys[0])*.06&&c[2]>=zFront;}),skinRef=avg(cheek.length?cheek:rest);
 const d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;tris.refs={hairRef,skinRef,cheek:cheek.length};
 // Crecimiento de regiones sobre la malla (Dijkstra con dos fuentes): la piel nace en la mejilla y en los rasgos, el pelo
 // en la coronilla; pasar de un triángulo a su vecino cuesta lo que cambia el color. Cada triángulo queda con la región
 // que llega más barata: la frontera cae donde el color SALTA (pelo/piel), no donde la luz cambia de a poco.
 const K=p=>p.map(x=>Math.round(x*1e4)).join(','),edge=new Map(),nb=tris.map(()=>[]);
 tris.forEach((t,i)=>{for(let e=0;e<3;e++){const a=K(t.p[e]),b=K(t.p[(e+1)%3]),k=a<b?a+'|'+b:b+'|'+a,j=edge.get(k);if(j===undefined)edge.set(k,i);else{nb[i].push(j);nb[j].push(i);}}});
 const F=tris.map(f),cost=new Float64Array(tris.length).fill(Infinity),lab=new Int8Array(tris.length).fill(-1),heap=[];
 const push=(c,i,l)=>{heap.push([c,i,l]);let n=heap.length-1;while(n>0){const p=(n-1)>>1;if(heap[p][0]<=heap[n][0])break;[heap[p],heap[n]]=[heap[n],heap[p]];n=p;}};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let n=0;for(;;){const l=2*n+1,r=l+1;let m=n;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===n)break;[heap[m],heap[n]]=[heap[n],heap[m]];n=m;}}return top;};
 const idx=new Map(tris.map((t,i)=>[t,i]));for(const t of cheek)push(0,idx.get(t),0);for(const t of feat)push(0,idx.get(t),0);for(const t of rest.filter(t=>cen(t)[1]>=yTop))push(0,idx.get(t),1);
 // (backSeed, para los recogidos: también la nuca alta, detrás de la cabeza sobre los ojos; con coleta o moño la coronilla
 // es sólo el moño y la gomita corta el paso hacia el resto del pelo. En el rapado o el undercut volvería pelo la nuca)
if(backSeed){const zb=zs[Math.floor(zs.length*.04)];for(const t of rest){const c=cen(t);if(c[2]<=zb&&c[1]>fy)push(0,idx.get(t),1);}
  // (y la parte alta del cráneo: con el pelo tirante —coleta— el cuero cabelludo queda lejos de la coronilla)
  for(const t of rest){const c=cen(t);if(c[1]>fy+(yTop-fy)*.6&&c[2]<zFront-(zFront-zb)*.25)push(0,idx.get(t),1);}}
 while(heap.length){const [c,i,l]=pop();if(c>=cost[i])continue;cost[i]=c;lab[i]=l;for(const j of nb[i]){const dc=Math.sqrt(d2(F[i],F[j]));const nc=c+dc*dc*40+1e-4;if(nc<cost[j])push(nc,j,l);}}
 for(let i=0;i<tris.length;i++)if(tris[i].kind!=='rasgo'&&lab[i]>=0)tris[i].kind=lab[i]===1?'pelo':'piel';}
// (fuera los pedazos sueltos: Hunyuan modela también los restos de la cabeza vecina que asoman en el recorte)
function bigParts(tris,share=.06){const K=p=>p.map(x=>Math.round(x*1e3)).join(','),par=tris.map((_,i)=>i),find=x=>{while(par[x]!==x)x=par[x]=par[par[x]];return x;},owner=new Map();
 tris.forEach((t,i)=>{for(const p of t.p){const k=K(p);if(owner.has(k))par[find(i)]=find(owner.get(k));else owner.set(k,i);}});
 const size=new Map();tris.forEach((_,i)=>{const r=find(i);size.set(r,(size.get(r)||0)+1);});return tris.filter((_,i)=>size.get(find(i))>=tris.length*share);}
// (flat: un solo color para todo el pelo —el de la paleta del juego— y las facetas las marca la luz, como en la lámina)
export async function bakeHair(url,{target=0,debug=false,backSeed=false,flat=false}={}){
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const gltf=await new GLTFLoader().loadAsync(url),tris=[];
 gltf.scene.updateWorldMatrix(true,true);
 gltf.scene.traverse(o=>{if(!o.isMesh)return;let G=o.geometry;if(G.index)G=G.toNonIndexed();const P=G.attributes.position,UV=G.attributes.uv,sample=o.material.map?sampler(o.material.map):null,v=new THREE.Vector3();
  for(let i=0;i<P.count;i+=3){const p=[0,1,2].map(k=>v.fromBufferAttribute(P,i+k).applyMatrix4(o.matrixWorld).toArray());
   let c=[o.material.color.r,o.material.color.g,o.material.color.b];
   if(sample&&UV){const cs=[[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]].map(w=>sample(w[0]*UV.getX(i)+w[1]*UV.getX(i+1)+w[2]*UV.getX(i+2),w[0]*UV.getY(i)+w[1]*UV.getY(i+1)+w[2]*UV.getY(i+2)));c=[0,1,2].map(k=>cs.reduce((s,x)=>s+x[k],0)/cs.length);}
   tris.push({p,c,kind:kindOf(c)});}});
 // (un rasgo es casi negro Y está en la cara, adelante: el pelo oscuro en sombra también es casi negro)
 {const zc=t=>(t.p[0][2]+t.p[1][2]+t.p[2][2])/3,zs=tris.map(zc),zmax=maxOf(zs),depth=zmax-minOf(zs);for(const t of tris)if(t.kind==='rasgo'&&zc(t)<zmax-depth*.18)t.kind='pelo';}
 reclassify(tris,{backSeed});if(debug)return {debug:tris};
 const count=k=>tris.filter(t=>t.kind===k).length,center=ts=>{const s=[0,0,0];let n=0;for(const t of ts)for(const p of t.p){s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];n++;}return s.map(x=>x/(n||1));};
 const skin=tris.filter(t=>t.kind==='piel'),feat=tris.filter(t=>t.kind==='rasgo'),hair=bigParts(tris.filter(t=>t.kind==='pelo'));
 // Orientación: el frente es hacia donde están los ojos y cejas, visto desde el centro de la piel (sólo en el plano).
 const cs=center(skin),cf=center(feat),front=new THREE.Vector3(cf[0]-cs[0],0,cf[2]-cs[2]).normalize(),rot=new THREE.Quaternion().setFromUnitVectors(front,new THREE.Vector3(0,0,1));
 let R=p=>new THREE.Vector3(p[0]-cs[0],p[1],p[2]-cs[2]).applyQuaternion(rot);
 // (afinar el giro con los rasgos: del lado izquierdo al derecho de la cara la línea va a lo largo de x)
 {const fp=feat.flatMap(t=>t.p.map(R)),mx=fp.reduce((s,r)=>s+r.x,0)/fp.length,side=f=>{const g=fp.filter(f);return g.reduce((s,r)=>s.add(r),new THREE.Vector3()).multiplyScalar(1/(g.length||1));};
  const L=side(r=>r.x<mx),Rt=side(r=>r.x>=mx),yaw=Math.atan2(Rt.z-L.z,Rt.x-L.x),fix=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),r0=R;R=p=>r0(p).applyQuaternion(fix);}
 // Altura: el borde de arriba de las cejas (lo más alto de los rasgos) a la altura de las nuestras.
 const browTop=maxOf(feat.flatMap(t=>t.p.map(p=>R(p).y)));
 // Escala: el ancho de los rasgos (cejas y ojos: el mismo diseño en las dos cabezas) contra el de los nuestros. La piel
 // no sirve: las orejas también son color piel y la frente generada es más angosta que el cráneo.
 const fx=feat.flatMap(t=>t.p.map(p=>R(p).x)).sort((a,b)=>a-b),lo=fx[Math.floor(.01*(fx.length-1))],hi=fx[Math.floor(.99*(fx.length-1))],width=(hi-lo)||1,k=HEAD.featWidth/width,xMid=(lo+hi)/2;
 // Profundidad: el frente de la cara (lo más adelante de la piel, percentil) contra el nuestro.
 const zs=skin.flatMap(t=>t.p.map(p=>R(p).z)).sort((a,b)=>a-b),zFront=zs[Math.floor(.98*(zs.length-1))];
 // (en x se centra en los rasgos: la cara es simétrica; el centro de la piel se corre con el cuello y las orejas)
 const map=p=>{const r=R(p);return [(r.x-xMid)*k,HEAD.browTop+(r.y-browTop)*k,HEAD.frontZ+(r.z-zFront)*k].map(x=>+x.toFixed(4));};
 const lum=c=>.299*c[0]+.587*c[1]+.114*c[2],mean=hair.reduce((s,t)=>s+lum(t.c),0)/(hair.length||1);
 let ht=hair.map(t=>({p:t.p.map(map),l:+(lum(t.c)/mean).toFixed(3)}));
 // (los modelos densos —Hunyuan pide ≥ 40.000 caras— se simplifican a «target» triángulos; cada cara nueva toma el
 // sombreado de la cara original más cercana, así se conserva el facetado de la textura)
 if(target&&ht.length>target){const {SimplifyModifier}=await import('three/addons/modifiers/SimplifyModifier.js'),{mergeVertices}=await import('three/addons/utils/BufferGeometryUtils.js');
  let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ht.flatMap(t=>t.p.flat()),3));g=mergeVertices(g,1e-4);
  const verts=g.attributes.position.count,keep=Math.max(8,Math.round(verts*target/ht.length));g=await new SimplifyModifier().modify(g,verts-keep);// (en three r186 devuelve una promesa)
  const cen=t=>[0,1,2].map(c=>(t.p[0][c]+t.p[1][c]+t.p[2][c])/3),src=ht.map(t=>({c:cen(t),l:t.l})),P=g.attributes.position,I=g.index,out=[];
  for(let i=0;i<(I?I.count:P.count);i+=3){const ids=[0,1,2].map(k=>I?I.getX(i+k):i+k),p=ids.map(j=>[P.getX(j),P.getY(j),P.getZ(j)].map(x=>+x.toFixed(4))),c=cen({p});let best=src[0],bd=Infinity;for(const s2 of src){const d=(s2.c[0]-c[0])**2+(s2.c[1]-c[1])**2+(s2.c[2]-c[2])**2;if(d<bd){bd=d;best=s2;}}out.push({p,l:best.l});}
  ht=out;}
 if(flat)ht=ht.map(t=>({...t,l:1}));
 const out={source:url,tris:ht,stats:{total:tris.length,pelo:count('pelo'),piel:count('piel'),rasgo:count('rasgo'),scale:+k.toFixed(4)},
  base:'#'+new THREE.Color(...[0,1,2].map(i=>hair.reduce((s,t)=>s+t.c[i],0)/(hair.length||1))).getHexString()};
 return out;}

const CACHE=new Map();
export function loadHair(id){if(!CACHE.has(id))CACHE.set(id,fetch(`/models/pelos-ia/${id}.json`).then(r=>{if(!r.ok)throw new Error('Pelo IA sin hornear: '+id);return r.json();}));return CACHE.get(id);}

// Vistas del modelo generado tal cual (para comparar con la lámina): frente, tres cuartos, atrás y arriba, orientado
// como bakeHair (por los ojos). Devuelve un canvas por vista.
export async function previewGLB(url,size=256){
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const gltf=await new GLTFLoader().loadAsync(url),scene=new THREE.Scene();scene.background=new THREE.Color('#f2f5f8');
 scene.add(new THREE.HemisphereLight('#ffffff','#9aa3ad',1.6));const sun=new THREE.DirectionalLight('#ffffff',1.6);sun.position.set(2,4,5);scene.add(sun);
 const root=gltf.scene;scene.add(root);root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(root),c=box.getCenter(new THREE.Vector3()),r=box.getSize(new THREE.Vector3()).length()/2;
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(size,size);renderer.outputColorSpace=THREE.SRGBColorSpace;const cam=new THREE.PerspectiveCamera(30,1,.01,100);
 const out={};for(const [n,az,el] of [['frente',0,4],['lado',60,4],['atras',180,4],['arriba',0,72]]){const a=az*Math.PI/180,e=el*Math.PI/180,d=r/Math.tan(15*Math.PI/180)*1.05;
  cam.position.set(c.x+d*Math.sin(a)*Math.cos(e),c.y+d*Math.sin(e),c.z+d*Math.cos(a)*Math.cos(e));cam.lookAt(c);renderer.render(scene,cam);const cv=document.createElement('canvas');cv.width=cv.height=size;cv.getContext('2d').drawImage(renderer.domElement,0,0);out[n]=cv;}
 renderer.dispose();return out;}

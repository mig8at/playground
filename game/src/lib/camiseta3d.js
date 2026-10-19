import * as T from 'three';
import {compactWeights,skinSurface,selectTriangles,UNDERWEAR_TOP} from './ropa3d.js';

// Patrón de camiseta sobre la misma superficie y pesos del cuerpo. Los cortes
// compartidos evitan diagonales que atraviesan la axila al bajar los brazos.
// La chaqueta usa el patrón largo abierto. prepared reutiliza los cortes y pesos
// finales de piel, después de estabilizar cintura y construir la prenda interior.
export function conformBasicShirt(skin,clothes,sk,jacket=false,prepared=false){
 const shirts=clothes.filter(g=>jacket?['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(g.userData.partId):['prenda:Casual_Male:Shirt:top','ropero:camiseta-manga-larga','ropero:camiseta-sin-mangas','ropero:camisa-botones','ropero:polo','ropero:camisa-manga-larga','ropero:sudadera','ropero:sudadera-capucha'].includes(g.userData.partId));if(!shirts.length)return;
 const origin=name=>new T.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.findIndex(b=>b.name===name)].clone().invert());
 const low=origin('Hips').y+UNDERWEAR_TOP;
 const sweatshirt=['ropero:sudadera','ropero:sudadera-capucha'].includes(shirts[0].userData.partId);
 // La capa exterior comprime levemente el tejido sin cambiar sus pesos.
 const sweatshirtGap=clothes.some(g=>['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(g.userData.partId))?.010:.016;
 const hem=sweatshirt?.085:.035;
 const vest=shirts[0].userData.partId==='ropero:chaleco-abierto';
 const closed=shirts[0].userData.partId==='ropero:chaqueta-cerrada',open=jacket&&!closed;
 const opening=vest?.11:.20,openingRim=opening+.03,armLimit=vest?.08:.20,armRim=vest?.035:.08;
 const longSleeve=(jacket&&!vest)||sweatshirt||['ropero:camiseta-manga-larga','ropero:camisa-manga-larga'].includes(shirts[0].userData.partId);
 const sleeveless=vest||shirts[0].userData.partId==='ropero:camiseta-sin-mangas';
 const armBones=new Set(sk.bones.map((b,i)=>/^(UpperArm|LowerArm|Fist)[LR]$/.test(b.name)?i:-1));
 const shoulder=origin('UpperArmL'),elbow=origin('LowerArmL');
 // La manga termina antes del puño y comparte sus pesos con la piel del brazo.
 const width=longSleeve?Math.abs(origin('FistL').x)-.13:Math.abs(T.MathUtils.lerp(shoulder.x,elbow.x,.55));
 const neckBones=new Set(sk.bones.map((b,i)=>/^(Neck|Head)$/.test(b.name)?i:-1));
 const value=(v,axis)=>axis===-3?Math.abs(v.p.x)-opening-Math.max(0,v.p.y-1.72)*.50:axis===-2?v.w.reduce((sum,w,k)=>sum+(armBones.has(v.j[k])?w:0),0)-(vest?(.12*T.MathUtils.smoothstep(v.p.y,1.74,1.85)+.34*(1-T.MathUtils.smoothstep(Math.abs(v.p.x),.30,.52))*T.MathUtils.smoothstep(v.p.y,1.45,1.65)*(1-T.MathUtils.smoothstep(v.p.y,1.80,1.95))):0):axis===-1?v.w.reduce((sum,w,k)=>sum+(neckBones.has(v.j[k])?w:0),0):v.p.getComponent(axis);
 const planes=[[1,low],[1,low+hem],[-1,.06],[-1,.18],...(sleeveless?[[-2,armRim],[-2,armLimit]]:[[0,-width],[0,-width+hem],[0,width-hem],[0,width]])];
 if(sweatshirt)planes.push([1,low+.065],[0,-width+.065],[0,width-.065]);
 if(vest)planes.push([-3,0],[-3,.03]);
 if(open)planes.push([0,-openingRim],[0,-opening],[0,opening],[0,openingRim],[2,0],[-1,.025]);
 if(longSleeve)for(const side of [-1,1])for(const d of [-.12,0,.12])planes.push([0,side*(Math.abs(elbow.x)+d)]);
 const P=skin.attributes.position,C=skin.attributes.color,J=skin.attributes.skinIndex,W=skin.attributes.skinWeight;
 // Concentrar la flexión en la articulación, sin arrastrar todo el bíceps.
 // Sólo pesos casi enteramente del brazo: conservar la transición del cuello.
 const sleeveBones=(longSleeve||sleeveless)?Object.fromEntries(['L','R'].map(side=>[side,['Shoulder','UpperArm','LowerArm'].map(n=>sk.bones.findIndex(b=>b.name===n+side))])):null;
 if(!prepared&&(longSleeve||sleeveless))for(let i=0;i<P.count;i++){
  const x=Math.abs(P.getX(i));if(P.getY(i)<low+.20||x<.20||x>Math.abs(elbow.x)+.12)continue;
  const ids=sleeveBones[P.getX(i)>0?'L':'R'];
  const map=new Map();let sum=0;for(let k=0;k<4;k++){const j=J.getComponent(i,k),w=W.getComponent(i,k);if(ids.includes(j))sum+=w;else map.set(j,(map.get(j)||0)+w);}
  if(sum<.95)continue;const a=T.MathUtils.smoothstep(x,.20,.52),b=T.MathUtils.smoothstep(x,Math.abs(elbow.x)-.12,Math.abs(elbow.x)+.12);
  map.set(ids[0],sum*(1-a));map.set(ids[1],sum*a*(1-b));map.set(ids[2],sum*a*b);const v=compactWeights(map);J.setXYZW(i,...v.j);W.setXYZW(i,...v.w);
 }
 if(prepared)planes.length=0;
 const vertex=i=>({p:new T.Vector3().fromBufferAttribute(P,i),c:new T.Vector3().fromBufferAttribute(C,i),j:[0,1,2,3].map(k=>J.getComponent(i,k)),w:[0,1,2,3].map(k=>W.getComponent(i,k))});
 const mix=(a,b,t)=>{const map=new Map();for(let k=0;k<4;k++){map.set(a.j[k],(map.get(a.j[k])||0)+a.w[k]*(1-t));map.set(b.j[k],(map.get(b.j[k])||0)+b.w[k]*t);}return {p:a.p.clone().lerp(b.p,t),c:a.c.clone().lerp(b.c,t),...compactWeights(map)};};
 const clip=(poly,axis,level,sign)=>{const out=[];for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],u=(value(a,axis)-level)*sign,v=(value(b,axis)-level)*sign;if(u>=0)out.push(a);if((u>=0)!==(v>=0))out.push(mix(a,b,u/(u-v)));}return out;};
 const body={position:[],color:[],skinIndex:[],skinWeight:[]},fabric={position:[],color:[],skinIndex:[],skinWeight:[]},gaps=[],color=jacket?new T.Vector3(...new T.Color(vest?'#786b50':'#435b70').toArray()):new T.Vector3().fromBufferAttribute(shirts[0].attributes.color,0);
 const add=(data,v,c)=>{data.position.push(...v.p);data.color.push(...c);data.skinIndex.push(...v.j);data.skinWeight.push(...v.w);};
 for(let i=0;i<P.count;i+=3){let polys=[[vertex(i),vertex(i+1),vertex(i+2)]];for(const [axis,level] of planes){const next=[];for(const poly of polys){const vals=poly.map(v=>value(v,axis));if(Math.min(...vals)<level&&Math.max(...vals)>level)next.push(clip(poly,axis,level,-1),clip(poly,axis,level,1));else next.push(poly);}polys=next;}
  for(const poly of polys)for(let k=1;k+1<poly.length;k++){const tri=[poly[0],poly[k],poly[k+1]];if(new T.Triangle(...tri.map(v=>v.p)).getArea()<1e-12)continue;const center=tri.reduce((v,q)=>v.add(q.p),new T.Vector3()).multiplyScalar(1/3),neck=tri.reduce((s,v)=>s+value(v,-1),0)/3,arm=tri.reduce((s,v)=>s+value(v,-2),0)/3,covered=center.y>low&&neck<.18&&(sleeveless?arm<armLimit:Math.abs(center.x)<width)&&(!open||center.z<0||(vest?tri.reduce((s,v)=>s+value(v,-3),0)/3>0:Math.abs(center.x)>opening));
   const band=(open&&center.z>0&&(vest?tri.reduce((s,v)=>s+value(v,-3),0)/3<.03:Math.abs(center.x)<openingRim))||center.y<low+hem||neck>(jacket?.025:.06)||(sleeveless?arm>armRim:Math.abs(center.x)>width-hem);
   // Separación local de solapa y cuello: evita cruzar la capa interior
   // durante la torsión sin inflar toda la manga ni alterar pesos del cuerpo.
   for(const v of tri){add(body,v,v.c);if(covered){add(fabric,v,color.clone().multiplyScalar(band?(sweatshirt?(center.y>low+.065&&center.y<low+hem||Math.abs(center.x)>width-hem&&Math.abs(center.x)<width-.065?.60:.77):.83):1));const edge=Math.min(v.p.y-low,(.18-value(v,-1))*.4,vest?1:sleeveless?(.20-value(v,-2))*.4:width-Math.abs(v.p.x));gaps.push((sweatshirt?sweatshirtGap*T.MathUtils.smoothstep(edge,0,.09)*(1-T.MathUtils.smoothstep(value(v,-1),0,.06)):0)+(jacket?(.038+(open?.060:0)*(1-T.MathUtils.smoothstep(Math.abs(v.p.x),opening,opening+.10))*T.MathUtils.smoothstep(v.p.z,0,.1))*T.MathUtils.smoothstep(edge,0,.055)*(1-T.MathUtils.smoothstep(value(v,-1),0,.06))+.006*T.MathUtils.smoothstep(value(v,-1),.04,.10):0)+.018*(1-T.MathUtils.smoothstep(v.p.y,1.75,1.95))*(1-T.MathUtils.smoothstep(Math.abs(v.p.x),.25,.45))*T.MathUtils.smoothstep(edge,0,.055));}}
  }
 }
 const apply=(g,data)=>{for(const a of Object.keys(g.attributes))g.deleteAttribute(a);for(const [name,values] of Object.entries(data))g.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='skinWeight'?4:3));g.boundingBox=g.boundingSphere=null;};
 apply(skin,body);for(const g of shirts){apply(g,fabric);Object.assign(g.userData,{fitSkip:true,hemRole:null,followSkin:true,basicShirt:true,shirtGap:gaps});}
}

export function offsetBasicShirt(geo){
 const parts=geo.userData.baseParts||[],body=parts.find(r=>r.role==='skin'),shirts=parts.filter(r=>r.basicShirt);if(!body||!shirts.length)return;
 const ids=[];for(let i=body.start;i<body.start+body.count;i+=3)ids.push(i);const skin=selectTriangles(geo,ids),near=skinSurface(skin),clothIds=[];
 for(const r of shirts)for(let i=r.start;i<r.start+r.count;i+=3)clothIds.push(i);const cloth=selectTriangles(geo,clothIds),clothNear=skinSurface(cloth),P=geo.attributes.position;
 const jackets=parts.filter(r=>['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(r.id)),jacketIds=[];for(const r of jackets)for(let i=r.start;i<r.start+r.count;i+=3)jacketIds.push(i);
 if(jacketIds.length){const shell=selectTriangles(geo,jacketIds),surface=skinSurface(shell),hidden=[];for(const r of shirts.filter(r=>r.slot==='top'))for(let i=r.start;i<r.start+r.count;i+=3)if([0,1,2].every(k=>(surface(new T.Vector3().fromBufferAttribute(P,i+k))?.distance??1)<1e-5))hidden.push(i);geo.userData.layerCovered=hidden;shell.dispose();}
 geo.userData.shirtCovered=ids.filter(i=>[0,1,2].every(k=>(clothNear(new T.Vector3().fromBufferAttribute(P,i+k))?.distance??1)<1e-5));
 for(const r of shirts)for(let i=r.start;i<r.start+r.count;i++){const q=new T.Vector3().fromBufferAttribute(P,i),hit=near(q);if(hit){q.addScaledVector(hit.n,r.shirtGap[i-r.start]);P.setXYZ(i,...q);}}
 skin.dispose();cloth.dispose();P.needsUpdate=true;
}

import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {selectTriangles,skinSurface} from './ropa3d.js';

// Bolsillos laterales con tapa: sus pesos se toman del pantalón ya adaptado.
export function addCargoPockets(geo,kinds,sk){
 const parts=geo.userData.baseParts||[],base=parts.find(r=>r.bottomStyle==='cargo');if(!base)return {geo,kinds};
 const ids=[];for(let i=base.start;i<base.start+base.count;i+=3)ids.push(i);const cloth=selectTriangles(geo,ids),near=skinSurface(cloth),hy=new T.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.findIndex(b=>b.name==='Hips')].clone().invert()).y;
 cloth.computeBoundingBox();
 const extra=[],ranges=[...parts];let start=geo.attributes.position.count;
 for(const side of [-1,1])for(const flap of [false,true]){
  const y=hy-(flap?.17:.27),height=flap?.07:.21,depth=flap?.235:.22,center=near(new T.Vector3(side>0?cloth.boundingBox.max.x+.1:cloth.boundingBox.min.x-.1,y,0));if(!center)continue;
  const g=new T.BoxGeometry(flap?.057:.045,height,depth).toNonIndexed();g.deleteAttribute('normal');g.deleteAttribute('uv');const P=g.attributes.position,C=[],J=[],W=[];
  for(let i=0;i<P.count;i++){
   const q=new T.Vector3().fromBufferAttribute(P,i);q.x+=center.p.x+side*(flap?.035:.024);q.y+=y;q.z+=center.p.z;const hit=near(q),weights=new Map(),color=new T.Vector3();
   for(let k=0;k<3;k++){const n=hit.ids[k],b=hit.bary.getComponent(k);color.addScaledVector(new T.Vector3().fromBufferAttribute(cloth.attributes.color,n),b);for(let j=0;j<4;j++){const bone=cloth.attributes.skinIndex.getComponent(n,j);weights.set(bone,(weights.get(bone)||0)+cloth.attributes.skinWeight.getComponent(n,j)*b);}}
   const ws=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=ws.reduce((n,v)=>n+v[1],0);for(let k=0;k<4;k++){J.push(ws[k]?.[0]||0);W.push((ws[k]?.[1]||0)/sum);}color.multiplyScalar(flap?1.12:.8);C.push(...color);P.setXYZ(i,q.x,q.y,q.z);
  }
  g.setAttribute('color',new T.Float32BufferAttribute(C,3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(J,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(W,4));extra.push(g);ranges.push({start,count:P.count,role:'pants',slot:'pants',id:base.id,model:base.model,bottomStyle:'cargo-pocket'});start+=P.count;
 }
 const out=mergeGeometries([geo,...extra]),kk=new Uint8Array(start);kk.set(kinds);kk.fill(2,kinds.length);out.userData={...geo.userData,baseParts:ranges,wardrobeParts:ranges};for(const g of extra)g.dispose();cloth.dispose();geo.dispose();return {geo:out,kinds:kk};
}

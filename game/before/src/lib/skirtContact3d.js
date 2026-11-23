import * as T from 'three';
// Contacto local con los muslos: sólo la falda del Ropero. No simula tela.
export function installSkirtContact(mesh,mixer,source){
 const g=mesh.geometry,parts=g.userData.wardrobeParts||[],ranges=parts.filter(r=>r.wardrobeSkirt);if(!ranges.length)return;
 const sk=mesh.skeleton,P=g.attributes.position,J=g.attributes.skinIndex,W=g.attributes.skinWeight,B=sk.bones,rest=sk.boneInverses.map(m=>new T.Vector3().setFromMatrixPosition(m.clone().invert())),body=source.userData.wardrobeParts.find(r=>r.role==='skin'),SP=source.attributes.position;
 const index=n=>B.findIndex(b=>b.name===n),hip=index('Hips'),hy=rest[hip].y;
 const capsules=['L','R'].map(side=>{const a=index('UpperLeg'+side),b=index('LowerLeg'+side),axis=rest[b].clone().sub(rest[a]),length=axis.length(),radii=[0,0,0,0,0];axis.normalize();
  for(let i=body.start;i<body.start+body.count;i++){const p=new T.Vector3().fromBufferAttribute(SP,i);if(p.x*rest[a].x<=0||p.y>hy-.08)continue;const d=p.sub(rest[a]),t=d.dot(axis)/length;if(t<0||t>1)continue;const radius=d.addScaledVector(axis,-t*length).length(),k=Math.min(4,Math.floor(t*5));radii[k]=Math.max(radii[k],radius);}
  return {a,b,radii:radii.map(r=>Math.max(.1,r)+.06),p:new T.Vector3(),q:new T.Vector3()};});
 const pelvis=[];for(let k=0;k<=12;k++){const y=hy-.24+k*.045,points=[];for(let i=body.start;i<body.start+body.count;i+=3)for(let a=0;a<3;a++){const p=new T.Vector3().fromBufferAttribute(SP,i+a),q=new T.Vector3().fromBufferAttribute(SP,i+(a+1)%3);if((p.y<y)===(q.y<y)||Math.abs(p.y-q.y)<1e-8)continue;const x=p.lerp(q,(y-p.y)/(q.y-p.y));if(Math.abs(x.x)<.75)points.push(x);}if(!points.length)continue;const box=new T.Box3().setFromPoints(points),c=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());pelvis.push({y,z:c.z,rx:size.x*.525+.045,rz:size.z*.525+.045});}
 const hipInverse=new T.Matrix4(),hipPoint=new T.Vector3();
 const unique=new Map();for(const r of ranges)for(let i=r.start;i<r.start+r.count;i++){const p=new T.Vector3().fromBufferAttribute(P,i),key=p.toArray().join(',')+Array.from({length:4},(_,k)=>J.getComponent(i,k)+':'+W.getComponent(i,k)).join(',');if(!unique.has(key))unique.set(key,{p,ids:[],index:i});unique.get(key).ids.push(i);}
 const inv=new T.Matrix4(),matrices=B.map(()=>new T.Matrix4()),blend=new T.Matrix4(),v=new T.Vector3(),axis=new T.Vector3(),near=new T.Vector3(),delta=new T.Vector3(),posed=new T.Vector3(),guide=new T.Vector3();
 const up=mixer.update.bind(mixer);mixer.update=dt=>{for(const e of unique.values())for(const i of e.ids)P.setXYZ(i,e.p.x,e.p.y,e.p.z);const result=up(dt);mesh.updateWorldMatrix(true,true);inv.copy(mesh.matrixWorld).invert();for(let j=0;j<B.length;j++)matrices[j].multiplyMatrices(inv,B[j].matrixWorld).multiply(sk.boneInverses[j]);
  hipInverse.copy(matrices[hip]).invert();for(const c of capsules){c.p.setFromMatrixPosition(B[c.a].matrixWorld).applyMatrix4(inv);c.q.setFromMatrixPosition(B[c.b].matrixWorld).applyMatrix4(inv);}
  for(const e of unique.values()){blend.elements.fill(0);for(let k=0;k<4;k++){const w=W.getComponent(e.index,k),m=matrices[J.getComponent(e.index,k)].elements;for(let n=0;n<16;n++)blend.elements[n]+=m[n]*w;}posed.copy(e.p).applyMatrix4(blend);guide.set(e.p.x,0,e.p.z).normalize().transformDirection(blend);
   for(let pass=0;pass<6;pass++){for(const c of capsules){axis.copy(c.q).sub(c.p);const t=T.MathUtils.clamp(delta.copy(posed).sub(c.p).dot(axis)/axis.lengthSq(),0,1);near.copy(c.p).addScaledVector(axis,t);delta.copy(posed).sub(near);const x=t*4,k=Math.min(3,Math.floor(x)),radius=T.MathUtils.lerp(c.radii[k],c.radii[k+1],x-k),d=delta.length();if(d<radius){const dot=delta.dot(guide),step=-dot+Math.sqrt(dot*dot+radius*radius-d*d);posed.addScaledVector(guide,step);}}
   hipPoint.copy(posed).applyMatrix4(hipInverse);for(let k=0;k<pelvis.length-1;k++){const a=pelvis[k],b=pelvis[k+1];if(hipPoint.y<a.y||hipPoint.y>b.y)continue;const t=(hipPoint.y-a.y)/(b.y-a.y),rx=T.MathUtils.lerp(a.rx,b.rx,t),rz=T.MathUtils.lerp(a.rz,b.rz,t),z=T.MathUtils.lerp(a.z,b.z,t),d=Math.hypot(hipPoint.x/rx,(hipPoint.z-z)/rz);if(d<1&&d>.0001){hipPoint.x/=d;hipPoint.z=z+(hipPoint.z-z)/d;posed.copy(hipPoint).applyMatrix4(matrices[hip]);}break;}}
   v.copy(posed).applyMatrix4(blend.invert());for(const i of e.ids)P.setXYZ(i,v.x,v.y,v.z);
  }
  P.needsUpdate=true;g.boundingSphere=null;return result;};
}


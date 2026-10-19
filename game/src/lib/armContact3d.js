import * as THREE from 'three';

// Un volumen ligero medido sobre la piel y la ropa ya ajustadas. Se guarda con la
// geometría: las copias y sus LOD usan la misma medida, sin recorrer la malla por cuadro.
export function armContactProfile(mesh,kinds){
 const g=mesh.geometry,sk=mesh.skeleton,B=sk.bones,P=g.attributes.position,J=g.attributes.skinIndex,W=g.attributes.skinWeight;
 const rest=B.map((b,i)=>new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[i].clone().invert()));
 const index=n=>B.findIndex(b=>b.name===n),hip=index('Hips'),neck=index('Neck');if(hip<0||neck<0)return null;
 const trunk=new Set(B.map((b,i)=>/^(Body(?:_\d+)?|Hips|Abdomen|Torso)$/.test(b.name)?i:-1));
 const low=rest[hip].y-.14,high=rest[neck].y-.17,rings=[];
 const byVertex=i=>{let best=0,dom=-1;const weights=[];for(let k=0;k<4;k++){const w=W.getComponent(i,k),j=J.getComponent(i,k);weights.push([j,w]);if(w>best){best=w;dom=j;}}
  return {p:new THREE.Vector3().fromBufferAttribute(P,i),weights,body:/^(Body(?:_\d+)?|Hips|Abdomen|Torso|Shoulder|UpperLeg|Neck)/.test(B[dom]?.name||'')};};
 const triangles=[];
 for(let i=0;i<P.count;i+=3){if(kinds&&!kinds[i])continue;const vertices=[i,i+1,i+2].map(byVertex);
  if(vertices.filter(v=>v.body).length<2)continue;triangles.push(vertices);}
 for(let n=0;n<15;n++){
  const y=low+(high-low)*n/14,points=[];
  for(const tri of triangles)for(let k=0;k<3;k++){
   const a=tri[k],b=tri[(k+1)%3];if((a.p.y<y)===(b.p.y<y)||Math.abs(b.p.y-a.p.y)<1e-7)continue;
   const t=(y-a.p.y)/(b.p.y-a.p.y),p=a.p.clone().lerp(b.p,t),weights=new Map();
   for(const [j,w] of a.weights)if(trunk.has(j))weights.set(j,(weights.get(j)||0)+w*(1-t));
   for(const [j,w] of b.weights)if(trunk.has(j))weights.set(j,(weights.get(j)||0)+w*t);
   points.push({p,weights});
  }
  if(!points.length)continue;let rx=.1,z0=Infinity,z1=-Infinity;const weights=new Map();
  for(const p of points){rx=Math.max(rx,Math.abs(p.p.x));z0=Math.min(z0,p.p.z);z1=Math.max(z1,p.p.z);for(const [j,w] of p.weights)weights.set(j,(weights.get(j)||0)+w);}
  const ws=[...weights].filter(a=>a[1]>1e-6).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=ws.reduce((s,a)=>s+a[1],0);if(!sum)continue;
  rings.push({p:[0,y,(z0+z1)/2],rx:rx+.008,rz:(z1-z0)/2+.008,j:ws.map(a=>a[0]),w:ws.map(a=>a[1]/sum)});
 }
 const arms=[],v=new THREE.Vector3();
 for(const side of ['L','R']){
  const ids=['Shoulder','UpperArm','LowerArm','Fist'].map(n=>index(n+side));if(ids.some(i=>i<0))continue;
  const radii=[];
  for(let b=1;b<3;b++){
   const a=rest[ids[b]],end=rest[ids[b+1]],axis=end.clone().sub(a).normalize(),r=[];
   for(let i=0;i<P.count;i++){
    let weight=0;for(let k=0;k<4;k++)if(J.getComponent(i,k)===ids[b])weight+=W.getComponent(i,k);if(weight<.7)continue;
    v.fromBufferAttribute(P,i).sub(a);const t=v.dot(axis)/a.distanceTo(end);if(t<.2||t>.8)continue;
    r.push(v.addScaledVector(axis,-v.dot(axis)).length());
   }
   r.sort((a,b)=>a-b);radii.push(THREE.MathUtils.clamp(r[Math.floor(r.length*.6)]||.12,.06,.27));
  }
  const handBox=new THREE.Box3();
  for(let i=0;i<P.count;i++){let w=0;for(let k=0;k<4;k++)if(J.getComponent(i,k)===ids[3])w+=W.getComponent(i,k);if(w>.7)handBox.expandByPoint(v.fromBufferAttribute(P,i).applyMatrix4(sk.boneInverses[ids[3]]));}
  const hand=handBox.isEmpty()?null:{p:handBox.getCenter(new THREE.Vector3()).toArray(),r:handBox.getSize(new THREE.Vector3()).length()*.44};
  arms.push({ids,radii,side,hand});
 }
 const legs=[];
 const shorts=(g.userData.wardrobeParts||[]).filter(r=>r.slot==='pants'&&(r.followSkin||r.wardrobeSkirt));
 for(const side of ['L','R']){const a=index('UpperLeg'+side),b=index('LowerLeg'+side);if(a<0||b<0||!shorts.length)continue;const axis=rest[b].clone().sub(rest[a]),length=axis.length();axis.normalize();let radius=0,end=0;
  for(const range of shorts)for(let i=range.start;i<range.start+range.count;i++){const p=new THREE.Vector3().fromBufferAttribute(P,i);if(p.x*rest[a].x<0)continue;const d=p.sub(rest[a]),along=d.dot(axis);if(along<0||along>length)continue;end=Math.max(end,along/length);radius=Math.max(radius,d.addScaledVector(axis,-along).length());}
  if(radius)legs.push({a,b,start:.12,end:Math.max(.12,end-.12),radius:radius+.012});
 }
 const headId=index('Head'),headBox=new THREE.Box3();if(headId>=0)for(let i=0;i<P.count;i++){let weight=0;for(let k=0;k<4;k++)if(J.getComponent(i,k)===headId)weight+=W.getComponent(i,k);if(weight>.7&&kinds?.[i]===1)headBox.expandByPoint(new THREE.Vector3().fromBufferAttribute(P,i).applyMatrix4(sk.boneInverses[headId]));}
 const head=headBox.isEmpty()?null:{id:headId,min:headBox.min.toArray(),max:headBox.max.toArray()};
 return g.userData.armContact={rings,arms,legs,head};
}

// Se corrigen giros y, para prendas que lo necesitan, el anclaje del hombro.
// Antes de cada update se restaura la pose para no acumular desplazamientos.
export function installArmContact(root,mixer,mesh,{enabled=true}={}){
 const profile=mesh?.geometry.userData.armContact;if(!profile||profile.rings.length<2||!profile.arms.length)return null;
 const B=mesh.skeleton.bones,rings=profile.rings.map(r=>({...r,c:new THREE.Vector3(),x:new THREE.Vector3(),z:new THREE.Vector3()}));
 const arms=profile.arms.map(a=>({...a,b:a.ids.map(i=>B[i]),helper:B.find(b=>b.name==='Elbow'+a.side),correction:[new THREE.Quaternion(),new THREE.Quaternion()],previousPose:[new THREE.Quaternion(),new THREE.Quaternion()],candidate:[new THREE.Quaternion(),new THREE.Quaternion()]}));
 const legs=(profile.legs||[]).map(l=>({...l,p:new THREE.Vector3(),q:new THREE.Vector3()}));
 const saved=new Set(arms.flatMap(a=>[...a.b,...(a.helper?[a.helper]:[])])),base=new Map([...saved].map(b=>[b,b.quaternion.clone()]));
 const inv=new THREE.Matrix4(),mat=new THREE.Matrix4(),tmp=new THREE.Vector3(),q=new THREE.Quaternion(),pq=new THREE.Quaternion(),dq=new THREE.Quaternion();
 const origin=new THREE.Vector3(),cur=new THREE.Vector3(),target=new THREE.Vector3(),point=new THREE.Vector3(),push=new THREE.Vector3(),seg=new THREE.Vector3(),off=new THREE.Vector3();
 const pa=new THREE.Vector3(),pb=new THREE.Vector3(),pc=new THREE.Vector3(),forearm=new THREE.Vector3(),half=new THREE.Quaternion(),delta=new THREE.Quaternion(),identity=new THREE.Quaternion();let applied=false,previous=false;
 const control={enabled,before:0,after:0,iterations:0};
 const shoulderPositions=new Map(arms.map(a=>[a.b[1],a.b[1].position.clone()]));let shouldersShifted=false;
 const head=profile.avoidHead&&profile.head?{box:new THREE.Box3(new THREE.Vector3().fromArray(profile.head.min),new THREE.Vector3().fromArray(profile.head.max)),matrix:new THREE.Matrix4(),inverse:new THREE.Matrix4()}:null;
 const headPoint=new THREE.Vector3(),headNearest=new THREE.Vector3(),headPush=new THREE.Vector3();
 const volumes=()=>{
  inv.copy(root.matrixWorld).invert();if(head){head.matrix.multiplyMatrices(inv,B[profile.head.id].matrixWorld);head.inverse.copy(head.matrix).invert();}
  for(const l of legs){l.p.setFromMatrixPosition(B[l.a].matrixWorld).applyMatrix4(inv);l.q.setFromMatrixPosition(B[l.b].matrixWorld).applyMatrix4(inv);const end=l.p.clone().lerp(l.q,l.end);l.p.lerp(l.q,l.start);l.q.copy(end);}
  for(const r of rings){r.c.set(0,0,0);r.x.set(0,0,0);r.z.set(0,0,0);
   for(let k=0;k<r.j.length;k++){
    mat.multiplyMatrices(inv,B[r.j[k]].matrixWorld).multiply(mesh.skeleton.boneInverses[r.j[k]]);
    r.c.addScaledVector(tmp.fromArray(r.p).applyMatrix4(mat),r.w[k]);
    r.x.addScaledVector(tmp.setFromMatrixColumn(mat,0),r.w[k]);r.z.addScaledVector(tmp.setFromMatrixColumn(mat,2),r.w[k]);
   }r.x.normalize();r.z.normalize();
  }
 };
 // Distancia al óvalo de la sección más cercana de la columna, interpolado entre
 // secciones. Fuera de los extremos redondeados no hay contacto con el tronco.
 const trunkPenetration=(p,radius,out)=>{
  let best=Infinity,at=0,u=0;
  for(let i=0;i<rings.length-1;i++){
   seg.copy(rings[i+1].c).sub(rings[i].c);const t=THREE.MathUtils.clamp(off.copy(p).sub(rings[i].c).dot(seg)/seg.lengthSq(),0,1);
   const d=off.copy(p).sub(rings[i].c).addScaledVector(seg,-t).lengthSq();if(d<best){best=d;at=i;u=t;}
  }
  const a=rings[at],b=rings[at+1];tmp.copy(b.c).sub(a.c);off.copy(p).sub(a.c).addScaledVector(tmp,-u);
  const along=off.dot(tmp.normalize()),end=at===0&&u===0||at===rings.length-2&&u===1;
  const cap=end?along/(.14+radius):0;if(Math.abs(cap)>=1)return 0;
  const x=off.dot(a.x),z=off.dot(a.z),rx=a.rx+(b.rx-a.rx)*u+radius+.006,rz=a.rz+(b.rz-a.rz)*u+radius+.006;
  const radial=Math.hypot(x/rx,z/rz),d=Math.hypot(radial,cap);if(d>=1)return 0;
  if(out){
   const factor=Math.sqrt(1-cap*cap)/Math.max(radial,.001)-1;out.copy(a.x).multiplyScalar(x*factor).addScaledVector(a.z,z*factor);
   if(out.lengthSq()<1e-8)out.copy(a.x).multiplyScalar(radius);
  }
  return (1-d)*Math.min(rx,rz);
 };
 const legPush=new THREE.Vector3(),legAxis=new THREE.Vector3(),legOff=new THREE.Vector3();
 const penetration=(p,radius,out)=>{let depth=trunkPenetration(p,radius,out);for(const l of legs){legAxis.copy(l.q).sub(l.p);const t=THREE.MathUtils.clamp(legOff.copy(p).sub(l.p).dot(legAxis)/Math.max(1e-9,legAxis.lengthSq()),0,1);legOff.copy(p).sub(l.p).addScaledVector(legAxis,-t);const length=legOff.length(),d=l.radius+radius+.006-length;if(d>depth){depth=d;if(out){legPush.copy(legOff).multiplyScalar(d/Math.max(1e-9,length));out.copy(legPush);}}}if(head){headPoint.copy(p).applyMatrix4(head.inverse);head.box.clampPoint(headPoint,headNearest);headPush.copy(headPoint).sub(headNearest);const distance=headPush.length();let d=radius+.055-distance;
    if(distance<1e-6){let nearest=Infinity,axis=0,sign=1;for(let k=0;k<3;k++)for(const side of [-1,1]){const gap=side>0?head.box.max.getComponent(k)-headPoint.getComponent(k):headPoint.getComponent(k)-head.box.min.getComponent(k);if(gap<nearest){nearest=gap;axis=k;sign=side;}}d+=nearest;headPush.set(0,0,0).setComponent(axis,sign);}
    if(d>depth){depth=d;if(out)out.copy(headPush).transformDirection(head.matrix).multiplyScalar(d);}}return depth;};
 const jointPos=(b,v)=>v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
 const worst=(a,upper,out)=>{
  jointPos(a.b[1],pa);jointPos(a.b[2],pb);jointPos(a.b[3],pc);let max=0,tWorst=0;
  const start=upper?pa:pb,end=upper?pb:pc,r=a.radii[upper?0:1];
  for(const t of upper?(profile.upperSamples||[.85,1]):[.15,.35,.55,.75,1]){
   point.copy(start).lerp(end,t);const radius=upper&&profile.upperSamples?r*THREE.MathUtils.smoothstep(t,.1,1):r;const d=penetration(point,radius,null);if(d>max){max=d;tWorst=t;}
  }
  let hand=false;
  if(!upper&&a.hand){point.fromArray(a.hand.p).applyMatrix4(a.b[3].matrixWorld).applyMatrix4(inv);const d=penetration(point,a.hand.r,null);if(d>max){max=d;hand=true;}}
  if(out&&max){if(hand)out.fromArray(a.hand.p).applyMatrix4(a.b[3].matrixWorld).applyMatrix4(inv);else out.copy(start).lerp(end,tWorst);penetration(out,hand?a.hand.r:upper&&profile.upperSamples?r*THREE.MathUtils.smoothstep(tWorst,.1,1):r,push);}
  return max;
 };
 const aim=(bone,p,shift)=>{
  jointPos(bone,origin);cur.copy(p).sub(origin);target.copy(cur).add(shift);if(cur.lengthSq()<1e-8||target.lengthSq()<1e-8)return;
  cur.normalize();target.normalize();dq.setFromUnitVectors(cur,target);
  // El cálculo es en el espacio del modelo; convertirlo al padre del hueso.
  root.getWorldQuaternion(q);dq.premultiply(q).multiply(q.invert());
  bone.getWorldQuaternion(q);bone.parent.getWorldQuaternion(pq);bone.quaternion.copy(pq.invert().multiply(dq.multiply(q))).normalize();bone.updateWorldMatrix(false,true);
 };
 const measure=()=>{let max=0;for(const a of arms)max=Math.max(max,worst(a,true),worst(a,false));return max;};
 control.measure=()=>{root.updateWorldMatrix(true,true);volumes();return measure();};
 control.pointDepth=p=>penetration(p,0,null);
 const up=mixer.update.bind(mixer);
 mixer.update=dt=>{
  if(applied)for(const [b,pose] of base)b.quaternion.copy(pose);applied=false;
  if(shouldersShifted)for(const [b,p] of shoulderPositions)b.position.copy(p);shouldersShifted=false;
  const result=up(dt);
  // Separación medida para la contextura, expresada en el espacio del modelo.
  if(control.enabled&&profile.shoulderOffset){root.updateWorldMatrix(true,true);for(const a of arms){const b=a.b[1];shoulderPositions.get(b).copy(b.position);const p=b.getWorldPosition(new THREE.Vector3()),offset=new THREE.Vector3(a.side==='L'?profile.shoulderOffset:-profile.shoulderOffset,0,0).applyMatrix4(root.matrixWorld).sub(root.getWorldPosition(new THREE.Vector3()));b.position.copy(b.parent.worldToLocal(p.add(offset)));b.updateWorldMatrix(false,true);}shouldersShifted=true;}
  for(const [b,pose] of base)pose.copy(b.quaternion);
  root.updateWorldMatrix(true,true);volumes();control.before=measure();control.iterations=0;
  if(control.enabled){
   // Mantener la dirección de contacto del cuadro anterior evita que la solución
   // cambie de lado al oscilar un brazo. La corrección se libera en unos 120 ms.
   if(previous&&dt>0){const keep=Math.exp(-8*dt);for(const a of arms)for(let j=0;j<2;j++)a.b[j+1].quaternion.multiply(half.copy(identity).slerp(a.correction[j],keep)).normalize();root.updateWorldMatrix(false,true);applied=true;}
   for(const a of arms){
    jointPos(a.b[2],pb);jointPos(a.b[3],pc);forearm.copy(pc).sub(pb);
    for(let it=0;it<20;it++){
     let max=worst(a,true,point);
     if(max>.002){
      aim(a.b[1],point,push);
      // Conservar la dirección del antebrazo al separar el brazo del tronco.
      jointPos(a.b[2],pb);jointPos(a.b[3],pc);target.copy(pb).add(forearm);push.copy(target).sub(pc);aim(a.b[2],pc,push);control.iterations++;
     }
     max=worst(a,false,point);if(max>.002){aim(a.b[2],point,push);control.iterations++;}
     if(Math.max(worst(a,true),worst(a,false))<=.002)break;
    }
    // Suavizar sólo mientras la postura interpolada siga fuera del cuerpo. Si
    // toca el volumen, buscar la fracción mínima que satisface el contacto.
    if(previous&&dt>0){
     for(let j=0;j<2;j++)a.candidate[j].copy(a.b[j+1].quaternion);
     const blend=t=>{for(let j=0;j<2;j++)a.b[j+1].quaternion.copy(a.previousPose[j]).slerp(a.candidate[j],t).normalize();a.b[1].updateWorldMatrix(false,true);};
     let lo=1-Math.exp(-20*dt),hi=1;blend(lo);
     if(Math.max(worst(a,true),worst(a,false))>.002){for(let n=0;n<6;n++){const t=(lo+hi)/2;blend(t);if(Math.max(worst(a,true),worst(a,false))>.002)lo=t;else hi=t;}blend(hi);}
    }
    for(let j=0;j<2;j++){a.correction[j].copy(base.get(a.b[j+1])).invert().multiply(a.b[j+1].quaternion).normalize();a.previousPose[j].copy(a.b[j+1].quaternion);}

    if(a.helper){delta.copy(a.correction[1]);half.copy(identity).slerp(delta,.5);a.helper.quaternion.copy(base.get(a.helper)).multiply(half).normalize();}
   }
   applied=applied||control.iterations>0;previous=true;
  }else previous=false;
  control.after=measure();return result;
 };
 mixer.armContact=control;return control;
}

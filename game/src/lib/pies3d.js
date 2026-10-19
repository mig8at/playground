import * as THREE from 'three';

// Mismo apoyo de pies en el probador y en las copias de la ciudad.
export function installFeet(root,mixer,holder,piernas=1,followLegs=false,fitAnkles=false){let skel=null;root.traverse(o=>{if(o.isSkinnedMesh&&!skel)skel=o.skeleton;});const Bn=skel.bones,fix=[],PL=piernas;
  // (la altura del pie en reposo, en el espacio del holder: el piso)
  root.updateMatrixWorld(true);holder.updateMatrixWorld(true);
  for(const sd of ['L','R']){const lj=Bn.findIndex(b=>b.name==='LowerLeg'+sd),fj=Bn.findIndex(b=>b.name==='Foot'+sd),uj=Bn.findIndex(b=>b.name==='UpperLeg'+sd);if(lj<0||fj<0||uj<0)continue;
   const fw=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(skel.boneInverses[fj]).invert()),loc=fw.applyMatrix4(skel.boneInverses[lj]).multiplyScalar(PL);
   const floor=holder.worldToLocal(Bn[fj].getWorldPosition(new THREE.Vector3())).y;fix.push({lb:Bn[lj],fb:Bn[fj],ub:Bn[uj],loc,floor,rest:new THREE.Quaternion().setFromRotationMatrix(skel.boneInverses[lj].clone().invert()).invert().multiply(new THREE.Quaternion().setFromRotationMatrix(skel.boneInverses[fj].clone().invert())),previous:Bn[fj].quaternion.clone()});}
  const w=new THREE.Vector3(),q=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const place=f=>{f.lb.updateWorldMatrix(true,false);w.copy(f.loc).applyMatrix4(f.lb.matrixWorld);const y=holder.worldToLocal(w.clone()).y;f.fb.parent.worldToLocal(w);f.fb.position.copy(w);return y;};
  const upd=mixer.update.bind(mixer);
  let applied=false;
  mixer.update=dt=>{if(applied)for(const f of fix)f.fb.quaternion.copy(f.previous);applied=false;const r=upd(dt);if(PL===1&&!holder.userData.sentado&&!followLegs)return r;root.updateMatrixWorld(true);
   for(const f of fix){let y=place(f);
    // Sentado con piernas largas: el pie queda bajo el piso; se levanta el muslo (como alguien alto en una silla normal),
    // girándolo sobre el eje horizontal hasta que el pie apoye. Sólo con el muslo más bien horizontal (sentado).
    f.ub.updateWorldMatrix(true,false);const kp=f.lb.getWorldPosition(new THREE.Vector3()),hp=f.ub.getWorldPosition(new THREE.Vector3()),td=kp.clone().sub(hp).normalize();
    if(y<f.floor-.005&&td.y>-.6){const ax=new THREE.Vector3().crossVectors(td,up).normalize();let th=0,step=.08,prev=y;
     for(let it=0;it<10&&Math.abs(y-f.floor)>.003;it++){f.ub.rotateOnWorldAxis(ax,step);th+=step;f.ub.updateMatrixWorld(true);y=place(f);if((y-prev)*(f.floor-prev)<0||Math.abs(y-f.floor)>Math.abs(prev-f.floor)){f.ub.rotateOnWorldAxis(ax,-step);f.ub.updateMatrixWorld(true);step=-step/2;y=place(f);}prev=y;}}}
   // El tobillo conserva movimiento, pero no dobla el empeine a través del ruedo.
   if(fitAnkles)for(const f of fix){f.previous.copy(f.fb.quaternion);const target=f.lb.getWorldQuaternion(new THREE.Quaternion()).multiply(f.rest),animated=f.fb.getWorldQuaternion(new THREE.Quaternion()),angle=target.angleTo(animated);if(angle>.55){target.slerp(animated,.55/angle);f.fb.quaternion.copy(f.fb.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(target));}applied=true;}
   root.updateMatrixWorld(true);return r;};}

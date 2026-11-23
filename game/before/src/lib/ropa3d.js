import {GARMENT_CONTACT_PROFILE,GARMENT_CONTACT_FAMILIES} from './calibracionRopa3d.js';
import * as T from 'three';
const V=()=>new T.Vector3();
export const UNDERWEAR_TOP=.28;
export function alignShortWaist(clothes,hip){
 for(const g of clothes){if(g.userData.slot!=='pants')continue;g.userData.followSkin=!/^Falda/.test(g.userData.part||'');g.userData.holgura=.035;const p=g.attributes.position;g.computeBoundingBox();const top=g.boundingBox.max.y,delta=hip+UNDERWEAR_TOP-top;
  for(let i=0;i<p.count;i++){const y=p.getY(i);p.setY(i,y+delta*T.MathUtils.smoothstep(y,hip-.15,top));}p.needsUpdate=true;g.boundingBox=g.boundingSphere=null;
 }
}

export function selectTriangles(g,ids){const out=new T.BufferGeometry();for(const [name,a] of Object.entries(g.attributes)){const data=new a.array.constructor(ids.length*3*a.itemSize);let at=0;for(const i of ids)for(let k=0;k<3;k++)for(let c=0;c<a.itemSize;c++)data[at++]=a.array[(i+k)*a.itemSize+c];out.setAttribute(name,new T.BufferAttribute(data,a.itemSize,a.normalized));}for(const [name,targets] of Object.entries(g.morphAttributes)){out.morphAttributes[name]=targets.map(a=>{const data=new a.array.constructor(ids.length*3*a.itemSize);let at=0;for(const i of ids)for(let k=0;k<3;k++)for(let c=0;c<a.itemSize;c++)data[at++]=a.array[(i+k)*a.itemSize+c];const attr=new T.BufferAttribute(data,a.itemSize);attr.name=a.name;return attr;});}out.morphTargetsRelative=g.morphTargetsRelative;out.userData={...g.userData};return out;}
// Separa las islas reales del traje. Saco y pantalón ya son superficies disjuntas:
// no se corta por pesos (eso dejaba dientes y se llevaba parte de la cintura).
export function splitClothing(g,sk,model,role){
 if(!/^Suit_/.test(model)||!['top','detail'].includes(role))return [{g,role}];
 const P=g.attributes.position,parent=Array.from({length:P.count/3},(_,i)=>i),seen=new Map(),find=i=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;};
 for(let i=0;i<P.count;i++){const key=[P.getX(i),P.getY(i),P.getZ(i)].map(v=>Math.round(v*1e4)).join(','),tri=Math.floor(i/3);if(seen.has(key))parent[find(tri)]=find(seen.get(key));else seen.set(key,tri);}
 const groups=new Map();for(let i=0;i<P.count;i+=3){const k=find(i/3);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);}
 const hip=sk.bones.findIndex(b=>b.name==='Hips'),hy=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y,out=new Map();
 for(const tris of groups.values()){let high=-Infinity;for(const i of tris)for(let k=0;k<3;k++)high=Math.max(high,P.getY(i+k));const r=high<hy+.4?(role==='top'?'pants':'buckle'):role;if(!out.has(r))out.set(r,[]);out.get(r).push(...tris);}
 return [...out].map(([r,tris])=>({g:selectTriangles(g,tris),role:r}));
}
export function weightsAt(g,ids,bary){const J=g.attributes.skinIndex,W=g.attributes.skinWeight,map=new Map();for(let q=0;q<3;q++)for(let k=0;k<4;k++){const j=J.getComponent(ids[q],k);map.set(j,(map.get(j)||0)+W.getComponent(ids[q],k)*bary.getComponent(q));}return compactWeights(map);}
export function compactWeights(map){const a=[...map].filter(x=>x[1]>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=a.reduce((s,x)=>s+x[1],0)||1;while(a.length<4)a.push([0,0]);return {j:a.map(x=>x[0]),w:a.map(x=>x[1]/sum)};}
// Punto de la superficie, con pesos interpolados, en vez de un vértice lejano.
export function skinSurface(g,{cache=true}={}){
 const P=g.attributes.position,points=[],normalByPos=new Map(),normals=[],tris=[],grid=new Map(),cell=.18,key=(x,y,z)=>x+','+y+','+z;
 for(let i=0;i<P.count;i++){const p=V().fromBufferAttribute(P,i),k=p.toArray().map(v=>Math.round(v*1e5)).join(',');points.push(p);if(!normalByPos.has(k))normalByPos.set(k,V());normals.push(normalByPos.get(k));}
 for(let i=0;i<P.count;i+=3){const ids=[i,i+1,i+2],tri=new T.Triangle(...ids.map(j=>points[j]));if(tri.getArea()<1e-10)continue;const normal=tri.getNormal(V()),bb=new T.Box3().setFromPoints(ids.map(j=>points[j]));for(const j of ids)normals[j].add(normal);const e={ids,tri,normal};tris.push(e);
  for(let x=Math.floor(bb.min.x/cell);x<=Math.floor(bb.max.x/cell);x++)for(let y=Math.floor(bb.min.y/cell);y<=Math.floor(bb.max.y/cell);y++)for(let z=Math.floor(bb.min.z/cell);z<=Math.floor(bb.max.z/cell);z++){const k=key(x,y,z);if(!grid.has(k))grid.set(k,new Set());grid.get(k).add(e);}}
 for(const n of normalByPos.values())n.normalize();
 const memo=new Map(),stats={queries:0,hits:0,triangleTests:0},copy=e=>e?{...e,p:e.p.clone(),n:e.n.clone(),bary:e.bary.clone()}:null;
 const q=V(),b=V();const near=p=>{stats.queries++;const memoKey=cache?p.x+','+p.y+','+p.z:null;if(cache&&memo.has(memoKey)){stats.hits++;return copy(memo.get(memoKey));}let best=null,d=Infinity;const ix=Math.floor(p.x/cell),iy=Math.floor(p.y/cell),iz=Math.floor(p.z/cell),tested=new Set();
  for(let r=1;r<=5;r++){for(let x=ix-r;x<=ix+r;x++)for(let y=iy-r;y<=iy+r;y++)for(let z=iz-r;z<=iz+r;z++)for(const e of grid.get(key(x,y,z))||[]){if(tested.has(e))continue;tested.add(e);stats.triangleTests++;e.tri.closestPointToPoint(p,q);const nd=q.distanceToSquared(p);if(!Number.isFinite(nd)||nd>=d)continue;d=nd;e.tri.getBarycoord(q,b);const n=V();for(let k=0;k<3;k++)n.addScaledVector(normals[e.ids[k]],b.getComponent(k));n.normalize();best={p:q.clone(),n,faceNormal:e.normal,ids:e.ids,bary:b.clone(),distance:Math.sqrt(nd)};}
   if(best&&Math.sqrt(d)<r*cell-cell*.01)break;
  }if(cache&&memo.size<16384)memo.set(memoKey,copy(best));return best;
 };near.stats=stats;return near;
}
export function fitGarments(skin,clothes,sk,gap=.03){const near=skinSurface(skin),B=sk.bones,hip=B.findIndex(b=>b.name==='Hips'),hy=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y,q=V();
 for(const g of clothes){if(g.userData.fitSkip||/^Falda/.test(g.userData.part||''))continue;const P=g.attributes.position,J=g.attributes.skinIndex,W=g.attributes.skinWeight,role=g.userData.accessoryRole;
  for(let i=0;i<P.count;i++){q.fromBufferAttribute(P,i);const e=near(q);if(!e)continue;let {j,w}=weightsAt(skin,e.ids,e.bary);
   // El bajo de la camisa y la cintura se apoyan en la pelvis. Los muslos no
   // arrastran la camisa al subir; el pantalón hace la transición debajo de ella.
   if(!g.userData.followSkin&&['top','inner','detail','belt','pants'].includes(role)&&Math.abs(q.x)<.8){const amount=role==='pants'?T.MathUtils.smoothstep(q.y,hy-.14,hy+.13):q.y>hy-.08?1:0;if(amount){const m=new Map();for(let k=0;k<4;k++){const f=/^(UpperLeg|LowerLeg|Knee)/.test(B[j[k]]?.name||'')?amount:0;m.set(j[k],(m.get(j[k])||0)+w[k]*(1-f));m.set(hip,(m.get(hip)||0)+w[k]*f);}({j,w}=compactWeights(m));}}
   J.setXYZW(i,...j);W.setXYZW(i,...w);const gp=g.userData.holgura??gap,d=q.clone().sub(e.p).dot(e.n);if(g.userData.skinTight)q.copy(e.p).addScaledVector(e.n,gp);else if(d<gp)q.addScaledVector(e.n,gp-d);P.setXYZ(i,q.x,q.y,q.z);
  }P.needsUpdate=J.needsUpdate=W.needsUpdate=true;
 }
}
// Calzón adherido: piel y tela comparten EXACTAMENTE la misma teselación,
// posiciones y pesos. Sólo cambia el color. La piel completa queda disponible
// para el ropero, pero sus triángulos coincidentes no se dibujan dos veces.
export function underwear(skin,sk,color='#343d50',bounds=null){
 const hip=sk.bones.findIndex(b=>b.name==='Hips');
 const y=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y;
 const levels=bounds||[y-.19,y+UNDERWEAR_TOP-.05,y+UNDERWEAR_TOP],P=skin.attributes.position,C=skin.attributes.color;
 const cloth=new T.Color(color),waist=new T.Color('#89939f');
 const body={position:[],color:[],skinIndex:[],skinWeight:[]};
 const fabric={position:[],color:[],skinIndex:[],skinWeight:[]},skinVertices=[];
 const vertex=i=>({p:V().fromBufferAttribute(P,i),c:V().fromBufferAttribute(C,i),...weightsAt(skin,[i,i,i],new T.Vector3(1,0,0))});
 const mix=(a,b,t)=>{const m=new Map();for(let k=0;k<4;k++){m.set(a.j[k],(m.get(a.j[k])||0)+a.w[k]*(1-t));m.set(b.j[k],(m.get(b.j[k])||0)+b.w[k]*t);}return {p:a.p.clone().lerp(b.p,t),c:a.c.clone().lerp(b.c,t),...compactWeights(m)};};
 const clip=(poly,level,sign)=>{const out=[];for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],u=(a.p.y-level)*sign,v=(b.p.y-level)*sign;if(u>=0)out.push(a);if((u>=0)!==(v>=0))out.push(mix(a,b,u/(u-v)));}return out;};
 const append=(out,v,c)=>{out.position.push(v.p.x,v.p.y,v.p.z);out.color.push(c.x,c.y,c.z);out.skinIndex.push(...v.j);out.skinWeight.push(...v.w);};
 for(let i=0;i<P.count;i+=3){let polygons=[[vertex(i),vertex(i+1),vertex(i+2)]];
  for(const level of levels){const next=[];for(const poly of polygons){const ys=poly.map(v=>v.p.y);if(Math.min(...ys)<level&&Math.max(...ys)>level)next.push(clip(poly,level,-1),clip(poly,level,1));else next.push(poly);}polygons=next;}
  for(const poly of polygons)for(let k=1;k+1<poly.length;k++){
   const tri=[poly[0],poly[k],poly[k+1]];if(new T.Triangle(...tri.map(v=>v.p)).getArea()<1e-12)continue;
   const cy=tri.reduce((n,v)=>n+v.p.y,0)/3,covered=cy>levels[0]&&cy<levels[levels.length-1];
   const col=cy>=levels[1]?waist:cloth,fc=new T.Vector3(col.r,col.g,col.b);
   for(const v of tri){const index=body.position.length/3;append(body,v,v.c);if(covered){append(fabric,v,fc);skinVertices.push(index);}}
  }
 }
 const attributes=(g,data)=>{for(const [name,values] of Object.entries(data))g.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='skinWeight'?4:3));};
 attributes(skin,body);skin.boundingBox=skin.boundingSphere=null;
 const g=new T.BufferGeometry();attributes(g,fabric);
 g.userData={accessoryRole:'underwear',partId:'interior:boxer',slot:'underwear',fitSkip:true,bonded:true,skinVertices};
 return g;
}
export function extractPart(geometry,id){const ranges=geometry.userData.wardrobeParts?.filter(p=>p.id===id)||[];if(!ranges.length)return null;const ids=[];for(const r of ranges)for(let i=r.start;i<r.start+r.count;i+=3)ids.push(i);return selectTriangles(geometry,ids);}

// Correctivo de tela horneado una vez en la postura sentada. Las instancias
// comparten la geometría; por cuadro sólo cambia un peso de morph, también en LOD.
export function bakeSeatedCloth(root,mesh,clip,follow,mixer=null){
 if(!clip)return;const g=mesh.geometry,ranges=g.userData.wardrobeParts||[],P=g.attributes.position,J=g.attributes.skinIndex,W=g.attributes.skinWeight,sk=mesh.skeleton;
 const bodyRange=ranges.find(r=>r.role==='skin');if(!bodyRange)return;
 const saved=sk.bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()})),tm=mixer||new T.AnimationMixer(root);tm.stopAllAction();const a=tm.clipAction(clip);a.reset().play();a.paused=true;a.time=clip.duration*.999;tm.update(0);follow?.();root.updateWorldMatrix(true,true);
 const posed=g.clone(),PP=posed.attributes.position,point=V();for(let i=0;i<P.count;i++){mesh.applyBoneTransform(i,point.fromBufferAttribute(P,i));PP.setXYZ(i,point.x,point.y,point.z);}
 const ids=[];for(let i=bodyRange.start;i<bodyRange.start+bodyRange.count;i+=3)ids.push(i);const skin=selectTriangles(posed,ids),near=skinSurface(skin);
 const deltas=new Float32Array(P.count*3),BM=sk.bones.map((b,i)=>new T.Matrix4().multiplyMatrices(b.matrixWorld,sk.boneInverses[i])),mat=new T.Matrix4(),hip=sk.bones.findIndex(b=>b.name==='Hips'),hy=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y;
 const hipPose=V().setFromMatrixPosition(sk.bones[hip].matrixWorld).applyMatrix4(mesh.matrixWorld.clone().invert()),knees=['L','R'].map(side=>V().setFromMatrixPosition(sk.bones.find(b=>b.name==='LowerLeg'+side).matrixWorld).applyMatrix4(mesh.matrixWorld.clone().invert())),kneeZ=Math.max(...knees.map(p=>p.z)),kneeY=Math.max(...knees.map(p=>p.y));
 const skinP=skin.attributes.position;
 const topAt=(x,z)=>{let best=-Infinity;for(let i=0;i<skinP.count;i+=3){const ax=skinP.getX(i),az=skinP.getZ(i),bx=skinP.getX(i+1)-ax,bz=skinP.getZ(i+1)-az,cx=skinP.getX(i+2)-ax,cz=skinP.getZ(i+2)-az,det=bx*cz-bz*cx;if(Math.abs(det)<1e-9)continue;const u=((x-ax)*cz-(z-az)*cx)/det,v=(bx*(z-az)-bz*(x-ax))/det;if(u<0||v<0||u+v>1)continue;const y=skinP.getY(i)*(1-u-v)+skinP.getY(i+1)*u+skinP.getY(i+2)*v;if(y<hipPose.y+.38)best=Math.max(best,y);}return best;};
 let corrected=0,maxMove=0;
 for(const r of ranges){if(r.bonded||r.followSkin||r.wardrobeSkirt||!['top','inner','pants','belt','detail','outer','underwear'].includes(r.slot))continue;
  for(let i=r.start;i<r.start+r.count;i++){const original=V().fromBufferAttribute(P,i),p=V().fromBufferAttribute(PP,i),target=p.clone();
   if(['pants','belt'].includes(r.slot)&&r.model!=='Prendas'){const lift=.065*T.MathUtils.smoothstep(original.y,hy-.15,hy+.14)*(1-T.MathUtils.smoothstep(original.y,hy+.35,hy+.55));target.y+=lift;}
   if(r.model==='Prendas'){
    const t=T.MathUtils.smoothstep(original.y,hy-.14,hy+.13),front=T.MathUtils.smoothstep(original.z,-.08,.16)*(1-t);
    if(front>.001){const z=Math.min(target.z,kneeZ+.015),support=Math.max(topAt(target.x,z),topAt(target.x-.16,z),topAt(target.x+.16,z));
     if(Number.isFinite(support)){const beyond=Math.max(0,target.z-kneeZ-.015),fall=Math.min(beyond*.9,.8),height=support+.045-fall;target.y=T.MathUtils.lerp(target.y,height,front);target.z-=beyond*.52*front;}
    }
   }
   const e=near(target);if(!e)continue;const signed=target.clone().sub(e.p).dot(e.n),gap=r.slot==='underwear'?.009:r.slot==='inner'?.024:r.slot==='outer'?.065:.038;
   if(signed<gap&&e.distance<.48)target.copy(e.p).addScaledVector(e.n,gap);
   const distance=target.distanceTo(p);if(distance<.0001)continue;
   // Invertir la matriz de piel del vértice para guardar el correctivo en reposo.
   mat.elements.fill(0);for(let k=0;k<4;k++){const w=W.getComponent(i,k),b=BM[J.getComponent(i,k)];for(let c=0;c<16;c++)mat.elements[c]+=b.elements[c]*w;}
   mat.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);if(Math.abs(mat.determinant())<1e-9)continue;
   target.applyMatrix4(mat.invert()).sub(original);deltas.set(target.toArray(),i*3);corrected++;maxMove=Math.max(maxMove,distance);
  }
 }
 tm.stopAllAction();if(!mixer)tm.uncacheRoot(root);sk.bones.forEach((b,i)=>{b.position.copy(saved[i].p);b.quaternion.copy(saved[i].q);b.scale.copy(saved[i].s)});root.updateWorldMatrix(true,true);
 g.morphAttributes.position=[new T.Float32BufferAttribute(deltas,3)];g.morphAttributes.position[0].name='Sentado';g.morphTargetsRelative=true;g.userData.seatedCloth={corrected,maxMove};mesh.updateMorphTargets();
}
export function installSeatedCloth(root,mixer,mesh){
 if(!mesh?.geometry.morphAttributes.position?.length)return null;const pairs=['L','R'].map(s=>[mesh.skeleton.bones.find(b=>b.name==='UpperLeg'+s),mesh.skeleton.bones.find(b=>b.name==='LowerLeg'+s)]).filter(x=>x.every(Boolean)),a=V(),b=V(),inv=new T.Matrix4(),up=mixer.update.bind(mixer);const control={weight:0};
 mixer.seatedCloth=control;mixer.update=dt=>{const result=up(dt);root.updateWorldMatrix(true,true);inv.copy(root.matrixWorld).invert();let amount=0;for(const [hip,knee] of pairs){a.setFromMatrixPosition(hip.matrixWorld).applyMatrix4(inv);b.setFromMatrixPosition(knee.matrixWorld).applyMatrix4(inv).sub(a).normalize();amount+=T.MathUtils.smoothstep(b.z,.36,.85);}control.weight=amount/Math.max(1,pairs.length);mesh.morphTargetInfluences[0]=control.weight;return result;};return control;
}

// Máscara conservadora de regiones completamente tapadas. La geometría completa
// queda como fuente del ropero; quitar una prenda vuelve a mostrar el cuerpo.
export function maskCoveredSkin(geo,kinds,sk){
 const ranges=geo.userData.wardrobeParts||[],P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight,covers=[];
 const layerCovered=new Set(geo.userData.layerCovered||[]);
 const skin=ranges.find(r=>r.role==='skin'),bonded=new Set(),shoesCovered=new Set(geo.userData.shoesCovered||[]),shirtCovered=new Set(geo.userData.shirtCovered||[]),shortsCovered=new Set(geo.userData.shortsCovered||[]),coveredVertices=new Set([...shortsCovered].flatMap(i=>[i,i+1,i+2]));
 if(skin)for(const r of ranges)if(r.bonded)for(const i of r.skinVertices||[])bonded.add(skin.start+i);
 for(const r of ranges){if(r.hem||r.bonded)continue;const lower=['pants','underwear'].includes(r.slot),closedTop=(r.slot==='top'&&/^(Casual|OldClassy)/.test(r.model||''))||(r.slot==='inner'&&/^(Worker|Suit)_/.test(r.model||''));if(!lower&&!closedTop)continue;
  let low=Infinity,high=-Infinity;for(let i=r.start;i<r.start+r.count;i++){if(closedTop&&Math.abs(P.getX(i))>.58)continue;low=Math.min(low,P.getY(i));high=Math.max(high,P.getY(i));}
  if(high-low>.2)covers.push({followSkin:!!r.followSkin,low:low+(r.slot==='underwear'?.025:.085),high:high-(r.slot==='underwear'?.025:.065),lower,underwear:r.slot==='underwear'});
 }
 if(!covers.length&&!bonded.size&&!shoesCovered.size)return {geo,kinds,removed:0};
 const hidden=(i,cover)=>{const y=P.getY(i);if(y<=cover.low||y>=cover.high)return false;let weight=0;for(let k=0;k<4;k++){const name=sk.bones[J.getComponent(i,k)]?.name||'';if((cover.lower?/^(Body(?:_\d+)?|Hips|UpperLeg[LR]|LowerLeg[LR]|Knee[LR])$/:/^(Body(?:_\d+)?|Hips|Abdomen|Torso)$/).test(name))weight+=W.getComponent(i,k);}return weight>.92;};
 const coveredElbows=ranges.some(r=>GARMENT_CONTACT_FAMILIES[GARMENT_CONTACT_PROFILE[r.id]]?.longSleeve&& !GARMENT_CONTACT_FAMILIES[GARMENT_CONTACT_PROFILE[r.id]]?.openShoulder);
 const closedJacket=ranges.some(r=>r.id==='ropero:chaqueta-cerrada');
 const kept=[],parts=[];for(const r of ranges){const start=kept.length*3;for(let i=r.start;i<r.start+r.count;i+=3){if(closedJacket&&r.slot==='top'&&!r.hoodPanel||layerCovered.has(i)||shoesCovered.has(i)||coveredElbows&&/^LowerArm[LR]$/.test(r.joint||''))continue;if(r.joint&&covers.some(c=>c.followSkin&&hidden(i,c)&&hidden(i+1,c)&&hidden(i+2,c)))continue;if(r.role==='skin'&&(shortsCovered.has(i)||shirtCovered.has(i)))continue;if(r.bonded&&[0,1,2].every(k=>coveredVertices.has((skin?.start||0)+r.skinVertices[i-r.start+k])))continue;if(r.role==='skin'&&bonded.has(i)&&bonded.has(i+1)&&bonded.has(i+2))continue;if(['skin','underwear'].includes(r.role)&&covers.some(c=>(r.role!=='underwear'||!c.underwear)&&hidden(i,c)&&hidden(i+1,c)&&hidden(i+2,c)))continue;kept.push(i);}const count=kept.length*3-start;if(count)parts.push({...r,start,count});}
 const out=selectTriangles(geo,kept),kk=new Uint8Array(kept.length*3);for(let n=0;n<kept.length;n++)kk.set(kinds.slice(kept[n],kept[n]+3),n*3);out.userData.wardrobeParts=parts;out.userData.baseParts=parts.filter(p=>p.role);const removed=(P.count-out.attributes.position.count)/3;out.userData.hiddenTriangles=removed;return {geo:out,kinds:kk,removed};
}

export function alignBelt(clothes){
 const pants=clothes.filter(g=>g.userData.slot==='pants'&&!g.userData.dobladillo),belts=clothes.filter(g=>g.userData.slot==='belt');if(!pants.length||!belts.length)return;
 let waist=-Infinity;for(const g of pants){const p=g.attributes.position;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.65)waist=Math.max(waist,p.getY(i));}
 if(!Number.isFinite(waist))return;for(const g of belts){g.computeBoundingBox();const center=(g.boundingBox.min.y+g.boundingBox.max.y)/2;g.translate(0,waist+.015-center,0);}
}

// Una superficie compatible con el muslo: la tela comparte sus aristas y pesos,
// con holgura exterior. Evita que diagonales largas corten la rodilla al doblarse.
export function conformShorts(skin,clothes,sk){
 for(const g of clothes){if(!g.userData.followSkin||g.userData.slot!=='pants')continue;g.computeBoundingBox();const style=g.userData.bottomStyle,hip=sk.bones.findIndex(b=>b.name==='Hips'),top=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y+UNDERWEAR_TOP,knee=V().setFromMatrixPosition(sk.boneInverses[sk.bones.findIndex(b=>b.name==='LowerLegL')].clone().invert()).y,low=style==='bermuda'?knee+.10:g.boundingBox.min.y+.07;
  const source=skin.clone(),shell=underwear(source,sk,'#ffffff',[low,low+.045,...(style==='deportivo'?[low+.12]:[]),top-UNDERWEAR_TOP-.19,top-.05,top].filter(y=>y>=low&&y<=top).sort((a,b)=>a-b)),old=skinSurface(g),P=shell.attributes.position,C=shell.attributes.color;
  for(let i=0;i<P.count;i++){const q=V().fromBufferAttribute(P,i),paint=old(q);if(paint){const c=V();for(let k=0;k<3;k++)c.addScaledVector(V().fromBufferAttribute(g.attributes.color,paint.ids[k]),paint.bary.getComponent(k));C.setXYZ(i,c.x,c.y,c.z);}if(style==='deportivo'&&(q.y<low+.12||q.y>top-.05)){C.setXYZ(i,C.getX(i)*.55,C.getY(i)*.55,C.getZ(i)*.55);}if(q.y<low+.0451){C.setXYZ(i,C.getX(i)*1.12,C.getY(i)*1.12,C.getZ(i)*1.12);}}
  g.userData.shortGap=Array.from({length:P.count},(_,i)=>(style==='leggings'?.009:style==='deportivo'?.025+.045*T.MathUtils.smoothstep(P.getY(i),low+.12,low+.25):style==='cargo'?.04:style==='bermuda'?.035:.025)*Math.min(T.MathUtils.smoothstep(P.getY(i),low,low+.07),1-T.MathUtils.smoothstep(P.getY(i),top-.07,top)));for(const name of Object.keys(g.attributes))g.deleteAttribute(name);for(const [name,a] of Object.entries(shell.attributes))g.setAttribute(name,a);g.userData.fitSkip=true;g.userData.hemRole=null;for(const [name,a] of Object.entries(source.attributes))skin.setAttribute(name,a);skin.boundingBox=skin.boundingSphere=null;g.boundingBox=g.boundingSphere=null;source.dispose();shell.dispose();
 }
}

// La holgura se da DESPUÉS de engordar el cuerpo: sus normales finales son las
// que deben separar tela y piel, especialmente en la barriga y la entrepierna.
export function offsetShorts(geo){
 const ranges=geo.userData.baseParts||[],body=ranges.find(r=>r.role==='skin'),pants=ranges.filter(r=>r.followSkin&&r.slot==='pants');if(!body||!pants.length)return;
 const ids=[];for(let i=body.start;i<body.start+body.count;i+=3)ids.push(i);const skin=selectTriangles(geo,ids),near=skinSurface(skin),P=geo.attributes.position;
 const clothIds=[];for(const r of pants)for(let i=r.start;i<r.start+r.count;i+=3)clothIds.push(i);const cloth=selectTriangles(geo,clothIds),clothNear=skinSurface(cloth),covered=[];for(const i of ids){const vs=[0,1,2].map(k=>V().fromBufferAttribute(P,i+k));if([...vs,vs[0].clone().add(vs[1]).add(vs[2]).multiplyScalar(1/3)].every(p=>(clothNear(p)?.distance??1)<.0001))covered.push(i);}geo.userData.shortsCovered=covered;cloth.dispose();
 for(const r of pants){let top=-Infinity;for(let i=r.start;i<r.start+r.count;i++)top=Math.max(top,P.getY(i));
  for(let i=r.start;i<r.start+r.count;i++){const q=V().fromBufferAttribute(P,i),e=near(q);if(!e)continue;const n=e.n.clone();if(q.y>top-.002)n.y=0;n.normalize();q.copy(e.p).addScaledVector(n,r.shortGap?.[i-r.start]??.025);P.setXYZ(i,q.x,q.y,q.z);}
 }skin.dispose();P.needsUpdate=true;
}


// La cintura pertenece a la pelvis. Evita que la raíz del muslo arrastre el
// abdomen hacia dentro al levantar una sola pierna; piel e interior lo comparten.
export function stabilizeHip(skin,sk){
 const hip=sk.bones.findIndex(b=>b.name==='Hips'),hy=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y,P=skin.attributes.position,J=skin.attributes.skinIndex,W=skin.attributes.skinWeight;
 for(let i=0;i<P.count;i++){const y=P.getY(i),amount=T.MathUtils.smoothstep(y,hy-.14,hy+.13)*(1-T.MathUtils.smoothstep(y,hy+.35,hy+.60));if(!amount||Math.abs(P.getX(i))>.75)continue;let dominant=0;for(let k=1;k<4;k++)if(W.getComponent(i,k)>W.getComponent(i,dominant))dominant=k;if(!/^(Body|Hips|Abdomen|Torso|UpperLeg|LowerLeg|Knee)/.test(sk.bones[J.getComponent(i,dominant)]?.name||''))continue;const weights=new Map();for(let k=0;k<4;k++){const j=J.getComponent(i,k),w=W.getComponent(i,k);weights.set(j,(weights.get(j)||0)+w*(1-amount));}weights.set(hip,(weights.get(hip)||0)+amount);const compact=compactWeights(weights);J.setXYZW(i,...compact.j);W.setXYZW(i,...compact.w);}
}

// Las pantorrillas no deben atravesar el muslo en las poses comprimidas del
// salto/carrera. Limitar la flexión conserva largo y dirección de las piernas.
export function installLegFoldLimit(mixer,mesh,limit=1.55){
 const sk=mesh.skeleton,identity=new T.Quaternion(),delta=new T.Quaternion(),position=V(),scale=V();
 const legs=['L','R'].map(side=>{const index=sk.bones.findIndex(b=>b.name==='LowerLeg'+side);if(index<0)return null;const bone=sk.bones[index],parent=sk.bones.indexOf(bone.parent),local=sk.boneInverses[index].clone().invert();if(parent>=0)local.premultiply(sk.boneInverses[parent]);const rest=new T.Quaternion();local.decompose(position,rest,scale);return {bone,rest,previous:bone.quaternion.clone(),helper:sk.bones.find(b=>b.name==='Knee'+side),helperPose:new T.Quaternion()};}).filter(Boolean);
 let applied=false;const up=mixer.update.bind(mixer);mixer.update=dt=>{if(applied)for(const l of legs){l.bone.quaternion.copy(l.previous);if(l.helper)l.helper.quaternion.copy(l.helperPose);}const result=up(dt);applied=false;
  for(const l of legs){l.previous.copy(l.bone.quaternion);if(l.helper)l.helperPose.copy(l.helper.quaternion);delta.copy(l.rest).invert().multiply(l.bone.quaternion);const angle=identity.angleTo(delta);if(angle<=limit)continue;const original=l.bone.quaternion.clone();l.bone.quaternion.copy(l.rest).multiply(identity.clone().slerp(delta,limit/angle));if(l.helper){delta.copy(original).invert().multiply(l.bone.quaternion);l.helper.quaternion.multiply(identity.clone().slerp(delta,.5));}applied=true;}
  return result;
 };
}

// Anticipación de salto menos comprimida: conserva despegue, altura y aterrizaje.
export function softenJump(clip,idle){
 if(!clip||!idle)return clip;const out=clip.clone(),tracks=new Map(idle.tracks.map(t=>[t.name,t])),a=new T.Quaternion(),b=new T.Quaternion();
 for(const t of out.tracks){const base=tracks.get(t.name);if(!base)continue;const ref=base.createInterpolant().evaluate(0),size=t.getValueSize();for(let i=0;i<t.times.length;i++){const phase=t.times[i]/clip.duration,blend=.65*T.MathUtils.smoothstep(phase,0,.06)*(1-T.MathUtils.smoothstep(phase,.12,.25));if(!blend)continue;if(t.name.endsWith('.quaternion')){a.fromArray(t.values,i*size);b.fromArray(ref);a.slerp(b,blend).toArray(t.values,i*size);}else if(t.name.endsWith('.position'))for(let k=0;k<size;k++)t.values[i*size+k]=T.MathUtils.lerp(t.values[i*size+k],ref[k],blend);}}
 return out;
}

// La falda conserva un tubo único; sólo la cintura toma el contacto de la piel.
export function fitSkirtWaist(geo,sk){
 const parts=geo.userData.baseParts||[],skirts=parts.filter(r=>r.wardrobeSkirt),body=parts.find(r=>r.role==='skin');if(!skirts.length||!body)return;
 const ids=[];for(let i=body.start;i<body.start+body.count;i+=3)ids.push(i);const skin=selectTriangles(geo,ids),near=skinSurface(skin),P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight,C=geo.attributes.color,hip=sk.bones.findIndex(b=>b.name==='Hips'),hy=V().setFromMatrixPosition(sk.boneInverses[hip].clone().invert()).y;
 for(const r of skirts){let low=Infinity,top=-Infinity;for(let i=r.start;i<r.start+r.count;i++){low=Math.min(low,P.getY(i));top=Math.max(top,P.getY(i));}
  for(let i=r.start;i<r.start+r.count;i++){const q=V().fromBufferAttribute(P,i),t=T.MathUtils.smoothstep(q.y,hy-.22,hy-.07),e=t?near(q):null;if(e){const d=q.clone().sub(e.p).dot(e.n);if(d<.04)q.addScaledVector(e.n,(.04-d)*t);const weights=new Map([[hip,t]]);for(let k=0;k<4;k++){const j=J.getComponent(i,k);weights.set(j,(weights.get(j)||0)+W.getComponent(i,k)*(1-t));}const c=compactWeights(weights);J.setXYZW(i,...c.j);W.setXYZW(i,...c.w);}
   const flare=.075*(1-T.MathUtils.smoothstep(P.getY(i),low,hy+.1));const radial=V().set(q.x,0,q.z).normalize();q.addScaledVector(radial,flare);
   if(P.getY(i)<low+.045||P.getY(i)>top-.045)C.setXYZ(i,C.getX(i)*1.12,C.getY(i)*1.12,C.getZ(i)*1.12);P.setXYZ(i,q.x,q.y,q.z);
  }
 }skin.dispose();
}

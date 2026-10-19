import * as T from 'three';

// Sólo elimina diagonales redundantes de una misma pieza. Conserva el contorno,
// los colores, normales y el campo de deformación (incluidos morphs) por hueso.
// No usa un porcentaje de decimación: una cara sin prueba de equivalencia se queda.
const EPS=1e-6;
const SAFE_SLOTS=new Set(['top','inner','outer','pants','belt','detail']);
export function optimizeWardrobeGeometry(geo,kinds,{audit=false}={}){
 const began=performance.now(),P=geo.attributes.position,parts=geo.userData.wardrobeParts;
 if(geo.index||!parts?.length)return {geo,kinds,stats:{before:P.count/3,after:P.count/3,removed:0,ms:0,parts:[]}};
 const attrs=Object.entries(geo.attributes),morphs=Object.entries(geo.morphAttributes).flatMap(([name,list])=>list.map((a,n)=>[name,n,a]));
 const J=geo.attributes.skinIndex,W=geo.attributes.skinWeight,weightCache=new Map();
 const weights=i=>{if(!weightCache.has(i)){const m=new Map();for(let k=0;k<4;k++)if(W?.getComponent(i,k))m.set(J.getComponent(i,k),(m.get(J.getComponent(i,k))||0)+W.getComponent(i,k));weightCache.set(i,m);}return weightCache.get(i);};
 const close=(a,b)=>Math.abs(a-b)<=EPS;
 const equivalent=(a,b)=>attrs.every(([name,v])=>name==='skinIndex'||name==='skinWeight'||Array.from({length:v.itemSize},(_,c)=>close(v.getComponent(a,c),v.getComponent(b,c))).every(Boolean))&&morphs.every(([, ,v])=>Array.from({length:v.itemSize},(_,c)=>close(v.getComponent(a,c),v.getComponent(b,c))).every(Boolean))&&[...new Set([...weights(a).keys(),...weights(b).keys()])].every(j=>close(weights(a).get(j)||0,weights(b).get(j)||0));
 const affine=(v,a,b,t)=>{
  for(const [name,attr] of attrs){if(name==='skinIndex'||name==='skinWeight')continue;for(let c=0;c<attr.itemSize;c++)if(!close(attr.getComponent(v,c),T.MathUtils.lerp(attr.getComponent(a,c),attr.getComponent(b,c),t)))return false;}
  for(const [,,attr] of morphs)for(let c=0;c<attr.itemSize;c++)if(!close(attr.getComponent(v,c),T.MathUtils.lerp(attr.getComponent(a,c),attr.getComponent(b,c),t)))return false;
  // w*p es lo que multiplica cada matriz del esqueleto. Comprobar sólo w y p
  // por separado permitiría borrar vértices que sí hacen falta al doblar un codo.
  const wa=weights(a),wb=weights(b),wv=weights(v);
  for(const j of new Set([...wa.keys(),...wb.keys(),...wv.keys()])){
   const av=wa.get(j)||0,bv=wb.get(j)||0,vv=wv.get(j)||0;if(!close(vv,T.MathUtils.lerp(av,bv,t)))return false;
   for(const attr of [P,...(geo.morphAttributes.position||[])])for(let c=0;c<3;c++)if(!close(vv*attr.getComponent(v,c),T.MathUtils.lerp(av*attr.getComponent(a,c),bv*attr.getComponent(b,c),t)))return false;
  }return true;
 };

 const affine3=(v,ids,ws)=>{
  for(const [name,attr] of attrs){if(name==='skinIndex'||name==='skinWeight')continue;for(let c=0;c<attr.itemSize;c++)if(!close(attr.getComponent(v,c),ids.reduce((sum,i,n)=>sum+ws[n]*attr.getComponent(i,c),0)))return false;}
  for(const [,,attr] of morphs)for(let c=0;c<attr.itemSize;c++)if(!close(attr.getComponent(v,c),ids.reduce((sum,i,n)=>sum+ws[n]*attr.getComponent(i,c),0)))return false;
  for(const j of new Set([v,...ids].flatMap(i=>[...weights(i).keys()]))){const w=weights(v).get(j)||0;
   if(!close(w,ids.reduce((sum,i,n)=>sum+ws[n]*(weights(i).get(j)||0),0)))return false;
   for(const attr of [P,...(geo.morphAttributes.position||[])])for(let c=0;c<3;c++)if(!close(w*attr.getComponent(v,c),ids.reduce((sum,i,n)=>sum+ws[n]*(weights(i).get(j)||0)*attr.getComponent(i,c),0)))return false;
  }return true;
 };
 const outIds=[],outParts=[],statsParts=[],certificates=[];let merges=0;
 for(const part of parts){
  const before=part.count/3,start=outIds.length,eligible=SAFE_SLOTS.has(part.slot)&&!part.bonded&&!part.wardrobeSkirt;
  let tris=Array.from({length:before},(_,n)=>[part.start+n*3,part.start+n*3+1,part.start+n*3+2]);
  if(eligible){
   const key=i=>[P.getX(i),P.getY(i),P.getZ(i)].map(x=>Math.round(x*1e6)).join(','),keys=new Map();
   for(let i=part.start;i<part.start+part.count;i++)keys.set(i,key(i));
   for(let pass=0;pass<16;pass++){
    const edges=new Map(),used=new Set(),added=[];
    for(let n=0;n<tris.length;n++){const tri=tris[n];for(let e=0;e<3;e++){const a=keys.get(tri[e]),b=keys.get(tri[(e+1)%3]),k=a<b?a+'|'+b:b+'|'+a;if(!edges.has(k))edges.set(k,[]);edges.get(k).push([n,e]);}}
    for(const pair of edges.values()){
     if(pair.length!==2)continue;const [[ai,ae],[bi,be]]=pair;if(used.has(ai)||used.has(bi))continue;
     const A=tris[ai],B=tris[bi],a=A[ae],b=A[(ae+1)%3],c=A[(ae+2)%3],d=B[(be+2)%3];
     if(!equivalent(a,B[(be+1)%3])||!equivalent(b,B[be]))continue;
     const polygon=[c,a,d,b];let replacement=null,proof=null;
     for(let n=0;n<4;n++){
      const v=polygon[n],lo=polygon[(n+3)%4],hi=polygon[(n+1)%4],u=new T.Vector3().fromBufferAttribute(P,lo),delta=new T.Vector3().fromBufferAttribute(P,hi).sub(u),point=new T.Vector3().fromBufferAttribute(P,v).sub(u),len=delta.lengthSq();if(len<1e-12)continue;
      const t=point.dot(delta)/len;if(t<=1e-7||t>=1-1e-7||point.addScaledVector(delta,-t).length()>EPS||!affine(v,lo,hi,t))continue;
      replacement=polygon.filter((_,i)=>i!==n);proof={v,ids:[lo,hi],weights:[1-t,t]};break;
     }
     if(!replacement)continue;
     used.add(ai);used.add(bi);added.push(replacement);if(audit)certificates.push(proof);merges++;
    }
    if(!added.length)break;tris=tris.filter((_,n)=>!used.has(n)).concat(added);
   }
   // Disolver vértices interiores de parches planos, incluso si forman un abanico.
   for(let pass=0;pass<4;pass++){
    const nodes=new Map(),stars=new Map(),canonical=new Map();
    for(const tri of tris)for(const i of tri)if(!canonical.has(i)){const k=keys.get(i),bucket=nodes.get(k)||[],same=bucket.find(j=>equivalent(i,j));canonical.set(i,same??i);if(same===undefined){bucket.push(i);nodes.set(k,bucket);}}
    tris.forEach((tri,n)=>tri.forEach(i=>{const key=canonical.get(i);if(!stars.has(key))stars.set(key,new Set());stars.get(key).add(n);}));
    const used=new Set(),added=[];
    for(const [v,starSet] of stars){const star=[...starSet];if(star.length<3||star.length>16||star.some(n=>used.has(n)))continue;
     const next=new Map();let valid=true;
     for(const n of star){const tri=tris[n].map(i=>canonical.get(i)),at=tri.indexOf(v),a=tri[(at+1)%3],b=tri[(at+2)%3];if(next.has(a)){valid=false;break;}next.set(a,b);}
     if(!valid)continue;const ring=[],first=next.keys().next().value;let current=first;
     do{if(current===undefined||ring.includes(current)){valid=false;break;}ring.push(current);current=next.get(current);}while(current!==first);
     if(!valid||ring.length!==star.length)continue;
     const pts=ring.map(i=>new T.Vector3().fromBufferAttribute(P,i));let basis=null;
     for(let n=1;n<pts.length-1;n++){const tri=new T.Triangle(pts[0],pts[n],pts[n+1]);if(tri.getArea()>1e-8){basis={tri,ids:[ring[0],ring[n],ring[n+1]]};break;}}
     if(!basis)continue;const normal=basis.tri.getNormal(new T.Vector3()),origin=pts[0],pv=new T.Vector3().fromBufferAttribute(P,v);
     for(const i of [v,...ring]){const p=new T.Vector3().fromBufferAttribute(P,i),b=basis.tri.getBarycoord(p,new T.Vector3());if(Math.abs(p.clone().sub(origin).dot(normal))>EPS||!affine3(i,basis.ids,b.toArray())){valid=false;break;}}
     if(!valid)continue;
     const axis=pts[1].clone().sub(origin).normalize(),up=new T.Vector3().crossVectors(normal,axis),flat=pts.map(p=>{const q=p.clone().sub(origin);return new T.Vector2(q.dot(axis),q.dot(up));});
     const faces=T.ShapeUtils.triangulateShape(flat,[]);if(faces.length!==ring.length-2)continue;
     let proof=null;for(const face of faces){const tri=new T.Triangle(...face.map(n=>pts[n])),b=tri.getBarycoord(pv,new T.Vector3());if(Math.min(b.x,b.y,b.z)>=-EPS){proof={v,ids:face.map(n=>ring[n]),weights:b.toArray()};break;}}
     if(!proof)continue;
     for(const face of faces){const tri=face.map(n=>ring[n]),n=new T.Triangle(...tri.map(i=>new T.Vector3().fromBufferAttribute(P,i))).getNormal(new T.Vector3());if(n.dot(normal)<0)[tri[1],tri[2]]=[tri[2],tri[1]];added.push(tri);}
     star.forEach(n=>used.add(n));if(audit)certificates.push(proof);merges+=2;
    }
    if(!added.length)break;tris=tris.filter((_,n)=>!used.has(n)).concat(added);
   }
  }
  for(const tri of tris)outIds.push(...tri);
  const remapped={...part,start,count:outIds.length-start};
  for(const name of ['skinVertices','shirtGap','shortGap'])if(Array.isArray(part[name])||ArrayBuffer.isView(part[name]))remapped[name]=outIds.slice(start).map(i=>part[name][i-part.start]);
  outParts.push(remapped);statsParts.push({id:part.id,slot:part.slot,before,after:tris.length,protected:!eligible});
 }
 const out=new T.BufferGeometry();
 const copy=attr=>{const data=new attr.array.constructor(outIds.length*attr.itemSize);for(let n=0;n<outIds.length;n++)for(let c=0;c<attr.itemSize;c++)data[n*attr.itemSize+c]=attr.array[outIds[n]*attr.itemSize+c];const a=new T.BufferAttribute(data,attr.itemSize,attr.normalized);a.name=attr.name;return a;};
 for(const [name,a] of attrs)out.setAttribute(name,copy(a));
 for(const [name,list] of Object.entries(geo.morphAttributes))out.morphAttributes[name]=list.map(copy);
 out.morphTargetsRelative=geo.morphTargetsRelative;out.userData={...geo.userData,wardrobeParts:outParts,baseParts:outParts.filter(p=>p.role)};
 // Estos índices sólo sirven durante el montaje, antes de ocultar/simplificar.
 for(const name of ['layerCovered','shoesCovered','shirtCovered','shortsCovered'])delete out.userData[name];
 const kk=new Uint8Array(outIds.length);outIds.forEach((v,n)=>kk[n]=kinds[v]);
 // Índices compartidos sólo para vértices idénticos de una misma pieza.
 // Las tablas de vértices/rangos quedan intactas para el contacto y los LOD;
 // la GPU puede reutilizar el resultado de skinning de cada índice repetido.
 const indices=[],sharedAttrs=[...Object.values(out.attributes),...Object.values(out.morphAttributes).flat()];let uniqueVertices=0;
 for(const part of outParts){const seen=new Map();for(let i=part.start;i<part.start+part.count;i++){
  const key=sharedAttrs.map(a=>Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize)).join(',')).join('|');
  if(!seen.has(key)){seen.set(key,i);uniqueVertices++;}indices.push(seen.get(key));
 }}
 out.setIndex(indices);
 const stats={before:P.count/3,after:outIds.length/3,removed:merges,verticesBefore:P.count,verticesAfter:uniqueVertices,indexBytes:out.index.array.byteLength,ms:performance.now()-began,parts:statsParts};out.userData.optimization=stats;
 if(audit)stats.audit={vertices:outIds,certificates};
 return {geo:out,kinds:kk,stats};
}

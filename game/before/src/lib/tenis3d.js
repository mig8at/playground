import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Construidos sobre el pie adaptado: suela rígida y borde que acompaña al tobillo.
export function addSneakers(geo,kinds,sk){
 const parts=geo.userData.wardrobeParts||geo.userData.baseParts||[],P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight;
 const pos=[],colors=[],indices=[],weights=[],hidden=[],ranges=[...parts],v=new T.Vector3();
 const palette=['#eeeae0','#b7b5ae','#35536b','#456981','#243b4c','#f5f0df'].map(c=>new T.Color(c));
 const dominant=i=>{let k=0;for(let n=1;n<4;n++)if(W.getComponent(i,n)>W.getComponent(i,k))k=n;return J.getComponent(i,k);};
 for(const side of ['L','R']){
  const j=sk.bones.findIndex(b=>b.name==='Foot'+side),box=new T.Box3();
  for(const r of parts)if(['body','skin'].includes(r.role))for(let i=r.start;i<r.start+r.count;i++)if(dominant(i)===j)box.expandByPoint(v.fromBufferAttribute(P,i));
  if(box.isEmpty())continue;
  const cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2,w=box.max.x-box.min.x+.035,d=box.max.z-box.min.z+.035,y=box.min.y;
  const shin=sk.bones.findIndex(b=>b.name==='LowerLeg'+side),ankle=new T.Box3();
  for(const r of parts)if(r.role==='skin')for(let i=r.start;i<r.start+r.count;i++)if(dominant(i)===shin&&Math.abs(P.getY(i)-.20)<.012)ankle.expandByPoint(v.fromBufferAttribute(P,i));
  const start=P.count+pos.length/3;
  const tri=(a,b,c,color)=>{for(const q of [a,b,c]){pos.push(...q);colors.push(palette[color].r,palette[color].g,palette[color].b);const entries=q.weights||[[q.bone??j,1]];for(let k=0;k<4;k++){indices.push(entries[k]?.[0]||0);weights.push(entries[k]?.[1]||0);}}};
  // Octágono con esquinas biseladas; el empeine baja hacia la puntera.
  const outline=[[-.34,-.5],[.34,-.5],[.5,-.34],[.5,.3],[.34,.5],[-.34,.5],[-.5,.3],[-.5,-.34]];
  const ring=(ww,dd,yy,zz=cz)=>outline.map(([x,z])=>[cx+x*ww,typeof yy==='function'?yy(z):yy,zz+z*dd]);
  const loft=(a,b,color)=>{for(let k=0;k<8;k++){const n=(k+1)%8;tri(a[k],b[k],a[n],color);tri(a[n],b[k],b[n],color);}};
  const sole0=ring(w*.94,d*.96,y-.023),sole1=ring(w,d,y+.016),sole2=ring(w*.98,d*.99,y+.053),upper=ring(w*.94,d*.94,z=>y+.145-.045*Math.max(0,z*2));
  loft(sole0,sole1,1);loft(sole1,sole2,0);loft(sole2,upper,2);
  for(let k=1;k<7;k++)tri(sole0[0],sole0[k+1],sole0[k],1);
  const ac=ankle.isEmpty()?new T.Vector3(cx,.20,cz-d*.1):ankle.getCenter(new T.Vector3()),aw=ankle.isEmpty()?w*.8:ankle.max.x-ankle.min.x,ad=ankle.isEmpty()?d*.45:ankle.max.z-ankle.min.z;
  const collar=ring(aw+.045,ad+.045,.215,ac.z),inner=ring(aw+.015,ad+.015,.202,ac.z);
  for(const q of [...collar,...inner]){q[0]+=ac.x-cx;q.bone=shin;}
  const roof=[];for(let k=0;k<8;k++){const n=(k+1)%8;roof.push([upper[k],collar[k],upper[n]],[upper[n],collar[k],collar[n]]);}
  loft(upper,collar,3);loft(collar,inner,4);
  const onRoof=(x,z)=>{const ray=new T.Ray(new T.Vector3(x,1,z),new T.Vector3(0,-1,0)),hit=new T.Vector3();for(const face of roof){const vs=face.map(q=>new T.Vector3(...q));if(ray.intersectTriangle(...vs,false,hit)){const bary=T.Triangle.getBarycoord(hit,...vs,new T.Vector3()),ww=new Map();for(let k=0;k<3;k++){const b=face[k].bone??j;ww.set(b,(ww.get(b)||0)+bary.getComponent(k));}const q=[hit.x,hit.y+.003,hit.z];q.weights=[...ww];return q;}}return null;};
  // Tres cordones planos sobre el empeine, sin nudos diminutos.
  for(let n=0;n<3;n++){const z=cz+d*(.22+n*.075),hw=w*.22,hz=.007;const q=[onRoof(cx-hw,z-hz),onRoof(cx-hw,z+hz),onRoof(cx+hw,z-hz),onRoof(cx+hw,z+hz)];if(q.every(Boolean)){tri(q[0],q[1],q[2],5);tri(q[2],q[1],q[3],5);}}
  ranges.push({start,count:P.count+pos.length/3-start,slot:'shoes',role:'shoes',id:'calzado:tenis-bajos',side});
  // Conservar el pie completo en partSource; sólo omitir lo cubierto al dibujar.
  for(const r of parts)if(['body','skin'].includes(r.role))for(let i=r.start;i<r.start+r.count;i+=3)if([0,1,2].every(k=>[j,sk.bones.findIndex(b=>b.name==='LowerLeg'+side)].includes(dominant(i+k))&&P.getY(i+k)<.212))hidden.push(i);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
 g.computeVertexNormals();if(!geo.attributes.normal)g.deleteAttribute('normal');
 const out=mergeGeometries([geo,g]);out.userData={...geo.userData,baseParts:ranges,wardrobeParts:ranges,shoesCovered:hidden};const kk=new Uint8Array(kinds.length+pos.length/3);kk.set(kinds);g.dispose();geo.dispose();return {geo:out,kinds:kk};
}

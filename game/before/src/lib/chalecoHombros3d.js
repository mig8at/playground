import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {selectTriangles,weightsAt} from './ropa3d.js';

// Bandas continuas sobre el hombro. Se ajustan a la superficie de la camiseta
// ya conformada (o a la piel), y mantienen la identidad de la prenda exterior.
// Compensar la apertura del hombro al posar conserva un recorrido frontal recto;
// se permite superponer el cuello de la camisa en lugar de rodearlo.
export function addVestShoulders(geo,kinds,contextura,sk){
 const parts=geo.userData.baseParts||[],vest=parts.find(r=>r.id==='ropero:chaleco-abierto');if(!vest)return {geo,kinds};
 const ranges=parts.filter(r=>r.role==='skin'||r.slot==='top'),ids=[];
 const head=new Set(sk.bones.map((b,i)=>b.name==='Head'?i:-1)),J=geo.attributes.skinIndex,W=geo.attributes.skinWeight;
 const P=geo.attributes.position;
 for(const r of ranges)for(let i=r.start;i<r.start+r.count;i+=3)if([0,1,2].every(k=>P.getY(i+k)<2.10&&P.getY(i+k)>1.45&&![0,1,2,3].some(j=>head.has(J.getComponent(i+k,j))&&W.getComponent(i+k,j)>.3)))ids.push(i);
 const surface=selectTriangles(geo,ids),SP=surface.attributes.position,ray=new T.Ray(),hit=new T.Vector3(),tri=new T.Triangle();
 function sample(x,angle,attempt=0){
  const direction=new T.Vector3(0,Math.sin(angle),Math.cos(angle)),center=new T.Vector3(x,1.67,0);ray.set(center.clone().addScaledVector(direction,4),direction.clone().negate());let best=null;
  for(let i=0;i<SP.count;i+=3){tri.setFromAttributeAndIndices(SP,i,i+1,i+2);if(!ray.intersectTriangle(tri.a,tri.b,tri.c,false,hit)||best&&hit.clone().sub(center).dot(direction)<=best.depth)continue;
   const n=tri.getNormal(new T.Vector3());if(n.dot(direction)<0)n.negate();best={p:hit.clone(),n,depth:hit.clone().sub(center).dot(direction),...weightsAt(surface,[i,i+1,i+2],tri.getBarycoord(hit,new T.Vector3()))};}
  if(!best){if(attempt<12)return sample(x*.97,angle,attempt+1);throw Error('No se pudo ajustar el hombro: '+[x,angle]);}
  best.p.addScaledVector(direction,.065-.04*Math.pow(Math.sin(angle),4));return best;
 }
 const fat=contextura==='gordo',robust=contextura==='robusto',left=fat?.28:robust?.255:.235,right=fat?.41:robust?.385:.365;
 const color=new T.Color('#786b50'),edge=color.clone().multiplyScalar(.92),data={position:[],color:[],skinIndex:[],skinWeight:[]};
 const face=(a,b,c,col)=>{for(const v of [a,b,c]){data.position.push(...v.p);data.color.push(...col.toArray());data.skinIndex.push(...v.j);data.skinWeight.push(...v.w);}};
 for(const side of [-1,1]){
  const rows=[];
  for(const x of [left,left+.025,right-.025,right]){const row=[];for(let n=0;n<=32;n++){const a=n*Math.PI/32;row.push(sample(side*x*(1-.3*Math.sin(a)),a));}rows.push(row);}
  for(let w=0;w<3;w++)for(let n=0;n<32;n++){const col=w===1?color:edge;face(rows[w][n],rows[w+1][n],rows[w][n+1],col);face(rows[w+1][n],rows[w+1][n+1],rows[w][n+1],col);}
 }
 surface.dispose();const detail=new T.BufferGeometry();for(const [name,values] of Object.entries(data))detail.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='skinWeight'?4:3));if(geo.attributes.normal)detail.computeVertexNormals();
 const count=data.position.length/3,out=mergeGeometries([geo,detail]),rangesOut=[...parts,{id:vest.id,slot:'outer',role:'top',start:P.count,count,followSkin:true,vestShoulders:true}];out.userData={...geo.userData,baseParts:rangesOut,wardrobeParts:rangesOut};const next=new Uint8Array(kinds.length+count);next.set(kinds);next.fill(2,kinds.length);geo.dispose();detail.dispose();return {geo:out,kinds:next};
}

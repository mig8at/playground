import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {selectTriangles,weightsAt} from './ropa3d.js';

// Capucha bajada: cuenco de tela sobre la espalda, con su borde doblado.
// Muestrea la prenda exterior si existe; conserva la identidad de la sudadera.
export function addHoodDetails(geo,kinds){
 const parts=geo.userData.baseParts||[],shirt=parts.find(r=>r.id==='ropero:sudadera-capucha');
 if(!shirt)return {geo,kinds};
 const surface=r=>{const ids=[];for(let i=r.start;i<r.start+r.count;i+=3)ids.push(i);return selectTriangles(geo,ids);};
 const cloth=surface(shirt),outer=parts.find(r=>['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(r.id)),back=outer&&!outer.id.startsWith('ropero:chaleco-')?surface(outer):cloth;
 const ray=new T.Ray(),hit=new T.Vector3(),tri=new T.Triangle();
 const sample=(g,x,y,side,lift)=>{
  const P=g.attributes.position;ray.set(new T.Vector3(x,y,side*3),new T.Vector3(0,0,-side));let result=null;
  for(let i=0;i<P.count;i+=3){tri.setFromAttributeAndIndices(P,i,i+1,i+2);if(!ray.intersectTriangle(tri.a,tri.b,tri.c,false,hit)||result&&hit.z*side<=result.p.z*side)continue;
   const n=tri.getNormal(new T.Vector3());if(n.z*side<0)n.negate();result={p:hit.clone(),n,...weightsAt(g,[i,i+1,i+2],tri.getBarycoord(hit,new T.Vector3()))};}
  if(result)result.p.addScaledVector(result.n,lift+(side===-1&&outer?.id.startsWith('ropero:chaleco-')?.075:0));return result;
 };
 const P=cloth.attributes.position,C=cloth.attributes.color,color=new T.Color(C.getX(0),C.getY(0),C.getZ(0)),data={position:[],color:[],skinIndex:[],skinWeight:[]};
 const face=(a,b,c,col)=>{if(!a||!b||!c)throw Error('No se pudo ajustar la capucha a la prenda');for(const v of [a,b,c]){data.position.push(...v.p);data.color.push(col.r,col.g,col.b);data.skinIndex.push(...v.j);data.skinWeight.push(...v.w);}};
 let neck=-Infinity;for(let i=0;i<P.count;i++)if(Math.abs(P.getX(i))<.12)neck=Math.max(neck,P.getY(i));
 let rear=neck;while(rear>neck-.3&&!sample(back,0,rear,-1,0))rear-=.005;
 const cy=rear-.25,N=10,edge=[],lip=[],base=[];
 for(let n=0;n<N;n++){
  const a=n*2*Math.PI/N,x=Math.sin(a)*.27*(.85+.15*Math.cos(a)),y=cy+Math.cos(a)*.225;
  base.push(sample(back,x,y,-1,.045));edge.push(sample(back,x,y,-1,.065));
  lip.push(sample(back,x*.77,cy+(y-cy)*.77,-1,.12+.04*Math.cos(a)));
 }
 const center=sample(back,0,cy,-1,.08),lining=color.clone().multiplyScalar(.64),rim=color.clone().multiplyScalar(.86);
 for(let n=0;n<N;n++){const j=(n+1)%N;face(base[n],base[j],edge[n],color);face(base[j],edge[j],edge[n],color);face(edge[n],edge[j],lip[n],rim);face(edge[j],lip[j],lip[n],rim);face(lip[n],lip[j],center,lining);}
 const hoodCount=data.position.length/3;
 // Cordones cortos apoyados en el pecho: no cuelgan sobre brazos ni barriga.
 let front=neck;while(front>neck-.3&&!sample(cloth,.08,front,1,0))front-=.005;
 const cord=new T.Color('#e3ddcb');
 for(const side of [-1,1])for(let k=0;k<4;k++){
  const y0=front-.06-k*.045,y1=y0-.045,x0=side*(.075+k*.004),x1=side*(.075+(k+1)*.004);
  const a=sample(cloth,x0-.008,y0,1,.012),b=sample(cloth,x0+.008,y0,1,.012),c=sample(cloth,x1-.008,y1,1,.012),d=sample(cloth,x1+.008,y1,1,.012);
  const col=k===3?cord.clone().multiplyScalar(.62):cord;face(a,b,c,col);face(b,d,c,col);
 }
 cloth.dispose();if(back!==cloth)back.dispose();
 const details=new T.BufferGeometry();for(const [name,values] of Object.entries(data))details.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='skinWeight'?4:3));
 if(geo.attributes.normal)details.computeVertexNormals();const out=mergeGeometries([geo,details]),count=data.position.length/3;
 const start=geo.attributes.position.count;
 const ranges=[...parts,{id:shirt.id,slot:'top',role:'top',start,count:hoodCount,followSkin:true,hoodDetails:true,hoodPanel:true},{id:shirt.id,slot:'top',role:'top',start:start+hoodCount,count:count-hoodCount,followSkin:true,hoodDetails:true,hoodCords:true}];
 out.userData={...geo.userData,baseParts:ranges,wardrobeParts:ranges};const kk=new Uint8Array(kinds.length+count);kk.set(kinds);kk.fill(2,kinds.length);details.dispose();geo.dispose();return {geo:out,kinds:kk};
}

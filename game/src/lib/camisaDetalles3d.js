import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {selectTriangles,weightsAt} from './ropa3d.js';

// Cuello doblado y botones sobre la superficie ya adaptada a la contextura.
export function addButtonShirtDetails(geo,kinds,outer=false){
 const parts=geo.userData.baseParts||[],shirt=parts.find(r=>(outer?['ropero:chaqueta-cerrada']:['ropero:camisa-botones','ropero:polo','ropero:camisa-manga-larga']).includes(r.id));if(!shirt)return {geo,kinds};
 const polo=shirt.id==='ropero:polo';
 const ids=[];for(let i=shirt.start;i<shirt.start+shirt.count;i+=3)ids.push(i);
 const cloth=selectTriangles(geo,ids),P=cloth.attributes.position,C=cloth.attributes.color;
 const ray=new T.Ray(new T.Vector3(),new T.Vector3(0,0,-1)),hit=new T.Vector3(),tri=new T.Triangle(),data={position:[],color:[],skinIndex:[],skinWeight:[]};
 const sample=(x,y,lift=.012)=>{ray.origin.set(x,y,3);let found=null;for(let i=0;i<P.count;i+=3){tri.setFromAttributeAndIndices(P,i,i+1,i+2);if(!ray.intersectTriangle(tri.a,tri.b,tri.c,false,hit))continue;if(found&&hit.z<=found.p.z)continue;const n=tri.getNormal(new T.Vector3());if(n.z<0)n.negate();found={p:hit.clone(),n,...weightsAt(cloth,[i,i+1,i+2],tri.getBarycoord(hit,new T.Vector3()))};}if(found)found.p.addScaledVector(found.n,lift);return found;};
 const color=new T.Color(C.getX(0),C.getY(0),C.getZ(0)),collar=color.clone().lerp(new T.Color('#eef1e8'),.35),button=new T.Color('#e3ddd0');
 const face=(a,b,c,col)=>{if(!a||!b||!c)return;for(const v of [a,b,c]){data.position.push(...v.p);data.color.push(col.r,col.g,col.b);data.skinIndex.push(...v.j);data.skinWeight.push(...v.w);}};
 let high=-Infinity,low=Infinity;for(let i=0;i<P.count;i++)if(Math.abs(P.getX(i))<.20){high=Math.max(high,P.getY(i));low=Math.min(low,P.getY(i));}
 // Buscar el borde delantero del cuello: evita colocar las puntas en el hueco.
 let neck=high;while(neck>low&&!sample(.06,neck))neck-=.008;
 if(!outer)for(const side of [-1,1]){
  const a=sample(side*.045,neck-.025,.021),b=sample(side*.19,neck-.075,.018),c=sample(side*.105,neck-.22,.023),d=sample(side*.025,neck-.12,.024);
  if(a&&b&&c&&d){face(a,b,c,collar);face(a,c,d,collar.clone().multiplyScalar(.91));}
 }
 const bottom=polo?neck-.36:low+.035,top=neck-(outer?.025:.10);
 for(let n=0;n<8;n++){const a=bottom+(top-bottom)*n/8,b=bottom+(top-bottom)*(n+1)/8;const q=[sample(-.023,a,.01),sample(.023,a,.01),sample(-.023,b,.01),sample(.023,b,.01)];face(q[0],q[1],q[2],color.clone().multiplyScalar(.82));face(q[1],q[3],q[2],color.clone().multiplyScalar(.82));}
 if(!outer)for(let y=polo?neck-.30:low+.12;y<neck-(polo?.14:.20);y+=polo?.10:.16){
  const center=sample(0,y,.017);if(!center)continue;const ring=[];
  for(let k=0;k<6;k++){const a=k*Math.PI/3;ring.push(sample(Math.cos(a)*.018,y+Math.sin(a)*.018,.018));}
  for(let k=0;k<6;k++)face(center,ring[k],ring[(k+1)%6],button);
 }
 if(outer){
  // Cremallera plana continua, con cursor de cuatro caras; sin dientes diminutos.
  const metal=new T.Color('#b5b7b2');
  for(let n=0;n<12;n++){const y0=bottom+(top-bottom)*n/12,y1=bottom+(top-bottom)*(n+1)/12;
   const q=[sample(-.006,y0,.019),sample(.006,y0,.019),sample(-.006,y1,.019),sample(.006,y1,.019)];face(q[0],q[1],q[2],metal);face(q[1],q[3],q[2],metal);}
  const q=[sample(-.014,top-.045,.025),sample(.014,top-.045,.025),sample(-.014,top-.09,.025),sample(.014,top-.09,.025)];face(q[0],q[1],q[2],metal);face(q[1],q[3],q[2],metal);
 }
 cloth.dispose();if(!data.position.length)return {geo,kinds};
 const details=new T.BufferGeometry();for(const [name,values] of Object.entries(data))details.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='skinWeight'?4:3));
 if(geo.attributes.normal)details.computeVertexNormals();const out=mergeGeometries([geo,details]),count=data.position.length/3;
 const ranges=[...parts,{id:shirt.id,slot:shirt.slot,role:'top',start:geo.attributes.position.count,count,followSkin:true,shirtDetails:true}];
 out.userData={...geo.userData,baseParts:ranges,wardrobeParts:ranges};const kk=new Uint8Array(kinds.length+count);kk.set(kinds);kk.fill(2,kinds.length);details.dispose();geo.dispose();return {geo:out,kinds:kk};
}

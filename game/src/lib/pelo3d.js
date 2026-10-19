import * as T from 'three';
import {skinSurface} from './ropa3d.js';
// El nuevo pelo de Blender es una superficie continua. Las entradas se rebajan
// hacia el cuero; borrar un componente entero borraría ahora todo el peinado.
export function softenBalding(geos,skin,box,{entradas,coronilla,color}){
 const near=skinSurface(skin),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3()),p=new T.Vector3(),skinColor=new T.Color(color),smooth=T.MathUtils.smoothstep;
 for(const g of geos){const P=g.attributes.position,C=g.attributes.color;for(let i=0;i<P.count;i++){p.fromBufferAttribute(P,i);const u=(p.y-box.min.y)/size.y,f=(p.z-center.z)/(size.z/2),x=Math.abs(p.x-center.x)/(size.x/2);
  const recede=entradas?smooth(f,.05,.3)*smooth(x,.28,.48)*smooth(u,.64,.73)*(1-smooth(u,.87,.96)):0;
  const crown=coronilla?smooth(u,.77,.85)*(1-smooth(Math.hypot(x/ .75,(f+.15)/ .8),.55,1)):0,amount=Math.max(recede,crown);if(amount<=0)continue;const e=near(p);if(!e)continue;p.lerp(e.p.clone().addScaledVector(e.n,.006),amount);P.setXYZ(i,p.x,p.y,p.z);const c=new T.Color(C.getX(i),C.getY(i),C.getZ(i)).lerp(skinColor,smooth(amount,.25,.9));C.setXYZ(i,c.r,c.g,c.b);
 }}
}

/* Instancias con nivel de detalle (FUGA, 2026-10-11): cada cosa tiene un modelo detallado para cerca (hi) y, si hace
   falta, uno liviano para lejos (lo: null = de lejos no se dibuja). Cada modelo es UNA InstancedMesh por pieza con lugar
   para todas sus instancias; update() sólo reparte cuáles van en cuál (count). Las llamadas de dibujo no cambian.
   items: {hi, lo, x, y, z, ry, sHi, sLo, tint}; kits: {hi: kit, lo: kit} (los de nature3d.js: {parts, box}). */
import * as THREE from 'three';

export function lodInstances(group,kits,items,{near=70,shadow=true,step=6}={}){
 const o=new THREE.Object3D(),col=new THREE.Color(),models=new Map();
 // Un modelo de un kit: sus piezas en instancias, con lugar para n.
 const modelOf=(which,name)=>{const k=which+':'+name;if(models.has(k))return models.get(k);const m=kits[which]?.[name];if(!m){models.set(k,null);return null;}
  const M={ims:m.parts.map(p=>{const im=new THREE.InstancedMesh(p.geometry,p.materials,1);im.count=0;im.castShadow=shadow;im.receiveShadow=true;im.frustumCulled=false;group.add(im);return im;}),cap:0,list:[]};
  models.set(k,M);return M;};
 const mat=(it,s)=>{o.position.set(it.x,it.y,it.z);o.rotation.set(0,it.ry||0,0);o.scale.setScalar(s);o.updateMatrix();return o.matrix.clone();};
 for(const it of items){it.H=it.hi?modelOf('hi',it.hi):null;it.L=it.lo?modelOf('lo',it.lo):null;if(it.H){it.H.cap++;it.mH=mat(it,it.sHi??1);}if(it.L){it.L.cap++;it.mL=mat(it,it.sLo??1);}}
 // Las InstancedMesh se rehacen con su capacidad final.
 for(const M of models.values()){if(!M)continue;M.ims=M.ims.map(im=>{group.remove(im);const n=new THREE.InstancedMesh(im.geometry,im.material,Math.max(1,M.cap));n.count=0;n.castShadow=im.castShadow;n.receiveShadow=true;n.frustumCulled=false;group.add(n);im.dispose();return n;});}
 let lx=1e9,lz=1e9;
 // (lejos: lo que queda más allá —el fin de la niebla, más el radio de un árbol— no se pone: no se ve. 2026-10-16, medido en
 // el navegador sin ventana: los árboles de los jardines del monte se dibujaban todos, también desde adentro de un
 // edificio de la ciudad)
 let ll=Infinity;
 function update(cx,cz,force=false,lejos=Infinity){if(!force&&(cx-lx)**2+(cz-lz)**2<step*step&&lejos===ll)return;lx=cx;lz=cz;ll=lejos;const far2=(lejos+12)**2;
  for(const M of models.values())if(M)M.n=0;
  const put=(M,m,tint)=>{const i=M.n++;for(const im of M.ims){im.setMatrixAt(i,m);if(tint)im.setColorAt(i,col.set(tint));}};
  for(const it of items){const d2=(it.x-cx)**2+(it.z-cz)**2;if(d2>far2)continue;const near2=d2<(it.near??near)**2;if(near2&&it.H)put(it.H,it.mH,it.tint);else if(!near2&&it.L)put(it.L,it.mL,it.tint);}
  for(const M of models.values())if(M)for(const im of M.ims){im.count=M.n;im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}}
 update(0,0,true);
 const calls=()=>[...models.values()].reduce((a,M)=>a+(M?M.ims.length:0),0);
 return {update,calls,
  // triángulos dibujados ahora
  tris(){let t=0;for(const M of models.values())if(M)for(const im of M.ims)t+=im.count*im.geometry.attributes.position.count/3;return t;}};
}

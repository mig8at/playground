import * as THREE from 'three';
let profilePromise;
export function loadHemProfile(){return profilePromise??=fetch('/models/dobladillos/perfil.json').then(r=>{if(!r.ok)throw new Error('Perfil de dobladillos no disponible');return r.json();});}

// Sobre la ropa ya ajustada a la piel. Cada dobladillo comparte sus pesos y colores
// y se une a la misma malla del personaje: no agrega materiales ni dibujos por cuadro.
export function clothHems(g,style,{role='top',hip=1}={}){
 const P=g.attributes.position,C=g.attributes.color,J=g.attributes.skinIndex,W=g.attributes.skinWeight;if(!P||!C||!J||!W)return null;
 const nodes=new Map(),edges=new Map(),points=[],indices=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
 const key=i=>[P.getX(i),P.getY(i),P.getZ(i)].map(v=>Math.round(v*1e4)).join(',');
 for(let i=0;i<P.count;i++){
  const k=key(i);let n=nodes.get(k);if(!n){n={id:points.length,src:i,p:new THREE.Vector3().fromBufferAttribute(P,i),n:new THREE.Vector3(),adj:[],inward:new THREE.Vector3()};nodes.set(k,n);points.push(n);}indices.push(n.id);
 }
 for(let i=0;i<P.count;i+=3){const ids=indices.slice(i,i+3);if(new Set(ids).size<3)continue;
  a.copy(points[ids[0]].p);b.copy(points[ids[1]].p);c.copy(points[ids[2]].p);normal.subVectors(b,a).cross(c.clone().sub(a));
  for(const id of ids)points[id].n.add(normal);
  for(let k=0;k<3;k++){
   const x=ids[k],y=ids[(k+1)%3],z=ids[(k+2)%3],ek=x<y?x+','+y:y+','+x;
   let edge=edges.get(ek);if(edge)edge.count++;else edges.set(ek,{x,y,z,count:1});
  }
 }
 for(const e of edges.values())if(e.count===1){const x=points[e.x],y=points[e.y],z=points[e.z];x.adj.push(e.y);y.adj.push(e.x);
  const tangent=y.p.clone().sub(x.p).normalize(),inward=z.p.clone().sub(x.p.clone().lerp(y.p,.5));inward.addScaledVector(tangent,-inward.dot(tangent)).normalize();x.inward.add(inward);y.inward.add(inward);
 }
 const loops=[],visited=new Set();
 for(const start of points){if(visited.has(start.id)||start.adj.length!==2)continue;let prev=-1,at=start.id,loop=[];
  while(!visited.has(at)&&points[at].adj.length===2){visited.add(at);loop.push(at);const next=points[at].adj.find(n=>n!==prev);prev=at;at=next;}
  if(at===start.id&&loop.length>=6)loops.push(loop);
 }
 const pos=[],colors=[],ji=[],weights=[];let accepted=0;
 for(const loop of loops){
  const box=new THREE.Box3(),center=new THREE.Vector3();let perimeter=0;
  for(let i=0;i<loop.length;i++){const p=points[loop[i]].p;box.expandByPoint(p);center.add(p);perimeter+=p.distanceTo(points[loop[(i+1)%loop.length]].p);}center.divideScalar(loop.length);
  if(perimeter<.22||perimeter>5.5)continue;const size=box.getSize(new THREE.Vector3());
  // Cinturas bajo el cinturón y huecos de botones/corbatas no son bajos de prendas.
  if(role==='pants'&&center.y>hip-.2)continue;
  if(role==='skirt'&&center.y>hip+.1)continue;
  if(role==='inner'&&Math.abs(center.x)<.45)continue;
  // Los frentes abiertos y solapas conservan su corte; aquí sólo terminaciones cerradas.
  if(size.y>.4&&size.x>.15&&Math.abs(center.x)<.45)continue;
  let width=style.width;
  if(size.y>.16&&size.x<.18)width*=.85; // boca de manga en la pose de atado
  if(role==='pants')width*=1.2;
  if(role==='skirt')width*=.95;
  const rings=loop.map(id=>{const p=points[id];p.n.normalize();const inward=p.inward.clone().addScaledVector(p.n,-p.inward.dot(p.n)).normalize();return style.profile.map(([u,v])=>p.p.clone().addScaledVector(inward,u*width).addScaledVector(p.n,v*style.thickness));});
  const emit=(i,row,tone)=>{const p=points[loop[i]],s=p.src,v=rings[i][row];pos.push(v.x,v.y,v.z);colors.push(C.getX(s)*tone,C.getY(s)*tone,C.getZ(s)*tone);for(let k=0;k<4;k++){ji.push(J.getComponent(s,k));weights.push(W.getComponent(s,k));}};
  for(let row=0;row<style.profile.length-1;row++)for(let i=0;i<loop.length;i++){const k=(i+1)%loop.length,tone=style.tones[row]??1;
   for(const tri of [[[i,row],[k,row],[k,row+1]],[[i,row],[k,row+1],[i,row+1]]]){
    const [A,B,D]=tri.map(([v,r])=>rings[v][r]);normal.subVectors(B,A).cross(c.copy(D).sub(A));
    if(normal.dot(points[loop[i]].n)<0)[tri[1],tri[2]]=[tri[2],tri[1]];
    for(const [v,r] of tri)emit(v,r,tone);
   }
  }accepted++;
 }
 if(!pos.length)return null;
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));out.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));out.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ji,4));out.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 out.userData={...g.userData,dobladillo:true,hemLoops:accepted};return out;
}

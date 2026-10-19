import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {clothHems} from './dobladillos3d.js';
let catalogPromise;
const catalog=()=>catalogPromise??=fetch('/models/accesorios/pulidos.json').then(r=>{if(!r.ok)throw new Error('Catálogo de accesorios no disponible');return r.json();});
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const namedColor=(value,colors,fallback)=>colors[value]||(typeof value==='string'&&value.startsWith('#')?value:colors[fallback]);
const XYZ=[V(1,0,0),V(0,1,0),V(0,0,1)];
const metal='#b8bcb9',darkMetal='#737d80';
function slice(geo,range){const g=new THREE.BufferGeometry();for(const [name,a] of Object.entries(geo.attributes))g.setAttribute(name,new THREE.BufferAttribute(a.array.slice(range.start*a.itemSize,(range.start+range.count)*a.itemSize),a.itemSize));return g;}
function vertex(g,i){return {p:V().fromBufferAttribute(g.attributes.position,i),c:V().fromBufferAttribute(g.attributes.color,i),j:[0,1,2,3].map(k=>g.attributes.skinIndex.getComponent(i,k)),w:[0,1,2,3].map(k=>g.attributes.skinWeight.getComponent(i,k))};}
function mix(a,b,t){const weights=new Map();for(let k=0;k<4;k++){weights.set(a.j[k],(weights.get(a.j[k])||0)+a.w[k]*(1-t));weights.set(b.j[k],(weights.get(b.j[k])||0)+b.w[k]*t);}const ws=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=ws.reduce((s,v)=>s+v[1],0);while(ws.length<4)ws.push([0,0]);return {p:a.p.clone().lerp(b.p,t),c:a.c.clone().lerp(b.c,t),j:ws.map(a=>a[0]),w:ws.map(a=>a[1]/sum)};}
function interpolate(a,b,c,u,v){const total=u+v;return total<1e-8?a:mix(a,mix(b,c,v/total),total);}
// Intersección con la prenda real, para colocar los detalles sobre una panza curva.
const trianglesCache=new WeakMap();
function triangles(g){if(!trianglesCache.has(g)){const tris=[];for(let i=0;i<g.attributes.position.count;i+=3){const a=vertex(g,i),b=vertex(g,i+1),c=vertex(g,i+2),dx=b.p.x-a.p.x,dy=b.p.y-a.p.y,ex=c.p.x-a.p.x,ey=c.p.y-a.p.y;tris.push({a,b,c,dx,dy,ex,ey,det:dx*ey-dy*ex});}trianglesCache.set(g,tris);}return trianglesCache.get(g);}
function hit(gs,x,y,back=false){let best=null;for(const g of gs)for(const t of triangles(g)){const {a,b,c,dx,dy,ex,ey,det}=t;if(Math.abs(det)<1e-8)continue;
 const u=((x-a.p.x)*ey-(y-a.p.y)*ex)/det,v=(dx*(y-a.p.y)-dy*(x-a.p.x))/det;if(u<-.0001||v<-.0001||u+v>1.0001)continue;const cu=THREE.MathUtils.clamp(u,0,1),cv=THREE.MathUtils.clamp(v,0,1-cu),p=interpolate(a,b,c,cu,cv);if(!best||(back?p.p.z<best.p.z:p.p.z>best.p.z))best=p;
 }return best;}
function nearest(g,x,y,back=false){const P=g.attributes.position;let best=null,d=Infinity;for(let i=0;i<P.count;i++){const z=P.getZ(i);if(back?z>0:z<0)continue;const nd=(P.getX(i)-x)**2+(P.getY(i)-y)**2;if(nd<d){best=vertex(g,i);d=nd;}}return best;}


function eyeHeight(g,fallback){
 if(!g)return fallback;const P=g.attributes.position,nodes=new Map(),ids=[],points=[],parents=[];
 const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let i=0;i<P.count;i++){const p=V().fromBufferAttribute(P,i),key=p.toArray().map(v=>Math.round(v*1e5)).join(',');let id=nodes.get(key);if(id===undefined){id=points.length;nodes.set(key,id);points.push(p);parents.push(id);}ids.push(id);}
 for(let i=0;i<ids.length;i+=3){parents[find(ids[i+1])]=find(ids[i]);parents[find(ids[i+2])]=find(ids[i]);}
 const boxes=new Map();for(let i=0;i<points.length;i++){const root=find(i);if(!boxes.has(root))boxes.set(root,new THREE.Box3());boxes.get(root).expandByPoint(points[i]);}
 const eyes=[...boxes.values()].filter(b=>b.max.y-b.min.y>(b.max.x-b.min.x)*.9);return eyes.length?eyes.reduce((s,b)=>s+(b.min.y+b.max.y)/2,0)/eyes.length:fallback;
}

// Se agregan tras shapeBody: las hebillas, monturas y cajas del reloj conservan su
// tamaño; la correa y las piezas de tela toman los pesos del punto que las sostiene.
export async function polishAccessories(geo,sk,L,ranges,kinds,{root,idle}={}){
 let owner={id:'accessory',slot:'accessory'};const assets=await catalog(),extras=[],extraKinds=[],stats={belt:0,tie:0,watch:0,glasses:0,backpack:0,suspenders:0};
 const parts=ranges.map(r=>({...r,g:slice(geo,r)})),P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight;
 const bone=n=>sk.bones.findIndex(b=>b.name===n),rest=i=>V().setFromMatrixPosition(sk.boneInverses[i].clone().invert());
 const add=(g,kind=0)=>{if(g?.attributes.position.count){g.userData.wardrobeOwner={id:owner.id,slot:owner.slot};extras.push(g);extraKinds.push(kind);}};
 const bindAsset=(name,anchor,palette,axes=XYZ,scale=V(1,1,1))=>{
  const transform=new THREE.Matrix4().makeBasis(axes[0],axes[1],axes[2]).scale(scale).setPosition(anchor.p);
  for(const part of assets[name].parts){let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(part.pos,3));g.setIndex(part.idx);g.applyMatrix4(transform);g=g.toNonIndexed();const n=g.attributes.position.count,c=new THREE.Color(palette[part.role]||'#888888'),colors=[],ji=[],weights=[];
   for(let i=0;i<n;i++){colors.push(c.r,c.g,c.b);ji.push(...anchor.j);weights.push(...anchor.w);}g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ji,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));add(g);
  }
 };
 const box=(anchor,size,color,axes=XYZ)=>{const g=new THREE.BoxGeometry(size.x,size.y,size.z).toNonIndexed();g.deleteAttribute('uv');g.deleteAttribute('normal');g.applyMatrix4(new THREE.Matrix4().makeBasis(...axes).setPosition(anchor.p));const n=g.attributes.position.count,c=new THREE.Color(color),cl=[],ji=[],ww=[];for(let i=0;i<n;i++){cl.push(c.r,c.g,c.b);ji.push(...anchor.j);ww.push(...anchor.w);}g.setAttribute('color',new THREE.Float32BufferAttribute(cl,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ji,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(ww,4));add(g);};
 const shifted=(p,d)=>({...p,p:p.p.clone().add(d)});
 const sheet=tris=>{const pos=[],colors=[],ji=[],ww=[];for(const tri of tris)for(const v of tri){pos.push(...v.p.toArray());colors.push(...v.c.toArray());ji.push(...v.j);ww.push(...v.w);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ji,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(ww,4));add(g,2);};
 const body=parts.filter(p=>['skin','top','inner'].includes(p.role)).map(p=>p.g);
 for(const part of parts.filter(p=>p.role==='belt')){
  owner=part;const g=part.g;g.computeBoundingBox();const bb=g.boundingBox,y=(bb.min.y+bb.max.y)/2;
  let anchor=hit([g],0,y);for(const dy of [.025,-.025,.05,-.05])if(!anchor)anchor=hit([g],0,y+dy);if(!anchor)anchor=nearest(g,0,y);if(!anchor)continue;
  anchor={...anchor,p:anchor.p.clone(),c:anchor.c.clone()};
  const detailParts=parts.filter(p=>p.role==='detail'&&/^Suit_/.test(p.model));
  const oldBuckle=hit(detailParts.map(p=>p.g),0,anchor.p.y);if(oldBuckle)anchor.p.z=Math.max(anchor.p.z,oldBuckle.p.z);
  for(const d of detailParts)for(let i=0;i<d.count;i+=3){const cy=(d.g.attributes.position.getY(i)+d.g.attributes.position.getY(i+1)+d.g.attributes.position.getY(i+2))/3;if(cy>anchor.p.y+.12)continue;for(let k=0;k<3;k++){geo.attributes.color.setXYZ(d.start+i+k,anchor.c.x,anchor.c.y,anchor.c.z);d.g.attributes.color.setXYZ(i+k,anchor.c.x,anchor.c.y,anchor.c.z);}}
  anchor=shifted(anchor,V(0,0,.009));bindAsset('buckle',anchor,{metal});
  const edge=clothHems(g,{profile:[[0,-.1],[.08,.8],[.75,1],[1,.05]],tones:[.8,.96,.85],width:.014,thickness:.008},{role:'belt'});add(edge,2);
  const center=anchor.p;for(const sign of [-1,1]){const p=hit([g],sign*.16,center.y)||nearest(g,sign*.16,center.y);if(p)bindAsset('keeper',shifted(p,V(0,0,.009)),{strap:'#'+new THREE.Color(p.c.x,p.c.y,p.c.z).multiplyScalar(.83).getHexString()});}
  stats.belt++;
 }
 for(const part of parts.filter(p=>p.role==='detail'&&/^Suit_/.test(p.model))){
  owner=part;const g=part.g;g.computeBoundingBox();const bb=g.boundingBox,half=Math.max(.04,(bb.max.x-bb.min.x)/2),hip=rest(bone('Hips')).y,folds=[];
  for(let i=0;i<g.attributes.position.count;i+=3){const tri=[0,1,2].map(k=>vertex(g,i+k)),center=tri.reduce((p,v)=>p.add(v.p),V()).multiplyScalar(1/3),normal=tri[1].p.clone().sub(tri[0].p).cross(tri[2].p.clone().sub(tri[0].p)).normalize();if(center.y<hip+.27||Math.abs(center.x)>.18||normal.z<.2)continue;
   for(const side of [-1,1]){const poly=[];for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],sa=a.p.x*side,sb=b.p.x*side;if(sa>=-1e-7)poly.push(a);if((sa>0)!==(sb>0)&&Math.abs(sa-sb)>1e-7)poly.push(mix(a,b,sa/(sa-sb)));}
    for(let k=1;k+1<poly.length;k++)folds.push([poly[0],poly[k],poly[k+1]].map(v=>({...v,p:v.p.clone().add(V(0,0,.009+.018*Math.max(0,1-Math.abs(v.p.x)/half))),c:v.c.clone().multiplyScalar(side<0?.92:1.07)})));
   }
  }
  if(folds.length){sheet(folds);const y=bb.max.y-.072,anchor=hit([g],0,y)||nearest(g,0,y);if(anchor){const fabric=new THREE.Color(anchor.c.x,anchor.c.y,anchor.c.z);bindAsset('tieKnot',shifted(anchor,V(0,0,.012)),{fabric:'#'+fabric.getHexString()});}stats.tie++;}
 }
 for(const part of parts.filter(p=>p.role==='detail'&&/^OldClassy_/.test(p.model))){owner=part;const g=part.g;
  for(const side of [-1,1]){const candidates=[];for(let i=0;i<g.attributes.position.count;i++){const p=vertex(g,i);if(p.p.z>0&&p.p.x*side>.08)candidates.push(p);}if(!candidates.length)continue;const low=Math.min(...candidates.map(p=>p.p.y)),bottom=candidates.filter(p=>p.p.y<low+.12),x=bottom.reduce((s,p)=>s+p.p.x,0)/bottom.length,y=low+.055;
   const p=hit([g],x,y)||nearest(g,x,y);if(p){bindAsset('clip',shifted(p,V(0,0,.012)),{metal:darkMetal});stats.suspenders++;}
  }
 }
 if(L.reloj&&L.reloj!=='no'){owner={id:'reloj:'+L.reloj,slot:'watch'};
  const side=L.relojLado==='derecha'?'R':'L',elbow=bone('LowerArm'+side),wrist=bone('Fist'+side);if(elbow>=0&&wrist>=0){
   const a=rest(elbow),end=rest(wrist),axis=end.clone().sub(a).normalize(),length=a.distanceTo(end)*(L.brazos||1),origin=a.clone().addScaledVector(axis,length*.965),normal=V(0,0,1);
   // El antebrazo del paquete tiene un giro en reposo. Orientar la esfera hacia
   // el frente en Idle y luego dejar que siga ese mismo hueso en todas las poses.
   if(root&&idle){const tm=new THREE.AnimationMixer(root),action=tm.clipAction(idle);action.play();action.paused=true;action.time=idle.duration*.5;tm.update(0);root.updateWorldMatrix(true,true);const deformation=new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(sk.bones[elbow].matrixWorld).multiply(sk.boneInverses[elbow]);normal.transformDirection(deformation.invert());tm.stopAllAction();tm.uncacheRoot(root);root.updateWorldMatrix(true,true);}
   normal.addScaledVector(axis,-normal.dot(axis)).normalize();const cross=normal.clone().cross(axis).normalize();let ry=.055,rz=.055;
   for(let i=0;i<P.count;i++){let weight=0;for(let k=0;k<4;k++)if(J.getComponent(i,k)===elbow)weight+=W.getComponent(i,k);if(weight<.7)continue;const p=V().fromBufferAttribute(P,i).sub(origin),along=p.dot(axis);if(Math.abs(along)>.065)continue;ry=Math.max(ry,Math.abs(p.dot(cross)));rz=Math.max(rz,Math.abs(p.dot(normal)));}
   ry=THREE.MathUtils.clamp(ry,.055,.16)+.009;rz=THREE.MathUtils.clamp(rz,.055,.16)+.009;
   const anchor={p:origin,j:[elbow,0,0,0],w:[1,0,0,0]},axes=[axis,cross,normal],leather=L.reloj!=='metal';bindAsset(leather?'watchLeather':'watchMetal',anchor,{strap:leather?'#4c3428':darkMetal},axes,V(.068,ry,rz));
   bindAsset('watchFace',shifted(anchor,normal.clone().multiplyScalar(rz*1.075)),{metal,dial:'#233237',mark:'#c5c8bc',hand:'#eee4c3'},axes);stats.watch++;
  }
 }
 if(L.gafas){owner={id:'gafas:'+L.gafas,slot:'glasses'};const skin=parts.find(p=>p.role==='skin'),head=bone('Head');if(skin&&head>=0){const bb=new THREE.Box3();for(let i=0;i<skin.g.attributes.position.count;i++){let w=0;for(let k=0;k<4;k++)if(skin.g.attributes.skinIndex.getComponent(i,k)===head)w+=skin.g.attributes.skinWeight.getComponent(i,k);if(w>.7)bb.expandByPoint(V().fromBufferAttribute(skin.g.attributes.position,i));}if(!bb.isEmpty()){
   const size=bb.getSize(V()),center=bb.getCenter(V()),face=parts.find(p=>p.role==='face'),y=eyeHeight(face?.g,center.y-size.y*.085),z=bb.max.z+.021,palette={frame:namedColor(L.gafas,{negras:'#26272a',carey:'#6d4a34',doradas:'#b5a36f',rojas:'#a83c34'},'negras')},anchor={p:V(),j:[head,0,0,0],w:[1,0,0,0]};
   for(const s of [-1,1]){anchor.p.set(center.x+s*size.x*.2,y,z);bindAsset('glassesFrame',anchor,palette,XYZ,V(size.x*.3,size.y*.155,.029));
    const path=[V(center.x+s*size.x*.35,y,z+.012),V(center.x+s*size.x*.51,y,z-size.z*.14),V(center.x+s*size.x*.51,y+.01,center.z-size.z*.03)];
    for(let i=0;i<2;i++){const dir=path[i+1].clone().sub(path[i]),length=dir.length();dir.normalize();const up=V(0,1,0),axes=[up,dir,up.clone().cross(dir).normalize()];box({...anchor,p:path[i].clone().lerp(path[i+1],.5)},V(.016,length,.016),palette.frame,axes);}
   }
   box({...anchor,p:V(center.x,y+size.y*.035,z+.012)},V(size.x*.12,.02,.019),palette.frame);stats.glasses++;
  }}
 }
 if(L.mochila){owner={id:'mochila:'+L.mochila,slot:'backpack'};const bag=parts.find(p=>p.role==='bag'),pocket=parts.find(p=>p.role==='bagPocket');if(bag){bag.g.computeBoundingBox();const bb=bag.g.boundingBox,center=bb.getCenter(V()),j=bone('Torso'),anchor={p:V(center.x,bb.max.y+.01,center.z),j:[j,0,0,0],w:[1,0,0,0]},color=namedColor(L.mochila,{café:'#6b5a44',negra:'#2a2c2e',azul:'#34507a',roja:'#9c3b2c',verde:'#4b6b42'},'café');
   const dark='#'+new THREE.Color(color).multiplyScalar(.68).getHexString();box({...anchor,p:V(center.x,bb.max.y+.045,center.z)},V(.21,.035,.045),dark);for(const x of [-.09,.09])box({...anchor,p:V(center.x+x,bb.max.y+.015,center.z)},V(.028,.06,.045),dark);
   if(pocket){pocket.g.computeBoundingBox();const pb=pocket.g.boundingBox,backAxes=[V(-1,0,0),V(0,1,0),V(0,0,-1)],p={...anchor,p:V(center.x,pb.max.y-.045,pb.min.z-.009)};box(p,V((pb.max.x-pb.min.x)*.7,.014,.011),dark,backAxes);bindAsset('zipPull',shifted(p,V(.11,-.018,-.005)),{metal},backAxes);}
   const torso=rest(j),neck=rest(bone('Neck')),top=neck.y-.2,bottom=torso.y-.2;
   for(const sign of [-1,1]){const path=[];const front=hit(body,sign*.23,top),rear=hit(body,sign*.23,top,true);if(front&&rear){path.push(shifted(rear,V(0,0,-.018)));const peak=mix(rear,front,.5);peak.p.y=top+.065;path.push(peak);}for(let i=0;i<7;i++){const t=i/6,y=top+(bottom-top)*t,x=sign*(.23+.035*Math.sin(Math.PI*t)),p=hit(body,x,y);if(p)path.push(shifted(p,V(0,0,.02)));}const tris=[];
    for(let i=0;i+1<path.length;i++){const a=path[i],b=path[i+1],width=.042;const quad=[shifted(a,V(-width/2,0,0)),shifted(a,V(width/2,0,0)),shifted(b,V(width/2,0,0)),shifted(b,V(-width/2,0,0))];const col=new THREE.Color(dark);for(const p of quad)p.c=V(col.r,col.g,col.b);tris.push([quad[0],quad[2],quad[1]],[quad[0],quad[3],quad[2]]);}
    sheet(tris);
   }stats.backpack++;
  }}
 if(!extras.length){geo.userData.wardrobeParts=ranges;geo.userData.baseParts=ranges;return {geo,kinds,stats};}
 const combined=mergeGeometries([geo,...extras]),newKinds=new Uint8Array(combined.attributes.position.count);newKinds.set(kinds);const wardrobeParts=[...ranges];let offset=kinds.length;for(let i=0;i<extras.length;i++){const n=extras[i].attributes.position.count;newKinds.fill(extraKinds[i],offset,offset+n);wardrobeParts.push({...extras[i].userData.wardrobeOwner,start:offset,count:n});offset+=n;}combined.userData.wardrobeParts=wardrobeParts;combined.userData.baseParts=ranges;combined.userData.accessoryStats=stats;
 return {geo:combined,kinds:newKinds,stats};
}

/* Las casas armadas en 3D (FUGA, 2026-10-11): dibuja los planos de src/engine/vivienda.js y deja caminarlas.
   - Paredes, pisos, techos y marcos de TODAS las casas van fundidos en una malla por material (colores por vértice):
     el barrio entero son unas ocho llamadas de dibujo, más una por pieza de cada modelo del paquete.
   - Ventanas y puertas son las del paquete de la casa (public/models/Casa), en instancias, estiradas a su vano. El
     vidrio es transparente (se ve para adentro y para afuera) y de noche se enciende. La hoja de la puerta gira hacia
     adentro cuando alguien se acerca; la del garaje sube.
   - Los muebles, en instancias (plantInstances).
   - Para caminar: floorAt (el piso más alto a menos de 45 cm de los pies, con la escalera como rampa), collide (las
     paredes, barandas y muebles a la altura del cuerpo) y dentro (si un punto está bajo techo).
   items: [{spec | plan, x, y, z, ry}]: la casa (opciones o plano ya hecho), dónde va su centro, a qué altura y su giro
   (el frente de la casa mira a +z antes de girar). */
import * as THREE from 'three';
import {planHouse,houseColor,FLOOR0} from '../engine/vivienda.js';
import {plantInstances} from './nature3d.js';
import {gridPath,approachOf} from './sitting3d.js';
import {kitModel} from './objetos3d.js';
import {LOWPOLY} from './downtown3d.js';

// Las tablas de las paredes: una textura de líneas que se tiñe con el color de la casa (una tabla cada 25 cm).
let sidingTex=null;
function siding(){if(sidingTex)return sidingTex;const c=document.createElement('canvas');c.width=64;c.height=256;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,64,256);
 for(let y=0;y<256;y+=21.33){g.fillStyle='rgba(0,0,0,.16)';g.fillRect(0,Math.round(y),64,2);g.fillStyle='rgba(255,255,255,.5)';g.fillRect(0,Math.round(y)+2,64,1);}
 sidingTex=new THREE.CanvasTexture(c);sidingTex.colorSpace=THREE.SRGBColorSpace;sidingTex.wrapS=sidingTex.wrapT=THREE.RepeatWrapping;return sidingTex;}

// Las tejas (texturas en grises que se tiñen con el color del techo; una hilera de alto, 1 m de ancho), en tonos
// planos para que sigan siendo low poly. Barro: cuatro canales por metro, con la cara de luz, la de sombra y la junta.
// Madera: tejuelas de ancho variable con su junta oscura y alguna veta.
const roofTex={};
function tileTex(kind){if(roofTex[kind])return roofTex[kind];const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');
 let seed=kind==='barro'?3:9;const r=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};const gray=v=>{const k=Math.round(255*Math.min(1,v));return `rgb(${k},${k},${k})`;};
 if(kind==='barro'){for(let i=0;i<4;i++){const x=i*64,t=.94+r()*.1;
   g.fillStyle=gray(.86*t);g.fillRect(x,0,64,64);g.fillStyle=gray(1.0*t);g.fillRect(x+10,0,26,64);g.fillStyle=gray(.92*t);g.fillRect(x+36,0,14,64);
   g.fillStyle=gray(.62);g.fillRect(x,0,5,64);g.fillStyle=gray(.74*t);g.fillRect(x,0,64,9);}}
 else{let x=0;while(x<256){const w=Math.round(30+r()*42),t=.82+r()*.2;g.fillStyle=gray(t);g.fillRect(x,0,w,64);
   if(r()<.5){g.fillStyle=gray(t*.93);g.fillRect(x+Math.round(w*(.25+r()*.5)),12,3,40);}g.fillStyle=gray(.5);g.fillRect(x,0,4,64);x+=w;}
  g.fillStyle=gray(.66);g.fillRect(0,0,256,7);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;t.anisotropy=4;roofTex[kind]=t;return t;}

// Una geometría del paquete partida por material (cada grupo, su geometría): así el marco de una ventana se pinta por
// instancia y el vidrio no.
function splitGroups(geo){if(!geo.groups.length)return [{geo,mi:0}];const out=[];
 for(const g of geo.groups){const ng=new THREE.BufferGeometry();for(const [k,a] of Object.entries(geo.attributes)){const n=a.itemSize;ng.setAttribute(k,new THREE.BufferAttribute(a.array.slice(g.start*n,(g.start+g.count)*n),n));}
  out.push({geo:ng,mi:g.materialIndex});}return out;}

// Si no se cargó Casa2 (loadCasa2), sus muebles caen en los del paquete de la casa (los que no tienen par, no van).
const FALLBACK={C2_Bed:'Bed_King',C2_Sofa:'Couch_Small2',C2_SofaDouble:'Couch_Medium2',C2_ChairCushioned:'Chair_1',C2_BookCaseBooks:'Bookshelf',C2_Closet2:'Drawer_1',C2_Lamp:'Light_Floor1'};
export function createHouses(items,{kit=null,shadows=true}={}){
 const group=new THREE.Group(),own=[];
 // (las hojas de las puertas de los cuartos: del catálogo de objetos, una por estilo; se estiran al vano como las del paquete)
 if(kit)kit={...kit,...Object.fromEntries(['tablero','lisa','vidrio','rejilla'].map(v=>['Leaf_'+v,kitModel('puerta',{variante:v})]))};
 const houses=items.map(it=>{const plan=it.plan||planHouse(it.spec||{}),ry=it.ry||0;return {plan,x:it.x||0,y:it.y||0,z:it.z||0,ry,c:Math.cos(ry),s:Math.sin(ry)};});
 // (2026-10-16, medido en el navegador sin ventana —validar-3d—: todas las casas iban fundidas en una malla por material y
 // la cámara no podía dejar afuera ninguna: desde adentro de un edificio de la ciudad se dibujaban 1,4 millones de
 // triángulos de casas que no se veían. Ahora por baldosas de BALDOSA m: la cámara deja afuera las que no mira y
 // fueraDeNiebla() las que quedan enteras detrás de la niebla)
 const BALDOSA=144,baldosaDe=(x,z)=>Math.floor(x/BALDOSA)+','+Math.floor(z/BALDOSA);for(const h of houses)h.t=baldosaDe(h.x,h.z);
 // ---------- La parte fija, fundida por material ----------
 // (LOWPOLY: las tablas y las tejas, lisas —el color de la casa, sin la textura—)
 const LP=LOWPOLY.on,MATS={tablas:LP?{roughness:.85,flatShading:true}:{map:siding(),roughness:.85},liso:{roughness:.9},interior:{roughness:.95,emissive:'#2e2b27'},zocalo:{roughness:.95},techo:{roughness:.8},teja_barro:LP?{roughness:.8,flatShading:true}:{map:tileTex('barro'),roughness:.8},teja_madera:LP?{roughness:.85,flatShading:true}:{map:tileTex('madera'),roughness:.85},madera:{roughness:.75},cielo:{roughness:1,emissive:'#5a564e'},marco:{roughness:.7},farol:{roughness:.4,emissive:'#ffc46b',emissiveIntensity:0},
  // (el vidrio de las ventanas de los cuartos —objetos3d ventana—: transparente; de noche, con la luz de adentro)
  vidrio:{transparent:true,opacity:.22,roughness:.05,metalness:.1,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffcf8a',emissiveIntensity:0}};
 const buf={},bufDe=(k,t)=>{const kk=k+'|'+t;return buf[kk]||(buf[kk]={p:[],n:[],c:[],u:[]});};
 const col=new THREE.Color();
 for(const h of houses){const {c,s}=h,W=(lx,ly,lz)=>[h.x+lx*c+lz*s,h.y+ly,h.z-lx*s+lz*c],N=(nx,ny,nz)=>[nx*c+nz*s,ny,-nx*s+nz*c];
  const tri=(B,a,b,d,n,ua,ub,ud)=>{for(const v of [a,b,d])B.p.push(...v);for(let i=0;i<3;i++){B.n.push(...n);B.c.push(col.r,col.g,col.b);}B.u.push(...ua,...ub,...ud);};
  for(const b of h.plan.boxes){const B=bufDe(MATS[b.cat]?b.cat:'liso',h.t);col.set(b.color);const {x0,x1,y0,y1,z0,z1}=b,k=1/3;
   const F=[[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0],'z'],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],'z'],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0],'y'],
    [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],'y'],[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],'x'],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1],'x']];
   for(const [a,bb,cc,d,n,ax] of F){if(n[1]<0&&y0<=.2)continue;// la cara de abajo de lo que apoya en el suelo no se ve
    const uv=v=>ax==='z'?[v[2]*k,v[1]*k]:ax==='x'?[v[0]*k,v[1]*k]:[v[0]*k,v[2]*k],nn=N(...n);
    tri(B,W(...a),W(...bb),W(...cc),nn,uv(a),uv(bb),uv(cc));tri(B,W(...a),W(...cc),W(...d),nn,uv(a),uv(cc),uv(d));}}
  // Caras inclinadas (techos, hastiales): de los dos lados.
  // (uv: las del plano, si trae; one: de un solo lado, el de la normal)
  for(const q of h.plan.quads){const B=bufDe(MATS[q.cat]?q.cat:'techo',h.t);col.set(q.color);const [a,b,cc,d]=q.p.map(v=>new THREE.Vector3(...v)),U=q.uv;
   const tris=[[a,b,cc,0,1,2]];if(d.distanceToSquared(cc)>1e-6)tris.push([a,cc,d,0,2,3]);
   for(const [p,qq,r,i0,i1,i2] of tris){const n=new THREE.Vector3().subVectors(qq,p).cross(new THREE.Vector3().subVectors(r,p));if(n.lengthSq()<1e-10)continue;n.normalize();
    const uv=(v,i)=>U?U[i]:[(v.x+v.z)/3,v.y/3];
    tri(B,W(p.x,p.y,p.z),W(qq.x,qq.y,qq.z),W(r.x,r.y,r.z),N(n.x,n.y,n.z),uv(p,i0),uv(qq,i1),uv(r,i2));
    if(!q.one)tri(B,W(p.x,p.y,p.z),W(r.x,r.y,r.z),W(qq.x,qq.y,qq.z),N(-n.x,-n.y,-n.z),uv(p,i0),uv(r,i2),uv(qq,i1));}}}
 let tris=0;const mats={};
 for(const [kk,B] of Object.entries(buf)){if(!B.p.length)continue;const k=kk.split('|')[0];const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(B.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(B.n,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(B.c,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(B.u,2));g.computeBoundingSphere();
  const m=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,...MATS[k]});(mats[k]||(mats[k]=[])).push(m);const mesh=new THREE.Mesh(g,m);mesh.castShadow=shadows&&k!=='cielo'&&k!=='vidrio';if(k==='vidrio')mesh.renderOrder=2;mesh.receiveShadow=true;mesh.name='casas:'+k;group.add(mesh);own.push(g,m);tris+=B.p.length/9;}

 // ---------- Ventanas, puertas y garajes ----------
 const glass=new THREE.MeshStandardMaterial({color:'#cfe4ee',transparent:true,opacity:.22,roughness:.05,metalness:.1,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffcf8a',emissiveIntensity:0});own.push(glass);
 const houseM=h=>new THREE.Matrix4().makeRotationY(h.ry).setPosition(h.x,h.y,h.z);
 // El marco del vano: el centro de abajo del vano sobre la línea de la pared, girado para que afuera sea +z.
 const frameOf=(h,o)=>{const pos=o.axis==='x'?new THREE.Vector3(o.c,o.y0,o.at):new THREE.Vector3(o.at,o.y0,o.c),r=o.axis==='x'?(o.out>0?0:Math.PI):(o.out>0?Math.PI/2:-Math.PI/2);
  return houseM(h).multiply(new THREE.Matrix4().makeRotationY(r).setPosition(pos));};
 const tint=new THREE.Color(),mm=new THREE.Matrix4();
 // Un modelo del paquete en instancias, por material: paint (el marco o la hoja) con el color de cada una; el vidrio aparte.
 const kitInstances=(name,list,paintName)=>{const m=kit?.[name];if(!m||!list.length)return [];const meshes=[];
  for(const part of m.parts){const mats=Array.isArray(part.materials)?part.materials:[part.materials];
   for(const {geo,mi} of splitGroups(part.geometry)){const src=mats[mi]||mats[0],isGlass=/glass/i.test(src.name),paint=src.name===paintName;
    const mat=isGlass?glass:paint?new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.7,flatShading:true}):src;if(paint)own.push(mat);
    const im=new THREE.InstancedMesh(geo,mat,list.length);list.forEach((it,i)=>{im.setMatrixAt(i,it.m);if(paint)im.setColorAt(i,tint.set(it.color));});
    im.castShadow=!isGlass&&shadows;im.receiveShadow=true;im.computeBoundingSphere();group.add(im);meshes.push(im);own.push(geo);tris+=geo.attributes.position.count/3*list.length;}}
  return meshes;};
 const wins={},doors=[],garages=[];
 for(const h of houses)for(const o of h.plan.openings){
  if(o.kind==='window'){const m=kit?.[o.m];if(!m)continue;const b=m.box,bw=b.max.x-b.min.x,bh=b.max.y-b.min.y,bd=b.max.z-b.min.z;
   const M=frameOf(h,o).multiply(mm.makeScale(o.w/bw,o.h/bh,.12/bd)).multiply(new THREE.Matrix4().makeTranslation(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2));
   (wins[o.m]||(wins[o.m]=[])).push({m:M,color:houseColorTrim(h)});}
  else if(o.kind==='door')doors.push({h,o,a:o.abierta?1:0,fija:!!o.abierta,frame:frameOf(h,o),color:houseColorDoor(h)});
  else if(o.kind==='garage')garages.push({h,o,a:0,frame:frameOf(h,o),color:o.color});}
 // (por baldosa, como la parte fija)
 const porBaldosa=list=>{const m=new Map();for(const it of list){const t=it.h?it.h.t:baldosaDe(it.m.elements[12],it.m.elements[14]);(m.get(t)||m.set(t,[]).get(t)).push(it);}return [...m.values()];};
 for(const [n,list] of Object.entries(wins))for(const sub of porBaldosa(list))kitInstances(n,sub,'White');
 // Las hojas: una instancia por puerta, agrupadas por modelo; la matriz cambia al abrirse.
 const leafM=d=>{const m=kit?.[d.o.m];const b=m.box,bw=b.max.x-b.min.x,bh=b.max.y-b.min.y;
  return d.frame.clone().multiply(new THREE.Matrix4().makeTranslation(d.o.w/2,0,0)).multiply(new THREE.Matrix4().makeRotationY(-1.5*d.a))
   .multiply(mm.makeScale(d.o.w/bw,d.o.h/bh,.45)).multiply(new THREE.Matrix4().makeTranslation(-b.max.x,-b.min.y,-(b.min.z+b.max.z)/2));};
 const byModel={};for(const d of doors)if(kit?.[d.o.m])(byModel[d.o.m]||(byModel[d.o.m]=[])).push(d);
 for(const [n,list0] of Object.entries(byModel))for(const list of porBaldosa(list0)){list.forEach((d,i)=>{d.i=i;d.m=leafM(d);});const meshes=kitInstances(n,list,'White');list.forEach(d=>{d.meshes=meshes;});}
 // El portón del garaje: un panel de tablas que gira hacia adentro y arriba desde su borde de arriba.
 const gGeo=new THREE.BoxGeometry(1,1,1),gMat=new THREE.MeshStandardMaterial(LOWPOLY.on?{roughness:.8,flatShading:true}:{map:siding(),roughness:.8});own.push(gGeo,gMat);
 const gIm=garages.length?new THREE.InstancedMesh(gGeo,gMat,garages.length):null;
 const garageM=g=>g.frame.clone().multiply(new THREE.Matrix4().makeTranslation(0,g.o.y0+g.o.h,0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI/2*.92*g.a))
  .multiply(new THREE.Matrix4().makeTranslation(0,-g.o.h/2,0)).multiply(mm.makeScale(g.o.w-.04,g.o.h-.02,.06));
 if(gIm){garages.forEach((g,i)=>{gIm.setMatrixAt(i,garageM(g));gIm.setColorAt(i,tint.set(g.color));});gIm.castShadow=shadows;group.add(gIm);}

 // ---------- Muebles ----------
 // Por zonas de 48 m: los muebles de una zona sólo se dibujan con la cámara cerca (update), porque sólo se ven por
 // las ventanas o desde adentro.
 const furnSolids=new Map(),ZONE=48,zones=new Map();
 if(kit){const zoneOf=h=>{const k=Math.floor(h.x/ZONE)+','+Math.floor(h.z/ZONE);if(!zones.has(k)){const g=new THREE.Group();group.add(g);zones.set(k,{g,x:(Math.floor(h.x/ZONE)+.5)*ZONE,z:(Math.floor(h.z/ZONE)+.5)*ZONE,byName:{}});}return zones.get(k);};
  for(const h of houses){const sol=[];furnSolids.set(h,sol);const byName=zoneOf(h).byName;
   for(const f0 of h.plan.furniture){const name=kit[f0.m]?f0.m:FALLBACK[f0.m],m=kit[name];if(!m)continue;const f={...f0,m:name};const sc=m.scale||.52,b=m.box,cs=Math.cos(f.rot),sn=Math.sin(f.rot);
    const ox=(b.max.x+b.min.x)/2*sc,oz=(b.max.z+b.min.z)/2*sc,lx=f.x-(ox*cs+oz*sn),lz=f.z-(-ox*sn+oz*cs);
    // (las piezas de Tienda, F_*, no apoyan en su origen: se suben lo que les falta)
    (byName[f.m]||(byName[f.m]=[])).push({x:h.x+lx*h.c+lz*h.s,y:h.y+f.y-(f.m.startsWith('F_')?b.min.y*sc:0),z:h.z-lx*h.s+lz*h.c,ry:h.ry+f.rot,s:sc});
    if(f.solid){const bw=(b.max.x-b.min.x)*sc,bd=(b.max.z-b.min.z)*sc,turned=Math.abs(sn)>.5,hw=(turned?bd:bw)/2,hd=(turned?bw:bd)/2;sol.push({x0:f.x-hw,x1:f.x+hw,z0:f.z-hd,z1:f.z+hd,y0:f.y,y1:f.y+(b.max.y-b.min.y)*sc});}}}
  for(const z of zones.values())for(const [n,list] of Object.entries(z.byName)){plantInstances(kit,n,list,z.g,{shadow:false});tris+=list.length*(kit[n].parts.reduce((a,p)=>a+p.geometry.attributes.position.count/3,0));}}

 // ---------- Para caminar ----------
 // (P.solids: la huella de los muebles hechos en cajas —las casas desde la familia—)
 for(const h of houses){const P=h.plan;h.solids=[...P.boxes.filter(b=>b.solid),...(furnSolids.get(h)||[]),...(P.solids||[])];h.hw=P.w/2+.6;h.hd=P.d/2+.6;}
 // Las casas por casilla de 16 m (para no recorrerlas todas en cada consulta).
 const CELLS=new Map(),CK=16,key=(i,j)=>i+','+j;
 for(const h of houses){const r=Math.hypot(h.hw,h.hd);for(let i=Math.floor((h.x-r)/CK);i<=Math.floor((h.x+r)/CK);i++)for(let j=Math.floor((h.z-r)/CK);j<=Math.floor((h.z+r)/CK);j++){const k=key(i,j);(CELLS.get(k)||CELLS.set(k,[]).get(k)).push(h);}}
 const near=(x,z)=>CELLS.get(key(Math.floor(x/CK),Math.floor(z/CK)))||[];
 const local=(h,x,z)=>{const dx=x-h.x,dz=z-h.z;return [dx*h.c-dz*h.s,dx*h.s+dz*h.c];};
 const rampY=(r,lz)=>r.yLow+(r.yHigh-r.yLow)*Math.min(1,Math.max(0,(lz-r.zLow)/(r.zHigh-r.zLow)));
 const inR=(o,lx,lz,m=0)=>lx>o.x0-m&&lx<o.x1+m&&lz>o.z0-m&&lz<o.z1+m;
 // El piso en (x, z) para quien tiene los pies en feet (del mundo): el más alto a menos de 45 cm; null si no hay casa.
 function floorAt(x,z,feet=0){for(const h of near(x,z)){const [lx,lz]=local(h,x,z);if(Math.abs(lx)>h.hw||Math.abs(lz)>h.hd)continue;const f=feet-h.y,lim=f+.45;let best=null;
   for(const fl of h.plan.floors)if(inR(fl,lx,lz)&&fl.y<=lim&&(best==null||fl.y>best))best=fl.y;
   for(const r of h.plan.ramps)if(inR(r,lx,lz)){const y=rampY(r,lz);if(y<=lim&&(best==null||y>best))best=y;}
   // (encima de un mueble pisable —CHOQUE_MUEBLE—: la mesa, el sofá, la cama)
   for(const p of h.plan.pisables||[])if(inR(p,lx,lz)&&p.y<=lim&&(best==null||p.y>best))best=p.y;
   if(best!=null)return h.y+best;}return null;}
 // ¿Choca un cuerpo de radio r con los pies en feet? Lo que queda a menos de 45 cm de los pies se sube (escalones).
 function collide(x,z,r=.3,hard=true,feet=0){for(const h of near(x,z)){const [lx,lz]=local(h,x,z);if(Math.abs(lx)>h.hw+r||Math.abs(lz)>h.hd+r)continue;const f=feet-h.y;
   for(const o of h.solids)if(inR(o,lx,lz,r)&&f+.45<o.y1&&f+1.7>o.y0)return true;
   // la escalera, vista de costado: si los peldaños ya están más altos que un paso
   for(const rp of h.plan.ramps)if(inR(rp,lx,lz,r*.6)){const y=rampY(rp,lz);if(y-f>.5&&y-f<2.6)return true;}}return false;}
 // ¿Está bajo techo?
 function dentro(x,z,y){for(const h of near(x,z)){const [lx,lz]=local(h,x,z);for(const rm of h.plan.rooms)if(inR(rm,lx,lz)&&y-h.y>rm.y0-.5&&y-h.y<rm.y1+.3)return true;}return false;}
 // ¿En qué casa está (índice de items) o null?
 function houseAt(x,z){for(const h of near(x,z)){const [lx,lz]=local(h,x,z);if(h.plan.rooms.some(rm=>inR(rm,lx,lz)))return houses.indexOf(h);}return null;}
 // Las puertas se abren solas cuando alguien está a menos de 1,8 m.
 const wp=new THREE.Vector3();
 for(const d of [...doors,...garages]){wp.set(0,0,0).applyMatrix4(d.frame);d.cx=wp.x;d.cz=wp.z;d.cy=wp.y;}
 // (la ronda, 2026-10-17: la puerta trancada no se abre sola —setTrancadas(fn(x, z, y))—)
 let trancadaFn=null;
 function updateDoors(dt,people){
  for(const d of doors){if(d.fija)continue;const want=!(trancadaFn&&trancadaFn(d.cx,d.cz,d.cy))&&people.some(p=>(p.x-d.cx)**2+(p.z-d.cz)**2<3.2&&Math.abs((p.feet??p.y??d.cy)-d.cy)<2)?1:0;if(d.a===want||!d.meshes)continue;
   d.a=want>d.a?Math.min(1,d.a+dt*3):Math.max(0,d.a-dt*2);const M=leafM(d);for(const im of d.meshes){im.setMatrixAt(d.i,M);im.instanceMatrix.needsUpdate=true;}}
  garages.forEach((g,i)=>{const want=people.some(p=>(p.x-g.cx)**2+(p.z-g.cz)**2<9)?1:0;if(g.a===want)return;g.a=want>g.a?Math.min(1,g.a+dt*1.2):Math.max(0,g.a-dt*1.2);gIm.setMatrixAt(i,garageM(g));gIm.instanceMatrix.needsUpdate=true;});}
 // El portón del garaje cerrado estorba (abierto, no).
 const collideAll=(x,z,r=.3,hard=true,feet=0)=>collide(x,z,r,hard,feet)||garages.some(g=>{if(g.a>.6)return false;const dx=x-g.cx,dz=z-g.cz;return dx*dx+dz*dz<(g.o.w/2+r)**2&&(()=>{const [lx,lz]=local(g.h,x,z),[gx,gz]=local(g.h,g.cx,g.cz);return Math.abs(lz-gz)<.25+r&&Math.abs(lx-gx)<g.o.w/2;})();});
 const world=(h,p)=>({x:h.x+p.x*h.c+p.z*h.s,y:h.y+p.y,z:h.z-p.x*h.s+p.z*h.c,porch:!!p.porch});
 // Para las visitas (2026-10-12): la puerta de entrada (afuera, el vano y adentro), los asientos del sofá, las camas y
 // por dónde se camina en cada planta. Un asiento es el de sitting3d.js: mira hacia donde mira el sofá (el frente de los
 // modelos es +z local, girado rot) y se llega por delante (ap), entre el sofá y la mesa de centro. Una cama, la de
 // lieStep: el centro del colchón, su alto (top), hacia dónde quedan los pies (yaw) y un punto a cada costado.
 const BED={C2_Bed:[1.31,.55],Bed_King:[1.59,.5],Bed_Single:[1.03,.5]};
 for(const h of houses){const P=h.plan,dr=P.openings.find(o=>o.kind==='door'&&!o.inner&&o.axis==='x'&&o.out>0);h.seats=[];h.beds=[];if(!dr)continue;
  for(const f of P.furniture){const B=BED[f.m];if(!B)continue;const q=world(h,{x:f.x,y:f.y,z:f.z}),ux=Math.cos(f.rot),uz=-Math.sin(f.rot),hw=B[0]/2+.5;
   h.beds.push({x:q.x,z:q.z,top:q.y+B[1],yaw:h.ry+f.rot,by:null,house:h,up:f.y>1,sides:[world(h,{x:f.x+ux*hw,y:0,z:f.z+uz*hw}),world(h,{x:f.x-ux*hw,y:0,z:f.z-uz*hw})]});}
  h.entry={outside:world(h,{x:dr.c,y:FLOOR0,z:dr.at+.95}),door:world(h,{x:dr.c,y:FLOOR0,z:dr.at}),inside:world(h,{x:dr.c,y:FLOOR0,z:dr.at-.85})};
  // (las camas y los sofás hechos en cajas: los trae el plano)
  // (el costado, a 35 cm del borde: lo que asegura la prueba de movimiento de los cuartos)
  for(const b of P.bedSpots||[]){const q=world(h,{x:b.x,y:b.y,z:b.z}),ux=Math.cos(b.rot),uz=-Math.sin(b.rot),hw=b.w/2+.35;
   h.beds.push({x:q.x,z:q.z,top:q.y+b.top,yaw:h.ry+b.rot,by:null,house:h,up:b.y>1,sides:b.sides?b.sides.map(p=>world(h,p)):[world(h,{x:b.x+ux*hw,y:0,z:b.z+uz*hw}),world(h,{x:b.x-ux*hw,y:0,z:b.z-uz*hw})]});}
  for(const f of P.seatSpots||[]){const ux=Math.cos(f.rot),uz=-Math.sin(f.rot),step=f.n>1?((f.w||1)-.32)/f.n:0;
   // (por dónde se llega: 72 cm al frente o, si ahí está la mesa de centro, más allá)
   for(let i=0;i<f.n;i++){const o=(i-(f.n-1)/2)*step,q=world(h,{x:f.x+ux*o,y:f.y,z:f.z+uz*o}),yaw=h.ry+f.rot;
    // (si no hay lugar libre al frente —la mesa del comedor justo delante—, ese asiento no se ofrece)
    const ap=[.72,.9,1.1,1.3,1.5].find(a=>!collide(q.x+Math.sin(yaw)*a,q.z+Math.cos(yaw)*a,.16,true,q.y));if(ap==null)continue;
    h.seats.push({x:q.x,y:q.y,z:q.z,yaw,lift:.17,ap,by:null,house:h});}}
  for(const f of P.furniture){if(!/Sofa|Couch/.test(f.m))continue;const two=/Double|Medium/.test(f.m),ux=Math.cos(f.rot),uz=-Math.sin(f.rot);
   for(const o of two?[-.42,.42]:[0]){const q=world(h,{x:f.x+ux*o,y:f.y,z:f.z+uz*o});h.seats.push({x:q.x,y:q.y,z:q.z,yaw:h.ry+f.rot,lift:.17,ap:.72,by:null,house:h});}}}
 // ¿Se puede estar parado en (x, z) en la planta de alto y (de la casa) de h? (piso a esa altura y nada que estorbe, con
 // un cuerpo flaco)
 const walkIn=(h,y=FLOOR0)=>(x,z)=>{const g=floorAt(x,z,h.y+y);return g!=null&&Math.abs(g-h.y-y)<.12&&!collide(x,z,.16,true,h.y+y);};
 const any=()=>true;
 // Para entrar y salir (de afuera de la puerta hasta adentro): además, el suelo de afuera, donde no hay piso de la casa.
 const entraIn=h=>{const w=walkIn(h);return (x,z)=>floorAt(x,z,h.y+FLOOR0)==null?!collideAll(x,z,.16,true,h.y):w(x,z);};
 // El camino desde adentro de la puerta hasta `to` (un punto de la planta baja o, con up, de la de arriba: sube por la
 // escalera, con puntos a lo largo de la rampa). Cada punto lleva con qué se camina hasta él (casa). null si no se llega.
 function pathIn(h,to,up){const w0=walkIn(h),e=h.entry.inside;
  // (pad 10: la grilla cubre la casa entera —el camino puede dar la vuelta por el pasillo—; con 3 m no se llegaba a los
  // cuartos de la casa grande)
  if(!up){const g=gridPath(w0,e,to,10,h.plan.spec.hogar?.15:.25);return g&&g.map(q=>({...q,casa:w0}));}
  const r=h.plan.ramps[0];if(!r)return null;const xm=(r.x0+r.x1)/2,w1=walkIn(h,r.yHigh),foot=world(h,{x:xm,y:0,z:r.zLow+.4}),top=world(h,{x:xm,y:0,z:r.zHigh-.45});
  const a=gridPath(w0,e,foot,10,h.plan.spec.hogar?.15:.25),b=gridPath(w1,top,to,10,h.plan.spec.hogar?.15:.25);if(!a||!b)return null;
  const ramp=[.25,.5,.75,1].map(t=>({...world(h,{x:xm,y:0,z:r.zLow+(r.zHigh-r.zLow)*t}),casa:any}));
  return [...a.map(q=>({...q,casa:w0})),...ramp,{...top,casa:any},...b.map(q=>({...q,casa:w1}))];}
 const lights=houses.flatMap(h=>h.plan.lights.map(p=>world(h,p)));
 // Los muebles de las zonas a menos de `near` m de la cámara (la distancia al borde de la zona).
 function update(cx,cz,near=40){for(const z of zones.values()){const dx=Math.max(0,Math.abs(cx-z.x)-ZONE/2),dz=Math.max(0,Math.abs(cz-z.z)-ZONE/2);z.g.visible=dx*dx+dz*dz<near*near;}}
 // Una visita: una casa a menos de `lejos` m de p con un sofá o una cama libre (cama: con chance `cama`). Trae la entrada
 // y plan(p): ya adentro, el camino hasta el lugar y qué hacer ahí ({pts, act, take}), o null si está ocupado o no se llega.
 function visita(r,p,lejos=120,cama=.4){const bed=r()<cama;
  const ok=houses.filter(h=>h.entry&&(bed?h.beds:h.seats).some(s=>!s.by)&&Math.hypot(h.x-p.x,h.z-p.z)<lejos);if(!ok.length)return null;
  const h=ok[Math.floor(r()*ok.length)],walk=walkIn(h);
  return {house:h,...h.entry,walk,entra:entraIn(h),kind:bed?'cama':'sofa',plan(){
   if(!bed){const free=h.seats.filter(s=>!s.by);for(const seat of free.sort(()=>r()-.5)){const pts=pathIn(h,approachOf(seat),false);if(pts)return {pts,act:{seat},take:q=>{seat.by=q;}};}return null;}
   for(const b of h.beds.filter(b=>!b.by))for(const side of b.sides){const pts=pathIn(h,side,b.up);if(pts)return {pts,act:{bed:b,side},take:q=>{b.by=q;}};}
   return null;}};}
 const sofa=(r,p,lejos)=>visita(r,p,lejos,0);
 return {group,houses,count:houses.length,tris:Math.round(tris),lights,floorAt,collide:collideAll,dentro,houseAt,updateDoors,setTrancadas:fn=>{trancadaFn=fn;},update,sofa,visita,
  setNight(on){glass.emissiveIntensity=on?.9:0;glass.opacity=on?.55:.22;for(const m of mats.vidrio||[]){m.emissiveIntensity=on?.9:0;m.opacity=on?.55:.22;}for(const m of mats.farol||[])m.emissiveIntensity=on?2.2:0;},
  dispose(){for(const o of own)o.dispose?.();}};
}
// Los colores de marcos y puertas de una casa (del plano).
function houseColorTrim(h){return houseColor('marco',h.plan.spec.marco);}
function houseColorDoor(h){return houseColor('puerta',h.plan.spec.puertaColor);}

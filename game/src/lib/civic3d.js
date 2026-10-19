/* Edificios públicos de la ciudad de /demo: hospital, bomberos, colegio, mercado, biblioteca y cine. Le dan vida a la
   ciudad y son puntos de referencia (más adelante, pistas). El MegaKit no trae estos edificios: se arman con sus piezas
   (estilo, color y altura propios) y acá se suma lo que los distingue: el letrero con el nombre, la cruz luminosa del
   hospital, la ambulancia y el camión de bomberos, la bandera del colegio y la marquesina del cine. Sólo se ven: en el
   motor 2D siguen siendo casas como las demás. */
import * as THREE from 'three';
import {LOWPOLY} from './downtown3d.js';

export const CIVIC={
 hospital:{style:'piedra',tint:'#f7f6f2',floors:[5,7],bay:'ambulancia',sign:['#ffffff','#c62828'],icon:'cross',
  names:['Hospital San Rafael','Hospital Santa Clara','Hospital del Carmen']},
 bomberos:{style:'ladrillo',floors:[2,3],bay:'camion',bays:2,sign:['#b71c1c','#ffffff'],icon:'flame',
  names:['Estación de Bomberos N.º 1','Bomberos Voluntarios','Estación de Bomberos Central']},
 colegio:{style:'claro',floors:[3,4],sign:['#1d3f72','#ffd54f'],icon:'book',flag:true,
  names:['Colegio Simón Bolívar','Colegio La Salle','Escuela Antonio Nariño']},
 mercado:{style:'metal',floors:[2,2],sign:['#2e7d32','#fff8e1'],icon:'basket',awnings:true,
  names:['Plaza de Mercado','Mercado Central','Galería del Barrio']},
 biblioteca:{style:'piedra',tint:'#efe4c8',floors:[3,4],sign:['#4e342e','#f3e5c0'],icon:'book',
  names:['Biblioteca Municipal','Biblioteca del Parque','Biblioteca Pública']},
 cine:{style:'metal',floors:[3,4],sign:['#1a1a1a','#ffd54f'],icon:'star',marquee:true,
  names:['Cine Estrella','Teatro Colón','Cine Paraíso']},
 // La comisaría no se elige: es la del mapa (sus pisos y su lugar los pone el motor). Acá, su letrero y sus patrullas.
 comisaria:{style:'claro',sign:['#1d4f9a','#ffffff'],icon:'star',bay:'patrulla',bays:2,names:['Comisaría']},
};
export const CIVIC_ORDER=['hospital','bomberos','colegio','mercado','biblioteca','cine'];

const FONT='-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
function icon(g,kind,x,y,s,color){g.save();g.translate(x,y);g.fillStyle=color;g.strokeStyle=color;g.lineWidth=s*.12;g.lineJoin='round';
 if(kind==='cross'){g.fillRect(-s*.14,-s*.42,s*.28,s*.84);g.fillRect(-s*.42,-s*.14,s*.84,s*.28);}
 else if(kind==='flame'){g.beginPath();g.moveTo(0,-s*.45);g.bezierCurveTo(s*.4,-s*.05,s*.35,s*.42,0,s*.42);g.bezierCurveTo(-s*.35,s*.42,-s*.4,0,-s*.05,-s*.2);g.bezierCurveTo(-s*.05,0,s*.05,0,0,-s*.45);g.fill();}
 else if(kind==='book'){g.strokeRect(-s*.4,-s*.3,s*.8,s*.6);g.beginPath();g.moveTo(0,-s*.3);g.lineTo(0,s*.3);g.stroke();}
 else if(kind==='basket'){g.beginPath();g.moveTo(-s*.42,-s*.05);g.lineTo(s*.42,-s*.05);g.lineTo(s*.3,s*.38);g.lineTo(-s*.3,s*.38);g.closePath();g.fill();g.beginPath();g.arc(0,-s*.05,s*.3,Math.PI,0);g.stroke();}
 else{g.beginPath();for(let i=0;i<10;i++){const r=i%2?s*.18:s*.44,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();g.fill();}
 g.restore();}

// Letrero de fachada: fondo, ícono y nombre (2048×256: proporción 8:1).
function signTexture(type,name){const [bg,fg]=CIVIC[type].sign,c=document.createElement('canvas');c.width=2048;c.height=256;const g=c.getContext('2d');
 g.fillStyle=bg;g.fillRect(0,0,2048,256);g.strokeStyle=fg;g.lineWidth=10;g.strokeRect(14,14,2020,228);
 icon(g,CIVIC[type].icon,150,128,170,fg);
 g.fillStyle=fg;let s=150;do{g.font=`800 ${s}px ${FONT}`;s-=6;}while(g.measureText(name.toUpperCase()).width>1700&&s>40);
 g.textBaseline='middle';g.fillText(name.toUpperCase(),270,134);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;}

function bannerTexture(text,bg,fg){const c=document.createElement('canvas');c.width=1024;c.height=192;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,1024,192);
 g.fillStyle=fg;g.font=`900 120px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,512,100);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}

/* Arma todo lo de los edificios públicos. civics: [{type,name,sign:{x,z,ry,w},bay:[{x,z,ry,len}],roof:{x,y,z},flag:{x,z}}].
   Devuelve el grupo, los rectángulos de choque de los vehículos y la función de noche. */
// vehicle(type): si se pasa, arma el vehículo del paquete de carros (la patrulla de verdad) en vez de cajas.
export function buildCivic(civics,{vehicle:makeVehicle=null}={}){
 const group=new THREE.Group(),own=[],glow=[],blocks=[];
 const M=o=>{const m=new THREE.MeshStandardMaterial({roughness:.6,...o});own.push(m);return m;};
 const box=(w,h,d,m,x,y,z,ry=0,parent=group)=>{const g=new THREE.BoxGeometry(w,h,d);own.push(g);const b=new THREE.Mesh(g,m);b.position.set(x,y,z);b.rotation.y=ry;b.castShadow=true;b.receiveShadow=true;parent.add(b);return b;};
 const dark=M({color:'#222629',roughness:.5}),glass=M({color:'#26323b',roughness:.1,metalness:.3}),tire=M({color:'#1b1b1b',roughness:.9});
 const lightRed=M({color:'#d32f2f',emissive:'#ff1f1f',emissiveIntensity:.25}),lightBlue=M({color:'#1e63d6',emissive:'#2a6bff',emissiveIntensity:.25});glow.push([lightRed,.25,2],[lightBlue,.25,2]);// [material, brillo de día, de noche]
 // Vehículos de servicio, armados con cajas (estilo de los carros del paquete): mirando hacia +z.
 const vehicle=(kind,x,z,ry)=>{
  if(kind==='patrulla'&&makeVehicle){const m=makeVehicle('cop');if(m){m.group.position.set(x,0,z);m.group.rotation.y=ry;group.add(m.group);const ax=Math.abs(Math.sin(ry))>.5,hx=(ax?m.len:m.wid)/2,hz=(ax?m.wid:m.len)/2;blocks.push([x-hx,z-hz,x+hx,z+hz]);return;}}
  const v=new THREE.Group();v.position.set(x,0,z);v.rotation.y=ry;group.add(v);
  const fire=kind==='camion',cop=kind==='patrulla',L=fire?6.4:cop?4.5:5.2,Wd=fire?2.3:cop?1.85:2.0,body=M({color:fire?'#c62828':'#f5f5f2',roughness:.45,metalness:.1});
  const cabH=fire?2.3:cop?1.45:2.2,boxH=fire?2.4:cop?1.05:2.5;
  box(Wd,boxH-.55,L*.68,body,0,.55+(boxH-.55)/2,-L*.16,0,v);box(Wd,cabH-.55,L*.3,body,0,.55+(cabH-.55)/2,L*.34,0,v);
  box(Wd*.92,.55,L*.12,glass,0,cabH-.35,L*.45,0,v);
  const stripe=M({color:fire?'#f1f1f1':cop?'#1d4f9a':'#c62828'});box(Wd+.02,cop?.32:.22,L*.98,stripe,0,cop?.8:1.15,0,0,v);
  for(const s of [-1,1])for(const zz of [L*.32,-L*.3]){const tg=new THREE.CylinderGeometry(.42,.42,.3,14);own.push(tg);const t=new THREE.Mesh(tg,tire);t.rotation.z=Math.PI/2;t.position.set(s*(Wd/2-.1),.42,zz);v.add(t);}
  box(Wd*.7,.14,.3,lightRed,-Wd*.2,cabH+.07,L*.36,0,v);box(Wd*.35,.14,.3,lightBlue,Wd*.25,cabH+.07,L*.36,0,v);
  if(fire){const rail=M({color:'#b0b4b8',metalness:.6,roughness:.4});box(.9,.12,L*.8,rail,0,boxH+.12,-L*.1,0,v);for(let i=0;i<9;i++)box(.9,.06,.06,rail,0,boxH+.2,-L*.48+i*L*.1,0,v);}
  else if(cop){box(Wd*.96,.06,L*.5,M({color:'#1d4f9a'}),0,cabH+.03,-L*.05,0,v);}
  else{const cross=M({color:'#c62828'});box(.06,.7,.22,cross,Wd/2+.01,1.75,-L*.15,0,v);box(.06,.22,.7,cross,Wd/2+.01,1.75,-L*.15,0,v);box(.06,.7,.22,cross,-Wd/2-.01,1.75,-L*.15,0,v);box(.06,.22,.7,cross,-Wd/2-.01,1.75,-L*.15,0,v);}
  // Su huella para los choques (rectángulo alineado: los vehículos van a 0/90/180/270°).
  const ax=Math.abs(Math.sin(ry))>.5,hx=(ax?L:Wd)/2,hz=(ax?Wd:L)/2;blocks.push([x-hx,z-hz,x+hx,z+hz]);};
 for(const c of civics){const info=CIVIC[c.type];
  // Letrero con el nombre, sobre la planta baja de su fachada principal.
  // (con LOWPOLY, sin letreros —2026-10-16, Miguel: «quitar los letreros de edificios»—: quedan la cruz del hospital, la
  // bandera y los vehículos de los portones)
  if(c.sign&&!LOWPOLY.on){const t=signTexture(c.type,c.name);own.push(t);const m=M({map:t,emissiveMap:t,emissive:'#ffffff',emissiveIntensity:0,roughness:.5});glow.push([m,0,.75]);
   const {x,z,ry,w,roof}=c.sign,h=w/8,frame=M({color:'#2a2a2a',metalness:.4}),y0=c.sign.y0??(roof?roof+1.35:FLOOR_SIGN);
   box(w+.2,h+.2,.12,frame,x-Math.sin(ry)*.06,y0+h/2,z-Math.cos(ry)*.06,ry);
   const pg=new THREE.PlaneGeometry(w,h);own.push(pg);const p=new THREE.Mesh(pg,m);p.position.set(x+Math.sin(ry)*.01,y0+h/2,z+Math.cos(ry)*.01);p.rotation.y=ry;group.add(p);
   // En la azotea: patas de fierro desde el techo hasta el cartel.
   if(roof)for(const s of [-.42,0,.42]){const off=s*w;box(.14,y0-roof+.05,.14,frame,x+Math.cos(ry)*off-Math.sin(ry)*.12,roof+(y0-roof)/2,z-Math.sin(ry)*off-Math.cos(ry)*.12,ry);}
   // Marquesina del cine: una franja de bombillos alrededor del letrero.
   if(info.marquee){const bulb=M({color:'#fff3c4',emissive:'#ffd36b',emissiveIntensity:.4});glow.push([bulb,.4,2.2]);const n=Math.floor(w/.35);
    for(let i=0;i<=n;i++)for(const yy of [FLOOR_SIGN-.18,FLOOR_SIGN+h+.18]){const sg=new THREE.SphereGeometry(.07,8,6);own.push(sg);const b=new THREE.Mesh(sg,bulb);const off=-w/2+i*w/n;b.position.set(x+Math.cos(ry)*off+Math.sin(ry)*.12,yy,z-Math.sin(ry)*off+Math.cos(ry)*.12);group.add(b);}}}
  // Portones abiertos: un dintel con el nombre del servicio y el vehículo adentro, asomado a la vereda.
  for(const b of c.bay||[]){if(LOWPOLY.on){const inside=b.len/2-1;vehicle(b.kind,b.x-Math.sin(b.ry)*inside,b.z-Math.cos(b.ry)*inside,b.ry);continue;}const t=bannerTexture(b.kind==='camion'?'BOMBEROS':b.kind==='patrulla'?'POLICÍA':'URGENCIAS',b.kind==='camion'?'#b71c1c':b.kind==='patrulla'?'#1d4f9a':'#c62828','#ffffff');own.push(t);
   const m=M({map:t,emissiveMap:t,emissive:'#ffffff',emissiveIntensity:0});glow.push([m,0,.8]);const pg=new THREE.PlaneGeometry(3.4,.62);own.push(pg);const p=new THREE.Mesh(pg,m);
   p.position.set(b.x+Math.sin(b.ry)*.2,2.62,b.z+Math.cos(b.ry)*.2);p.rotation.y=b.ry;group.add(p);
   const inside=b.len/2-1;vehicle(b.kind,b.x-Math.sin(b.ry)*inside,b.z-Math.cos(b.ry)*inside,b.ry);}
  // La cruz luminosa del hospital, sobre la azotea: se ve de lejos y de noche brilla.
  if(c.roof){const {x,y,z}=c.roof,white=M({color:'#f4f4f4'}),red=M({color:'#d32f2f',emissive:'#ff2b2b',emissiveIntensity:.15});glow.push([red,.15,1.6]);
   box(.3,1.4,.3,dark,x,y+.7,z);box(4.2,4.2,.5,white,x,y+3.6,z);box(1.2,3.4,.56,red,x,y+3.6,z);box(3.4,1.2,.56,red,x,y+3.6,z);
   box(4.2,4.2,.5,white,x,y+3.6,z,Math.PI/2);box(1.2,3.4,.56,red,x,y+3.6,z,Math.PI/2);box(3.4,1.2,.56,red,x,y+3.6,z,Math.PI/2);}
  // La bandera del colegio en la vereda.
  if(c.flag){const {x,z}=c.flag,pole=M({color:'#d9dcdf',metalness:.6,roughness:.3});const pg=new THREE.CylinderGeometry(.05,.07,7.5,10);own.push(pg);const p=new THREE.Mesh(pg,pole);p.position.set(x,3.75,z);p.castShadow=true;group.add(p);
   const fc=document.createElement('canvas');fc.width=96;fc.height=64;const fg=fc.getContext('2d');fg.fillStyle='#fcd116';fg.fillRect(0,0,96,32);fg.fillStyle='#003893';fg.fillRect(0,32,96,16);fg.fillStyle='#ce1126';fg.fillRect(0,48,96,16);
   const ft=new THREE.CanvasTexture(fc);ft.colorSpace=THREE.SRGBColorSpace;own.push(ft);const fgeo=new THREE.PlaneGeometry(1.8,1.2,6,1);own.push(fgeo);
   const pos=fgeo.attributes.position;for(let i=0;i<pos.count;i++){const u=(pos.getX(i)+.9)/1.8;pos.setZ(i,Math.sin(u*Math.PI*2)*.12*u);}fgeo.computeVertexNormals();
   const f=new THREE.Mesh(fgeo,M({map:ft,side:THREE.DoubleSide}));f.position.set(x+.92,6.8,z);f.castShadow=true;group.add(f);}
 }
 return {group,blocks,
  setNight(on){for(const [m,day,night] of glow)m.emissiveIntensity=on?night:day;},
  dispose(){for(const o of own)o.dispose();}};
}
// Altura del letrero: justo encima de la planta baja (3 m).
const FLOOR_SIGN=3.08;

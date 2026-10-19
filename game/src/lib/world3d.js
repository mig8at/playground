/* La ciudad del generador en 3D, para caminarla en primera persona (/demo).
   Lee la misma grilla que juega el motor (City.generate): cada casilla mide CELL metros. Lo sólido son edificios y muros,
   lo techado son los interiores (cuartos, pasillos, salones, bóvedas, puertas) y lo abierto son calles, plazas y patios.
   Todo se arma en pocas mallas (una por material) y el mobiliario con instancias, así una ciudad de 8 contra 8 anda
   liviana. Nada de esto cambia las reglas: es sólo cómo se ve. */
import * as THREE from 'three';
import {City} from '../engine/index.js';
import {CALLE,CIRCULACION,MANSARDA} from '../engine/medidas.js';
import {alturaMansarda} from '../engine/techos.js';
import {adMaterials,setAdsNight} from './ads3d.js';
import {STYLES,buildDowntown,LOWPOLY} from './downtown3d.js';
import {facadeStyle} from '../engine/fachada.js';
import {CIVIC,CIVIC_ORDER,buildCivic} from './civic3d.js';
import {liftFor} from './sitting3d.js';
import {plantInstances} from './nature3d.js';
import {buildTown,buildCabins} from './town3d.js';
import {OBJETOS,placeParts,partsMesh,kitModel} from './objetos3d.js';

const K=City.K;
// Metros por casilla en el 3D (el motor 2D razona en casillas: esto no lo toca). Con 4, una calle de una casilla dejaba
// 2 m de calzada (un solo sentido); con 6, veredas de 1 m y 4 m de calzada: doble vía.
export const CELL=6;
export const FLOOR=3;      // alto de un piso
export const CEIL=2.9;     // cielo raso de los interiores
export const EYE=1.65;     // altura de los ojos
const CURB=.15,SUB=6,SW=CELL/SUB; // vereda: alto y ancho (1 m: un sexto de casilla)

const OPEN=new Set([K.street,K.avenue,K.alley,K.plaza,K.courtyard,K.kiosk]);
const ROOF=new Set([K.floor,K.door,K.room,K.hall,K.vault]);
const isSolid=k=>k>=K.SOLID&&k!==K.kiosk;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];

// Con el «Downtown City MegaKit» cargado, los edificios se arman con sus piezas y son huecos por dentro (downtown3d.js).
// Sin él quedan las fachadas propias, guiadas por el «Ultimate Textured Building Pack» de Quaternius: paleta apagada con carácter (menta, verde azulado, lavanda, pizarra, ladrillo, terracota, crema, carbón),
// molduras blancas en relieve (remate de azotea, franja entre pisos, alféizar y dintel, esquinas) y dos ventanas
// angostas por vano. Todo sale de la grilla y la semilla de la ciudad.
const TINTS=['#8fc4b3','#6aa39a','#9a94cc','#6c86b3','#b9603f','#cf8457','#e6d9bb','#4a4f57','#ecebe6','#c99398','#3f4f78','#d8b45a'];
const SITE_TINT='#e9d9a8',STATION_TINT='#7f9cc0';
// Tonos de revoque para el estilo «piedra» de los edificios armados con piezas (multiplican su textura clara).
// Nombres de edificios (se combinan con Edificio, Torre, Residencias o Casa).
const BUILDING_NAMES=['Las Palmas','El Prado','San Andrés','Bolívar','Santander','La Esperanza','Los Andes','El Dorado','Miramar','La Colina',
 'Santa Fe','Caribe','Monserrate','La Sabana','Los Almendros','El Retiro','Alameda','La Candelaria','El Faro','Mirador','Las Brisas','La Aurora',
 'San Martín','Nariño','Granada','Castilla','La Floresta','Porvenir','El Sol','Altamira','Bella Vista','Los Pinos','Primavera','La Ceiba','El Bosque',
 'Guadalupe','Victoria','Atlántico','Cristal','Esmeralda','Las Acacias','El Lago','Los Cerezos','Montecarlo','La Estrella','Cordillera','San José',
 'Colonial','Del Mar','La Fuente','Los Robles','El Mirador','Paraíso','Real','La Palma','Oriente','Occidente','Central','Panorama','Las Gaviotas',
 'Rosales','La Quinta','Puerta del Sol','Torreón','Los Olivos','Majestic','Imperial','Continental','Metropolitano','Avenida','Parque Real','Sevilla',
 'Valencia','Córdoba','Toledo','Galicia','Navarra','Aragón','Andalucía','Murillo','Velázquez','Goya','Picasso','Obregón','Botero','Cartagena',
 'Popayán','Tunja','Neiva','Pasto','Ibagué','Armenia','Pereira','Manizales','Girardot','Honda','Mompox','Villa de Leyva','Barichara','Salento'];
// Colores de los edificios armados con piezas, por estilo: el ladrillo se pinta (su textura pasa a gris claro y se tiñe),
// la piedra va en pasteles y el metal en tonos oscuros. null = el color natural del material. Sólo se tiñen las paredes
// (PAINT_ON): molduras, cornisas, columnas y marcos quedan claros para que contrasten, como en el estilo del paquete.
const BRICK_PAINTS=[null,null,'#7fb3a6','#6b8fb8','#a59ad1','#d9b45a','#e3a3a0','#8aa66a','#d98c5f','#c4c4c4','#5f9ea0'];
const PAINTS={ladrillo:BRICK_PAINTS,claro:BRICK_PAINTS,piedra:['#f4e9d4','#ecd2c2','#d5e6db','#dcd8ec','#f3e0ae','#e6e6e6','#cfe0ea','#f2c9b8','#c9e3c4'],
 metal:[null,'#3f4f78','#4a4f57','#3e5e4e','#6b4a5e','#2f5f73']};
const PAINT_ON={ladrillo:['MI_RedBrick','MI_RedBrick_Pale'],claro:['MI_RedBrick','MI_RedBrick_Pale'],piedra:['MI_Trim'],metal:['MI_Trim_Dark']};
const STONE_TINTS=['#f4e9d4','#ecd2c2','#d5e6db','#dcd8ec','#f3e0ae','#e6e6e6','#cfe0ea'];
// Las ventanas de la textura y su relieve en 3D comparten estas medidas (fracciones del vano y metros sobre el piso).
const WIN={at:[.297,.703],w:.875,bottom:.84,top:2.44};

function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const lighten=(hex,f=.55)=>{const c=new THREE.Color(hex).lerp(new THREE.Color('#ffffff'),f);return [c.r,c.g,c.b];};
function hash(x,y,s=0){let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1274126177);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;}

// ---------- Texturas dibujadas en canvas (una sola vez por página) ----------
function canvasTexture(w,h,draw,{srgb=true}={}){
 const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function speckle(g,w,h,n,colors,r,size=2){for(let i=0;i<n;i++){g.fillStyle=colors[Math.floor(r()*colors.length)];g.fillRect(r()*w,r()*h,size*r()+.5,size*r()+.5);}}

// Una fachada de 4×4 vanos (un vano = una casilla de ancho y un piso de alto), con ventanas que varían.
// La de noche es su máscara de luz: algunas ventanas encendidas.
function facadePair(wall,seed){
 const r=rng(seed),B=128,lit=[],PX=B/CELL,PY=B/FLOOR;
 const wx=WIN.at.map(f=>f*B-WIN.w*PX/2),ww=WIN.w*PX,wy=B-WIN.top*PY,wh=(WIN.top-WIN.bottom)*PY;
 const day=canvasTexture(512,512,g=>{
  g.fillStyle=wall;g.fillRect(0,0,512,512);speckle(g,512,512,3000,['rgba(0,0,0,.045)','rgba(255,255,255,.06)'],r,3);
  for(let by=0;by<4;by++)for(let bx=0;bx<4;bx++){
   const x=bx*B,y=by*B,curtain=r()<.5;
   for(const [k,ox] of wx.entries()){
    const X=x+ox,Y=y+wy;
    g.fillStyle='rgba(0,0,0,.22)';g.fillRect(X-2,Y-2,ww+4,wh+4);                       // hueco (sombra del marco)
    const gl=g.createLinearGradient(0,Y,0,Y+wh);gl.addColorStop(0,'#45607a');gl.addColorStop(1,'#1d2836');g.fillStyle=gl;g.fillRect(X,Y,ww,wh);
    g.fillStyle='rgba(255,255,255,.12)';g.beginPath();g.moveTo(X,Y+wh*.6);g.lineTo(X+ww*.7,Y);g.lineTo(X+ww,Y);g.lineTo(X,Y+wh*.95);g.fill();
    if(curtain&&k===(by+bx)%2){g.fillStyle=['#efe6d2','#d9c6a8','#cfd8dd','#e6c9c3'][Math.floor(r()*4)];g.globalAlpha=.9;g.fillRect(X,Y,ww*.45,wh);g.globalAlpha=1;}
    g.fillStyle='#f1eee6';g.fillRect(X-3,Y-3,ww+6,3);g.fillRect(X-3,Y+wh,ww+6,3);g.fillRect(X-3,Y,3,wh);g.fillRect(X+ww,Y,3,wh);   // marco
    g.fillRect(X+ww/2-1.5,Y,3,wh);g.fillRect(X,Y+wh*.35,ww,3);                                                                // cruz
    lit.push(r()<.34?['#ffd28a','#ffe1a8','#ffc778','#fff1c9'][Math.floor(r()*4)]:null);
   }
  }
 });
 const night=canvasTexture(512,512,g=>{
  g.fillStyle='#000';g.fillRect(0,0,512,512);
  lit.forEach((c,i)=>{if(!c)return;const b=Math.floor(i/2),x=(b%4)*B+wx[i%2],y=Math.floor(b/4)*B+wy;g.fillStyle=c;g.fillRect(x,y,ww,wh);g.fillStyle='rgba(0,0,0,.4)';g.fillRect(x+ww/2-1.5,y,3,wh);g.fillRect(x,y+wh*.35,ww,3);});
 });
 return {day,night};
}
// Planta baja: locales con vidriera y letrero, o persiana cerrada. 4 vanos de ancho, un piso de alto.
function storefrontPair(wall,seed){
 const r=rng(seed),B=128,lit=[];
 const day=canvasTexture(512,128,g=>{
  g.fillStyle=wall;g.fillRect(0,0,512,128);speckle(g,512,128,700,['rgba(0,0,0,.06)','rgba(255,255,255,.08)'],r,3);
  g.fillStyle='rgba(0,0,0,.25)';g.fillRect(0,120,512,8);                          // zócalo
  for(let bx=0;bx<4;bx++){
   const x=bx*B,kind=r();
   g.fillStyle='rgba(30,32,36,.55)';g.fillRect(x+6,6,B-12,24);g.fillStyle='rgba(255,255,255,.18)';g.fillRect(x+6,6,B-12,2);   // franja del letrero
   if(kind<.3){g.fillStyle='#8d9296';g.fillRect(x+10,36,B-20,84);g.fillStyle='rgba(0,0,0,.18)';for(let y=40;y<120;y+=6)g.fillRect(x+10,y,B-20,2);lit.push(null);}
   else{const gl=g.createLinearGradient(0,36,0,120);gl.addColorStop(0,'#5a7385');gl.addColorStop(1,'#26323b');g.fillStyle=gl;g.fillRect(x+10,36,B-20,84);
    g.fillStyle='rgba(255,255,255,.12)';g.beginPath();g.moveTo(x+10,110);g.lineTo(x+70,36);g.lineTo(x+92,36);g.lineTo(x+10,120);g.fill();
    g.fillStyle='rgba(240,240,235,.8)';g.fillRect(x+B/2-2,36,4,84);lit.push(r()<.6?['#ffe3a6','#d9f0ff','#ffd08a'][Math.floor(r()*3)]:null);}
  }
 });
 const night=canvasTexture(512,128,g=>{g.fillStyle='#000';g.fillRect(0,0,512,128);lit.forEach((c,i)=>{if(c){g.fillStyle=c;g.fillRect(i*B+10,36,B-20,84);}});});
 return {day,night};
}

// Locales de barrio: el letrero va sobre la vidriera, letras claras sobre una tabla de color.
const SHOPS=[['Panadería','#b5523e'],['Farmacia','#2e7d5b'],['Barbería','#2f3437'],['Librería','#3f4f78'],['Ferretería','#c9772f'],
 ['Café','#5b3a29'],['Frutería','#5e8f3a'],['Papelería','#7b4e7e'],['Zapatería','#8a3b3b'],['Droguería','#2a6f8f']];
let shopCache=null;
function shopMaterials(){
 if(shopCache)return shopCache;
 shopCache=SHOPS.map(([name,bg])=>{const t=canvasTexture(512,104,g=>{g.fillStyle=bg;g.fillRect(0,0,512,104);g.fillStyle='rgba(255,255,255,.18)';g.fillRect(0,0,512,6);
  g.fillStyle='#fbf6e8';g.font='italic 700 62px Georgia,"Times New Roman",serif';g.textAlign='center';g.textBaseline='middle';g.fillText(name,256,56,470);});
  t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return new THREE.MeshStandardMaterial({map:t,emissiveMap:t,emissive:0x000000,roughness:.6});});
 return shopCache;
}
const shopPlane=()=>new THREE.PlaneGeometry(2.6,.53);

let shared=null;
function sharedMaterials(){
 if(shared)return shared;
 const r=rng(99),std=(o)=>new THREE.MeshStandardMaterial({roughness:.92,metalness:0,...o});
 const asphalt=canvasTexture(256,256,g=>{g.fillStyle='#55595c';g.fillRect(0,0,256,256);speckle(g,256,256,5000,['#4a4e51','#62676a','#5c6063','#45494b'],r,2);
  g.strokeStyle='rgba(30,30,30,.35)';g.lineWidth=1.2;for(let i=0;i<4;i++){g.beginPath();let x=r()*256,y=r()*256;g.moveTo(x,y);for(let j=0;j<6;j++){x+=(r()-.5)*40;y+=(r()-.5)*40;g.lineTo(x,y);}g.stroke();}});
 const paving=canvasTexture(256,256,g=>{g.fillStyle='#cdc3ae';g.fillRect(0,0,256,256);for(let y=0;y<8;y++)for(let x=0;x<8;x++){g.fillStyle=`hsl(38,${18+r()*10}%,${70+r()*8}%)`;g.fillRect(x*32+(y%2)*16+1,y*32+1,30,30);}speckle(g,256,256,1500,['rgba(0,0,0,.06)'],r,2);});
 const grass=canvasTexture(256,256,g=>{g.fillStyle='#6f9a4a';g.fillRect(0,0,256,256);speckle(g,256,256,9000,['#638d41','#7aa653','#5a8239','#86b15e'],r,3);for(let i=0;i<14;i++){g.fillStyle='rgba(255,255,255,.05)';g.beginPath();g.ellipse(r()*256,r()*256,20+r()*20,12+r()*10,r()*3,0,7);g.fill();}});
 const court=canvasTexture(256,256,g=>{g.fillStyle='#8f9a6f';g.fillRect(0,0,256,256);speckle(g,256,256,6000,['#7f8c5f','#a0ab7c','#899463','#97a46f'],r,3);for(let i=0;i<10;i++){g.fillStyle=`hsl(40,14%,${62+r()*10}%)`;g.beginPath();g.ellipse(r()*256,r()*256,14+r()*10,10+r()*8,r()*3,0,7);g.fill();}});
 const sidewalk=canvasTexture(128,128,g=>{g.fillStyle='#c9c5bc';g.fillRect(0,0,128,128);speckle(g,128,128,900,['rgba(0,0,0,.07)','rgba(255,255,255,.1)'],r,2);g.fillStyle='rgba(0,0,0,.16)';for(let i=0;i<128;i+=32){g.fillRect(i,0,1.5,128);g.fillRect(0,i,128,1.5);}});
 const roof=canvasTexture(256,256,g=>{g.fillStyle='#5a5e64';g.fillRect(0,0,256,256);speckle(g,256,256,6000,['#50545a','#686c72','#474a50'],r,2);});
 const plaster=canvasTexture(256,256,g=>{g.fillStyle='#ede6da';g.fillRect(0,0,256,256);speckle(g,256,256,1800,['rgba(0,0,0,.04)','rgba(255,255,255,.12)'],r,4);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,236,256,20);});
 // Primero un fondo de madera: las tablas de cada fila arrancan corridas y antes dejaban huecos sin pintar (se veían negros).
 const wood=canvasTexture(256,256,g=>{g.fillStyle='#a87d52';g.fillRect(0,0,256,256);for(let y=0;y<8;y++){const off=r()*256;for(let x=-1;x<2;x++){g.fillStyle=`hsl(30,${38+r()*10}%,${42+r()*10}%)`;g.fillRect(off+x*256*.7,y*32,256*.7,32);}g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,y*32,256,1.5);}speckle(g,256,256,2500,['rgba(0,0,0,.06)','rgba(255,255,255,.04)'],r,3);});
 const tile=canvasTexture(256,256,g=>{for(let y=0;y<4;y++)for(let x=0;x<4;x++){g.fillStyle=(x+y)%2?'#d8d1c1':'#efe9dd';g.fillRect(x*64,y*64,64,64);}g.fillStyle='rgba(0,0,0,.12)';for(let i=0;i<256;i+=64){g.fillRect(i,0,1.5,256);g.fillRect(0,i,256,1.5);}});
 const vault=canvasTexture(256,256,g=>{g.fillStyle='#8f8a7d';g.fillRect(0,0,256,256);for(let y=0;y<4;y++)for(let x=0;x<4;x++){g.fillStyle=`hsl(45,${10+r()*8}%,${50+r()*8}%)`;g.fillRect(x*64+2,y*64+2,60,60);g.fillStyle='rgba(0,0,0,.35)';for(const [a,b] of [[8,8],[54,8],[8,54],[54,54]])g.fillRect(x*64+a,y*64+b,3,3);}});
 const ceiling=canvasTexture(128,128,g=>{g.fillStyle='#f3f0ea';g.fillRect(0,0,128,128);speckle(g,128,128,400,['rgba(0,0,0,.04)'],r,3);});
 const awning=canvasTexture(128,64,g=>{for(let i=0;i<4;i++){g.fillStyle=i%2?'#ffffff':'#e8e2d6';g.fillRect(i*32,0,32,64);}g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,52,128,12);});
 const pool=canvasTexture(128,128,g=>{const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,.85)');gr.addColorStop(.5,'rgba(255,200,120,.3)');gr.addColorStop(1,'rgba(255,190,110,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);});
 const T=(tex,color,o={})=>LOWPOLY.on?{color,flatShading:true,...o}:{map:tex,...o};
 shared={
  // (LOWPOLY, 2026-10-16: el suelo y lo de la grilla vieja, en colores planos con caras planas; sin las texturas con ruido)
  asphalt:std(T(asphalt,'#5d6266',{vertexColors:true})),paving:std(T(paving,'#dccfb4')),grass:std(T(grass,'#86b85a',{roughness:1})),court:std(T(court,'#a8b87c')),sidewalk:std(T(sidewalk,'#d6d1c6')),
  roof:std(T(roof,'#9b958d')),plaster:std(T(plaster,'#efe8dc',{vertexColors:true,emissive:'#6f6a61',emissiveIntensity:.35})),wood:std(T(wood,'#b08a5e',{roughness:.7})),tile:std(T(tile,'#e9e4da',{roughness:.5,vertexColors:true})),
  vault:std(T(vault,'#9aa0a4',{roughness:.45,metalness:.4})),ceiling:std(T(ceiling,'#f3efe7',{emissive:'#d8d2c6',emissiveIntensity:.55})),marking:std({vertexColors:true,roughness:.7}),
  pool:new THREE.MeshBasicMaterial({map:pool,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}),
  trim:std({vertexColors:true,roughness:.8}),awning:std(T(awning,'#f2ede2',{vertexColors:true,roughness:.8})),
  facade:new Map(),store:new Map(),
 };
 // Una fachada y una planta baja por color: el color va pintado en la textura, así los vidrios no se tiñen.
 [...TINTS,SITE_TINT,STATION_TINT].forEach((t,i)=>{
  const f=facadePair(t,11+i),s=storefrontPair(t,51+i);
  shared.facade.set(t,std({map:f.day,emissiveMap:f.night,emissive:0x000000}));
  shared.store.set(t,std({map:s.day,emissiveMap:s.night,emissive:0x000000}));
 });
 return shared;
}

// ---------- Geometría: cuadriláteros juntados por material ----------
class Quads{
 constructor(){this.p=[];this.n=[];this.uv=[];this.c=[];this.i=[];}
 // (un triángulo solo —las puntas de la vereda, en abanico—: como add, sin la cuarta punta)
 tri(a,b,c,n,uv,col=[1,1,1]){const k=this.p.length/3;for(const v of [a,b,c]){this.p.push(v[0],v[1],v[2]);this.n.push(n[0],n[1],n[2]);this.c.push(col[0],col[1],col[2]);}this.uv.push(...uv.slice(0,6));this.i.push(k,k+1,k+2);}
 add(a,b,c,d,n,uv,col=[1,1,1]){const k=this.p.length/3;for(const v of [a,b,c,d]){this.p.push(v[0],v[1],v[2]);this.n.push(n[0],n[1],n[2]);this.c.push(col[0],col[1],col[2]);}this.uv.push(...uv);this.i.push(k,k+1,k+2,k,k+2,k+3);}
 // Pared vertical de (x0,z0) a (x1,z1), mirando hacia n (en el plano). u en metros a lo largo, v en metros de alto.
 wall(x0,z0,x1,z1,y0,y1,nx,nz,{us=1,vs=1,uo=0,vo=0,col}={}){
  const tx=nz,tz=-nx;if((x1-x0)*tx+(z1-z0)*tz<0){[x0,x1]=[x1,x0];[z0,z1]=[z1,z0];}
  const u0=(x0*tx+z0*tz)*us+uo,u1=(x1*tx+z1*tz)*us+uo;
  this.add([x0,y0,z0],[x1,y0,z1],[x1,y1,z1],[x0,y1,z0],[nx,0,nz],[u0,y0*vs+vo,u1,y0*vs+vo,u1,y1*vs+vo,u0,y1*vs+vo],col);
 }
 // Piso (hacia arriba) o techo (hacia abajo) de un rectángulo.
 flat(x0,z0,x1,z1,y,up,{us=1,col}={}){
  const uv=[x0*us,z0*us,x0*us,z1*us,x1*us,z1*us,x1*us,z0*us];
  if(up)this.add([x0,y,z0],[x0,y,z1],[x1,y,z1],[x1,y,z0],[0,1,0],uv,col);
  else this.add([x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1],[0,-1,0],[uv[0],uv[1],uv[6],uv[7],uv[4],uv[5],uv[2],uv[3]],col);
 }
 mesh(material,{cast=true,receive=true}={}){
  if(!this.p.length)return null;const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.setIndex(this.i);
  g.computeBoundingSphere();const m=new THREE.Mesh(g,material);m.castShadow=cast;m.receiveShadow=receive;return m;
 }
}

function instanced(group,geo,mat,items,{cast=true}={}){
 if(!items.length)return null;
 const m=new THREE.InstancedMesh(geo,mat,items.length),o=new THREE.Object3D(),c=new THREE.Color();
 // (giro YXZ: primero la inclinación de la pieza y después hacia dónde mira el objeto)
 items.forEach((it,i)=>{o.position.set(it.x,it.y||0,it.z);o.rotation.set(it.rx||0,it.ry||0,it.rz||0,'YXZ');o.scale.set(it.sx??1,it.sy??1,it.sz??1);o.updateMatrix();m.setMatrixAt(i,o.matrix);if(it.color)m.setColorAt(i,c.set(it.color));});
 m.castShadow=cast;m.receiveShadow=true;group.add(m);return m;
}
const base=(geo)=>{geo.computeBoundingBox();geo.translate(0,-geo.boundingBox.min.y,0);return geo;};

function signTexture(text,bg,fg){
 return canvasTexture(512,128,g=>{g.fillStyle=bg;g.fillRect(0,0,512,128);g.strokeStyle='rgba(255,255,255,.6)';g.lineWidth=6;g.strokeRect(8,8,496,112);
  g.fillStyle=fg;g.font='700 64px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text.toUpperCase(),256,68,470);});
}

// ---------- La ciudad ----------
// plan: el plano por etapas (engine/blueprint.js). Con él, los edificios salen del plano (town3d.js) y no de la grilla.
// vacio (opcional, Uint8Array W×H): casillas donde no se dibuja nada (ni piso ni mobiliario). Lo usan los barrios de
// la isla (barrios3d.js), que se arman con este mismo código en un marco local que cubre también calles y otros escalones.
// barrio (los barrios residenciales de la isla): los parques son jardines (pasto entero, sin senderos ni fuente, con
// árboles, arbustos y faroles) y las fachadas van sin publicidad.
// (tiempos de armado por sección, para revisar desde la consola; cuestan nada)
export const WORLD_TIMES={t:0,p:0,s:{},runs:[],start(){this.s={};this.runs.push(this.s);this.cur=null;this.t=this.p=performance.now();},lap(n){const t=performance.now();this.s[this.cur||'inicio']=(this.s[this.cur||'inicio']||0)+Math.round(t-this.p);this.cur=n;this.p=t;}};
// arboles: false deja la ciudad sin árboles ni arbustos (2026-10-15: la ciudad limpia, sólo calles y edificios).
// mobiliario: false deja afuera lo que esta función ponía por su cuenta —faroles, bancas, papeleras, hidrantes, mupis,
// kioscos, árboles y las cebras pintadas—: con el plano lo pone su equipamiento y su vegetación (plano3d.js, el contrato).
export function buildWorld(map,{downtown=null,nature=null,furniture=null,vehicle=null,plan=null,vacio=null,barrio=false,arboles=true,mobiliario=true}={}){
 WORLD_TIMES.start();
 const M=sharedMaterials(),S=CELL,{W,H}=map,group=new THREE.Group(),own=[];
 // En 3D las avenidas van sin kioscos (en el motor siguen: cortan la vista y son parte del equilibrio medido).
 // Con ellos un carril quedaba cortado y el tráfico, al esquivarlos por el carril contrario, se trancaba.
 // Sólo los de las avenidas: los de las plazas siguen (y en un parque son arboledas).
 const onAvenue=i=>{const x=i%W,y=(i-x)/W;return DIRS.some(([dx,dy])=>{const nx=x+dx,ny=y+dy;return nx>=0&&ny>=0&&nx<W&&ny<H&&map.kind[ny*W+nx]===K.avenue;});};
 const kind=map.kind.map((k,i)=>k===K.kiosk&&onAvenue(i)?K.avenue:k);
 // Con el plano: lo construido son las casillas de sus lotes y los patios de manzana quedan abiertos (los cuartos y las
 // puertas del motor no se dibujan: adentro manda el plano).
 if(plan){for(const L of plan.lots)for(const p of L.parts)for(let y=p.y/CELL;y<(p.y+p.h)/CELL;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL;x++)kind[y*W+x]=K.building;
  for(const c of plan.courts)for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)kind[y*W+x]=K.courtyard;}
 // Las salidas de la isla (etapa 9): la casilla del muro por donde sale una avenida es calle, así la carrera sigue sin
 // un andén atravesado; afuera de esa casilla no hay nada construido (la vereda no la cierra). exits va al tráfico.
 const exits=[],exitOut=new Set();
 for(const r of plan?.isla?.carreteras||[]){if(!r.desde||!r.puntos)continue;const g=plan.isla.gates.find(q=>q.x===r.desde[0]&&q.y===r.desde[1]&&q.dir)||plan.isla.gates.find(q=>q.x===r.desde[0]&&q.y===r.desde[1]);if(!g?.dir)continue;// (2026-10-16, medido sin pantalla: una casilla del muro puede tener dos salidas —la de a pie, sin dirección, y la de la calle—; con la primera, la ciudad 2 no se armaba)
  // Una avenida (ancho 12 m) abre las dos casillas del muro; desde 2026-10-15 la salida trae sus casillas (g.cells: 2 en
  // una calle de 12 m, 3 en una avenida de 18).
  const av=g.cells?g.ancho>=3:r.ancho===12,cells=g.cells||(av?[[g.x,g.y],g.dir[0]?[g.x,g.y+1]:[g.x+1,g.y]]:[[g.x,g.y]]);
  for(const [cx,cy] of cells){kind[cy*W+cx]=av?K.avenue:K.street;exitOut.add((cx+g.dir[0])+','+(cy+g.dir[1]));}
  exits.push({gate:[g.x,g.y],cells,dir:g.dir,ancho:r.ancho||6,P:r.puntos.map(p=>[p.x,p.z]),H:r.puntos.map(p=>p.h),rot:r.rotonda||null});}
 // Parques (opción del generador): pasto con senderos por el borde y por el medio, arboledas, fuente, bancas y faroles.
 const parkOf=new Int16Array(W*H).fill(-1);(map.parks||[]).forEach((b,i)=>{for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)parkOf[y*W+x]=i;});
 const pathCell=barrio?()=>false:(x,y)=>{const b=map.parks[parkOf[y*W+x]],mx=Math.floor((b.x0+b.x1)/2),my=Math.floor((b.y0+b.y1)/2);return x===b.x0||x===b.x1||y===b.y0||y===b.y1||x===mx||y===my;};
 const at=(x,y)=>x<0||y<0||x>=W||y>=H?K.border:kind[y*W+x];
 const same=(a,b)=>a.x0===b.x0&&a.y0===b.y0&&a.x1===b.x1&&a.y1===b.y1;

 // Qué es cada manzana: un objetivo, la comisaría, una casa con cuartos o un edificio. De eso salen su alto y su color.
 const owner=new Int16Array(W*H).fill(-1);
 const blocks=map.blocks.map((b,i)=>{
  for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)owner[y*W+x]=i;
  const site=map.sites.find(s=>same(s.block,b)),station=map.station&&same(map.station.block,b)?map.station:null,house=map.houses.find(h=>same(h,b));
  const r=hash(b.x0,b.y0,map.seed);
  const floors=site?2:station?3:house?{chico:2,mediano:3,alargado:3,grande:4}[house.type]+Math.floor(r*3):3+Math.floor(r*6);
  return {site,station,house,h:floors*FLOOR+.4,tint:site?SITE_TINT:station?STATION_TINT:TINTS[Math.floor(hash(b.x1,b.y1,map.seed)*TINTS.length)],uo:Math.floor(r*4)/4,vo:Math.floor(hash(b.y0,b.x1,7)*4)/4};
 });
 const borderInfo=(x,y)=>{const a=Math.floor(x/3),b=Math.floor(y/3),r=hash(a,b,map.seed+5),tint=TINTS[Math.floor(hash(b,a,3)*TINTS.length)];return {h:(3+Math.floor(r*5))*FLOOR+.4,tint,trim:lighten(tint),uo:Math.floor(r*4)/4,vo:0};};
 for(const b of blocks)b.trim=lighten(b.tint);
 const DEFAULT_INFO={h:FLOOR+.4,tint:TINTS[0],trim:lighten(TINTS[0]),uo:0,vo:0};
 // Lotes: cada manzana se ve como varios edificios, como en el pack de referencia. El borde de la manzana se corta en
 // tramos de 1 a 3 casillas de frente (cada uno con su color, su altura y sus molduras) y el interior se reparte entre
 // los lotes vecinos. Es sólo de fachada y techo: los cuartos y las puertas del juego no cambian. Los objetivos y la
 // comisaría siguen siendo un solo edificio. Todo sale de la semilla.
 const lotOf=new Int32Array(W*H).fill(-1),lots=[];
 // Con el plano: un lote por edificio del plano, con su estilo de fachada, su color, sus pisos y su nombre.
 if(plan)plan.lots.forEach((B,i)=>{const NAMES_=['ladrillo','claro','piedra','metal'],civ=CIVIC[B.type];
  // La fachada (engine/fachada.js): la que trae el plano (B.fachada: variedad por barrio, 2026-10-12; antes era ladrillo
  // en todos, 2026-10-10). Sin ella, ladrillo con una pintura sin repetir la del vecino. Los públicos, la suya.
  const fs=B.fachada&&!civ&&B.type!=='comisaria'&&B.type!=='objetivo'?facadeStyle(B.fachada):null;
  const style='ladrillo',pal=[null,null,null,...PAINTS.ladrillo.filter(Boolean)];
  let pi=Math.floor(hash(i,5,map.seed+61)*pal.length);if(pal[pi]&&lots[i-1]?.paint===pal[pi])pi=(pi+1)%pal.length;
  const tint=TINTS[Math.floor(hash(i,3,map.seed)*TINTS.length)];
  lots.push({type:B.type,floors:B.floors,h:B.floors*FLOOR,style,fs,raise:fs?.raise||0,paint:B.type==='comisaria'?'#3d6fb8':civ?(civ.tint||null):B.type==='objetivo'?'#f4e9d4':fs?fs.paint:pal[pi],upper:0,bname:B.name,
   tint,trim:lighten(tint),uo:0,vo:0,site:B.type==='objetivo'?{name:B.name}:null,station:B.type==='comisaria'?{}:null,civic:civ&&B.type!=='comisaria'?B.type:null});
  for(const p of B.parts)for(let y=p.y/S;y<(p.y+p.h)/S;y++)for(let x=p.x/S;x<(p.x+p.w)/S;x++)lotOf[y*W+x]=i;});
 else map.blocks.forEach((b,i)=>{
  const B=blocks[i],cells=[];for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)cells.push([x,y]);
  if(B.site||B.station){const id=lots.push(B)-1;for(const [x,y] of cells)lotOf[y*W+x]=id;return;}
  const ring=[];for(let x=b.x0;x<=b.x1;x++)ring.push([x,b.y0]);for(let y=b.y0+1;y<=b.y1;y++)ring.push([b.x1,y]);
  if(b.y1>b.y0)for(let x=b.x1-1;x>=b.x0;x--)ring.push([x,b.y1]);if(b.x1>b.x0)for(let y=b.y1-1;y>b.y0;y--)ring.push([b.x0,y]);
  const n=ring.length,start=Math.floor(hash(b.x0,b.y1,map.seed+3)*n);let k=0,prevTint=null;
  while(k<n){
   const [cx,cy]=ring[(start+k)%n],r=hash(cx,cy,map.seed+17),len=1+Math.floor(hash(cy,cx,map.seed+19)*3);
   const base=B.house?{chico:2,mediano:3,alargado:3,grande:4}[B.house.type]-1:2,floors=Math.max(2,base+Math.floor(B.house?r*3:Math.pow(r,1.3)*7));
   let t=Math.floor(hash(cx,cy,map.seed+23)*TINTS.length);if(TINTS[t]===prevTint)t=(t+1)%TINTS.length;prevTint=TINTS[t];
   const id=lots.push({...B,h:floors*FLOOR+.4,tint:TINTS[t],trim:lighten(TINTS[t]),uo:Math.floor(hash(cx,cy,29)*4)/4,vo:Math.floor(hash(cy,cx,31)*4)/4})-1;
   for(let j=0;j<len&&k<n;j++,k++){const [x,y]=ring[(start+k)%n];lotOf[y*W+x]=id;}
  }
  // El interior, al lote del borde más cercano.
  const q=ring.map(([x,y])=>y*W+x);
  for(let h=0;h<q.length;h++){const c=q[h],x=c%W,y=(c-x)/W;for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy;if(nx<b.x0||nx>b.x1||ny<b.y0||ny>b.y1||lotOf[ny*W+nx]>=0)continue;lotOf[ny*W+nx]=lotOf[c];q.push(ny*W+nx);}}
 });
 // Con las piezas del MegaKit: cada lote recibe un estilo de fachada y una altura en pisos enteros, y sus casillas
 // (menos las abiertas, como patios) son el interior hueco del edificio. Los objetivos van en piedra blanca y la
 // comisaría en metal, para que se distingan.
 const hollow=new Uint8Array(W*H);
 if(downtown&&plan){for(let i=0;i<W*H;i++)if(lotOf[i]>=0)hollow[i]=1;}
 else if(downtown){const NAMES_=['ladrillo','claro','piedra','metal'];
  // Todos los lotes de una manzana (casas, objetivos, comisaría y los edificios que el mapa no lista como casa).
  lots.forEach((L,i)=>{
   L.style=L.site?'piedra':L.station?'claro':NAMES_[Math.floor(hash(i,7,map.seed+57)*4)];
   L.floors=Math.max(2,Math.round((L.h-.4)/FLOOR));L.h=L.floors*FLOOR;L.upper=Math.floor(hash(i,3,map.seed+59)*STYLES[L.style].upper.length);
   // Un color por edificio (null = el natural del material). Al vecino de al lado (el lote anterior) no le toca el mismo.
   const pal=PAINTS[L.style];let pi=Math.floor(hash(i,5,map.seed+61)*pal.length);if(pal[pi]&&lots[i-1]?.paint===pal[pi])pi=(pi+1)%pal.length;
   // La comisaría, azul (ladrillo pintado, molduras blancas).
   L.paint=L.site?null:L.station?'#3d6fb8':pal[pi];});
  for(let i=0;i<W*H;i++)if(lotOf[i]>=0&&lots[lotOf[i]].style&&!OPEN.has(kind[i])&&kind[i]!==K.border)hollow[i]=1;}
 const info=(x,y)=>{const o=x<0||y<0||x>=W||y>=H?-1:lotOf[y*W+x];return o>=0?lots[o]:at(x,y)===K.border?borderInfo(x,y):DEFAULT_INFO;};

 const Q={};const q=key=>Q[key]||(Q[key]=new Quads());
 // Relieve de las fachadas (cajas con instancias): molduras claras y zócalo oscuro.
 const trims=[],plinths=[],TRIM='#f1eee6',TRIM_ON_LIGHT='#d6d0c2';
 const trimOf=inf=>['#e6d9bb','#ecebe6',SITE_TINT].includes(inf.tint)?TRIM_ON_LIGHT:TRIM;
 const darker=hex=>'#'+new THREE.Color(hex).multiplyScalar(.62).getHexString();
 const piece=(list,x0,z0,x1,z1,nx,nz,f,y,w,h,d,p,color)=>list.push({x:x0+(x1-x0)*f+nx*p,y,z:z0+(z1-z0)*f+nz*p,ry:Math.atan2(nx,nz),sx:w,sy:h,sz:d,color});
 const facade=(inf,x0,z0,x1,z1,y0,y1,nx,nz,store)=>{
  const fo={us:1/S/4,vs:1/FLOOR/4,uo:inf.uo,vo:inf.vo},from=y0,tc=trimOf(inf);
  if(store&&y1>FLOOR&&y0<FLOOR){q('store:'+inf.tint).wall(x0,z0,x1,z1,y0,FLOOR,nx,nz,{us:1/S/4,vs:1/FLOOR,uo:inf.uo});y0=FLOOR;}
  // Ventanas en relieve: alféizar y dintel en cada ventana de cada piso entero de la fachada.
  for(let f=Math.ceil(y0/FLOOR-1e-6);(f+1)*FLOOR<=y1+1e-6;f++){const yb=f*FLOOR;if(yb<y0-1e-6)continue;
   for(const c of WIN.at){piece(trims,x0,z0,x1,z1,nx,nz,c,yb+WIN.bottom-.05,1.05,.1,.22,.1,tc);piece(trims,x0,z0,x1,z1,nx,nz,c,yb+WIN.top+.08,.98,.14,.12,.06,tc);}}
  // Franja entre pisos, y zócalo oscuro abajo.
  for(let yb=FLOOR;yb<y1-.5;yb+=FLOOR)if(yb>from+.01)piece(trims,x0,z0,x1,z1,nx,nz,.5,yb,S+.02,.16,.14,.06,tc);
  if(from===0)piece(plinths,x0,z0,x1,z1,nx,nz,.5,.21,S+.02,.42,.16,.07,darker(inf.tint));
  if(y1>y0)q('fac:'+inf.tint).wall(x0,z0,x1,z1,y0,y1,nx,nz,fo);
  // Cornisa: el borde de la azotea sube medio metro, con un remate más claro que la fachada.
  if(y1===inf.h){piece(trims,x0,z0,x1,z1,nx,nz,.5,y1+.59,S+.6,.2,.66,.08,tc);piece(trims,x0,z0,x1,z1,nx,nz,.5,y1-.18,S+.2,.32,.22,.1,tc);}
  if(y1===inf.h){const P=.5,T=.28,ix0=x0-nx*T,iz0=z0-nz*T,ix1=x1-nx*T,iz1=z1-nz*T,col=inf.trim,t=q('trim');
   t.wall(x0,z0,x1,z1,y1,y1+P,nx,nz,{col});t.wall(ix0,iz0,ix1,iz1,y1,y1+P,-nx,-nz,{col});
   t.flat(Math.min(x0,x1,ix0,ix1),Math.min(z0,z1,iz0,iz1),Math.max(x0,x1,ix0,ix1),Math.max(z0,z1,iz0,iz1),y1+P,true,{col});}
 };
 // Borde de una casilla hacia la dirección (dx,dy).
 const edge=(x,y,dx,dy)=>{const cx=(x+.5+dx*.5)*S,cz=(y+.5+dy*.5)*S,tx=dy,tz=-dx;return [cx-tx*S/2,cz-tz*S/2,cx+tx*S/2,cz+tz*S/2];};
 const jail=new Set((map.station?.jail||[]).map(p=>Math.floor(p.y)*W+Math.floor(p.x)));
 const streetFaces=[],seawall=[]; // seawall: el anillo del borde, que en la isla es el paseo que da a la playa
 const streetFaces_=null; // fachadas de muro que dan a una calle, avenida o plaza: ahí van toldos y vallas

 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  if(vacio&&vacio[y*W+x])continue;
  const k=kind[y*W+x],x0=x*S,z0=y*S,x1=x0+S,z1=z0+S;
  if(OPEN.has(k)){
   const gk=k===K.kiosk?(at(x-1,y)===K.plaza||at(x+1,y)===K.plaza?K.plaza:K.avenue):k;
   if(gk===K.plaza&&parkOf[y*W+x]>=0&&!(k===K.plaza&&pathCell(x,y)))q('grass').flat(x0,z0,x1,z1,0,true,{us:1/(2*S)});
   else if(gk===K.plaza)q('paving').flat(x0,z0,x1,z1,0,true,{us:1/(2*S)});
   else if(gk===K.courtyard)q('court').flat(x0,z0,x1,z1,0,true,{us:1/(2*S)});
   else q('asphalt').flat(x0,z0,x1,z1,0,true,{us:1/(2*S),col:gk===K.alley?[.86,.84,.8]:[1,1,1]});
   continue;
  }
  // El borde de la ciudad es un paseo de piedra que da a la playa. En 3D se camina (en el juego sigue siendo pared).
  if(k===K.border){seawall.push([x,y]);q('paving').flat(x0,z0,x1,z1,0,true,{us:1/(2*S)});continue;}
  // Los edificios armados con piezas se dibujan aparte; acá sólo se anotan sus fachadas a la calle (toldos, letreros, vallas).
  if(hollow[y*W+x]){const inf=info(x,y);for(const [dx,dy] of DIRS){const nk=at(x+dx,y+dy);if(nk===K.street||nk===K.avenue||nk===K.plaza)streetFaces.push({x,y,dx,dy,inf,nk,o:lotOf[y*W+x],e:edge(x,y,dx,dy)});}continue;}
  const inf=info(x,y),h=inf.h;
  q('roof').flat(x0,z0,x1,z1,h,true,{us:1/(2*S)});
  // Esquinas marcadas: una pilastra clara en cada esquina que da a la calle por los dos lados.
  if(isSolid(k)&&k!==K.border)for(const dx of [-1,1])for(const dy of [-1,1])if(OPEN.has(at(x+dx,y))&&OPEN.has(at(x,y+dy)))trims.push({x:(x+.5+dx*.5)*S+dx*.08,y:h/2,z:(y+.5+dy*.5)*S+dy*.08,sx:.5,sy:h,sz:.5,color:trimOf(inf)});
  // Donde termina un lote y empieza otro, una pilastra angosta en la fachada marca la medianera.
  if(isSolid(k)&&lotOf[y*W+x]>=0)for(const [dx,dy] of DIRS){if(!OPEN.has(at(x+dx,y+dy)))continue;const ax2=x+dy,ay2=y-dx;if(ax2<0||ay2<0||ax2>=W||ay2>=H)continue;
   const o2=lotOf[ay2*W+ax2];if(o2<0||o2===lotOf[y*W+x]||!isSolid(at(ax2,ay2))||!OPEN.has(at(ax2+dx,ay2+dy)))continue;
   trims.push({x:(x+.5+dx*.5+dy*.5)*S+dx*.07,y:Math.max(h,lots[o2].h)/2,z:(y+.5+dy*.5-dx*.5)*S+dy*.07,sx:.3,sy:Math.max(h,lots[o2].h),sz:.3,color:trimOf(inf)});}
  if(ROOF.has(k)){
   const fk=k===K.vault?'vault':k===K.floor||k===K.door&&(inf.site||inf.station)?'tile':'wood';
   q(fk).flat(x0,z0,x1,z1,0,true,{us:1/S,col:jail.has(y*W+x)?[.75,.85,.95]:[1,1,1]});
   q('ceiling').flat(x0,z0,x1,z1,CEIL,false,{us:1/S});
  }
  for(const [dx,dy] of DIRS){
   const nk=at(x+dx,y+dy),[ax,az,bx,bz]=edge(x,y,dx,dy);
   if(OPEN.has(nk)){
    // Hacia la calle: fachada entera desde un muro; desde un interior (una puerta), sólo el dintel sobre el vano.
    if(isSolid(k))facade(inf,ax,az,bx,bz,0,h,dx,dy,!inf.site&&!inf.station&&nk!==K.courtyard);
    if(isSolid(k)&&(nk===K.street||nk===K.avenue||nk===K.plaza))streetFaces.push({x,y,dx,dy,inf,nk,o:lotOf[y*W+x],e:[ax,az,bx,bz]});
    else facade(inf,ax,az,bx,bz,CEIL,h,dx,dy,false);
   }else if(ROOF.has(nk)&&isSolid(k)){
    q('plaster').wall(ax,az,bx,bz,0,CEIL,dx,dy,{us:1/S,vs:1/CEIL,col:jail.has((y+dy)*W+x+dx)?[.82,.88,.95]:[1,1,1]});
   }
   // Donde un edificio es más alto que el vecino, la fachada sigue por encima.
   if(!OPEN.has(nk)&&x+dx>=0&&y+dy>=0&&x+dx<W&&y+dy<H){const hn=info(x+dx,y+dy).h;if(hn<h)facade(inf,ax,az,bx,bz,Math.max(hn,ROOF.has(k)?CEIL:0),h,dx,dy,false);}
  }
 }

  WORLD_TIMES.lap('edificios');
 // ---------- Edificios armados con piezas del MegaKit, huecos por dentro ----------
 // Por casilla: un piso de mármol en cada nivel (vacíos, por ahora sin escaleras ni cuartos) y el techo arriba. Por cada lado que
 // da afuera, la fachada piso por piso (dos piezas de 2 m o una de 4 m): vidriera o pared abajo, la puerta donde la grilla
 // tiene una, ventanas arriba y la cornisa. Cada lote es un edificio aparte: muros interiores lo separan de sus vecinos en
 // todos los pisos (y por encima del más bajo, muro ciego), y todos tienen al menos una puerta a la calle.
 // Para los choques, cada fachada y cada muro es una pared fina (con el hueco de la puerta): adentro se camina libre.
 // Tramos seguidos de fachada (mismo lote, mismo lado): en los de dos casillas o más, a veces una valla, entre el primer
 // y el tercer piso. Se decide antes de armar los edificios: detrás de cada valla la fachada va sin ventanas.
 function planFacadeAds(){const out=[],runs=new Map();
  for(const f of streetFaces){if(f.inf.site||f.inf.station||f.inf.civic||f.inf.h<3*FLOOR)continue;const key=`${f.dx},${f.dy},${f.o},${f.dx?f.x:f.y}`;(runs.get(key)||runs.set(key,[]).get(key)).push(f);}
  for(const list of runs.values()){list.sort((a,b)=>(a.dx?a.y-b.y:a.x-b.x));
   let run=[list[0]];const flush=()=>{
    if(run.length>=2&&hash(run[0].x,run[0].y,run.length+3)<.42){
     const f0=run[0],f1=run[run.length-1],w=Math.min(run.length*S-1.4,8),h=Math.min(w/2,3.6),cx=(f0.e[0]+f0.e[2]+f1.e[0]+f1.e[2])/4,cz=(f0.e[1]+f0.e[3]+f1.e[1]+f1.e[3])/4;
     if(FLOOR+.9+h<f0.inf.h-.5)out.push({run:[...run],w,h,cx,cz,dx:f0.dx,dy:f0.dy,y:FLOOR+.9+h/2,ad:Math.floor(hash(f0.x,f0.y,13)*99)});}
    run=[];};
   for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];if((a.dx?b.y-a.y:b.x-a.x)===1)run.push(b);else{flush();run=[b];}}
   flush();}
  return out;}
 // Altura de lo construido en un punto (0 en calles, plazas y el paseo), y la más alta bajo un cartel de ancho 2·half
 // centrado en (x,z) que corre a lo largo de (tx,tz): para que ninguna valla quede metida en la pared de un vecino.
 const builtH=(px,pz)=>{const cx=Math.floor(px/S),cy=Math.floor(pz/S),k=at(cx,cy);return OPEN.has(k)||k===K.border?0:info(cx,cy).h;};
 const clearance=(x,z,tx,tz,half,nx,nz)=>{let m=0;for(let t=-half-.3;t<=half+.3;t+=.4)for(const d of [-.35,0,.35])m=Math.max(m,builtH(x+tx*t+nx*d,z+tz*t+nz*d));return m;};
 let adPlan=null;const blank=new Set(); // «x,y,dx,dy,piso»: tramos de fachada sin ventanas (detrás de un cartel)
 const blankOut=(faces,y0,y1)=>{for(const f of faces)for(let fl=Math.max(1,Math.floor(y0/FLOOR));fl<=Math.floor((y1-.01)/FLOOR);fl++)blank.add(`${f.x},${f.y},${f.dx},${f.dy},${fl}`);};
 // El frente de cada puerta (y de cada portón): ahí no se pone nada que estorbe el paso (ver inDoor).
 const doorFronts=[],doorFrames=[];
 const stoopsByCell=new Map(),balconiesByCell=new Map(),lotFurniture=new Map(),surfByCell=new Map(),panios=new Map();let cortinaMesh=null,cortinaOrig=null,cortinaLote=null,cortinaSlot=null,cortinasVisibles=null;const panioDe=[];let stationInfo=null,lotPlaques=[],town=null,civ=null,civicFronts=[],elevators=[],setElevatorDoors=()=>{};const walls=new Map(),WALL_T=.3;let stairsByLot=new Map();
 if(downtown&&plan){
  // Los edificios del plano (town3d.js): fachadas, pisos, tabiques, ascensores, muebles y choques.
  adPlan=barrio||LOWPOLY.on?[]:planFacadeAds();// (van en la azotea: la fachada conserva sus ventanas; con LOWPOLY, sin publicidad)
  const addWall=(cx,cy,ax,az,bx,bz,y0=-1e3,y1=1e3)=>{const key=cy*W+cx;(walls.get(key)||walls.set(key,[]).get(key)).push([Math.min(ax,bx),Math.min(az,bz),Math.max(ax,bx),Math.max(az,bz),y0,y1]);};
  elevators=[];
  const T=buildTown(plan,{S,FLOOR,CEIL,W,H,lots,lotOf,hash,seed:map.seed,blank,addWall,furniture,clearance,CIVIC,group,own,instanced,base,PAINT_ON,elevators});
  // (las superficies de los muebles pisables, por casilla: para pararse encima —floorAt—)
  for(const p of T.superficies)for(let cy=Math.floor(p.z0/S);cy<=Math.floor((p.z1-1e-6)/S);cy++)for(let cx=Math.floor(p.x0/S);cx<=Math.floor((p.x1-1e-6)/S);cx++){const k=cy*W+cx;(surfByCell.get(k)||surfByCell.set(k,[]).get(k)).push(p);}
  // (lo de las azoteas —town3d roofProps, engine/azoteas.js—: del catálogo, en una malla por color, siempre a la vista)
  if(T.roofProps.length){const ps=T.roofProps.flatMap(e=>placeParts(OBJETOS[e.modelo].piezas(e.o),{x:e.x,y:e.y,z:e.z,ry:e.ry}));const g=partsMesh(ps);group.add(g);g.traverse(o=>{if(o.isInstancedMesh)own.push(o);});}
  doorFronts.push(...T.doorFronts);stairsByLot=T.stairs;for(const [k,v] of T.lotFurniture)lotFurniture.set(k,v);stationInfo=T.stationInfo;civicFronts.push(...T.civicFronts);
  setElevatorDoors=buildCabins(elevators,{FLOOR,group,own,instanced,base,addWall,S,W,H});
  // Las cortinas cerradas (town3d T.cortinas): siempre, con la fachada —no con los muebles, que sólo se dibujan de cerca—.
  if(T.cortinas.length){const cm=new THREE.MeshStandardMaterial({roughness:.95,flatShading:true}),cg=base(new THREE.BoxGeometry(1,1,1));own.push(cm,cg);cortinaMesh=instanced(group,cg,cm,T.cortinas,{cast:false});
   // (cada paño, cerrado o corrido —abierto: sus cajas en escala cero—; el jugador lo cambia: cortina(key))
   // (cada caja, descompuesta: al correrse, la tela se abre desde el centro del paño —su primera caja— a lo largo de la pared)
   const M=new THREE.Matrix4();for(const p of T.panios){p.partes=[];for(let i=0;i<p.n;i++){cortinaMesh.getMatrixAt(p.i0+i,M);const pos=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();M.decompose(pos,q,sc);p.partes.push({pos,q,sc});}
    const c0=p.partes[0];p.centro=c0.pos.clone();p.eje=c0.sc.x>=c0.sc.z?'x':'z';p.k=p.cerrada?1:0;panios.set(p.key,p);ponPanio(p);}cortinaMesh.instanceMatrix.needsUpdate=true;}
   // (2026-10-16, medido en el navegador sin ventana: las cortinas de toda la ciudad son una sola malla —240 mil triángulos
   // también desde adentro de un edificio—: se apagan con su lote, como las piezas de downtown3d; las matrices de cada una,
   // guardadas para volver a ponerlas)
   if(cortinaMesh){cortinaOrig=cortinaMesh.instanceMatrix.array.slice();cortinaLote=T.cortinas.map(c=>c.lote??-1);cortinaSlot=new Int32Array(cortinaLote.length).map((_,i)=>i);for(const p of T.panios)for(let i=0;i<p.n;i++)panioDe[p.i0+i]=p;}
  WORLD_TIMES.lap('unir');lotPlaques=T.plaques;town=buildDowntown(downtown,T.items,T.leaves);group.add(town.group);
  // Las escalinatas (town3d.js): por casilla, para el piso de afuera.
  for(const st of T.stoops||[]){const cx=Math.floor((st.x+st.nx*.5)/S),cy=Math.floor((st.z+st.nz*.5)/S),k=cy*W+cx;(stoopsByCell.get(k)||stoopsByCell.set(k,[]).get(k)).push(st);}
  // Los balcones (town3d.js): por casilla, para pisarlos.
  for(const b of T.balconies||[]){const k=Math.floor((b.z+b.nz*.5)/S)*W+Math.floor((b.x+b.nx*.5)/S);(balconiesByCell.get(k)||balconiesByCell.set(k,[]).get(k)).push(b);}
  // Las sombras de los edificios: las piezas de las fachadas (molduras, marcos, cornisas: ~1,5 M de triángulos) ya no
  // proyectan sombra; cada edificio la proyecta con una caja por parte de su planta, de su alto (12 triángulos), que no se
  // ve (no escribe color ni profundidad) pero entra al mapa de sombras. Siguen recibiendo sombra.
  town.group.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  {const cajas=[];plan.lots.forEach(B=>{const h=B.floors*FLOOR;for(const p of B.parts)cajas.push({x:p.x+p.w/2,y:h/2,z:p.y+p.h/2,sx:p.w,sy:h,sz:p.h});});
   if(cajas.length){const g=new THREE.BoxGeometry(1,1,1),m=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}),im=new THREE.InstancedMesh(g,m,cajas.length),o=new THREE.Object3D();
    cajas.forEach((c,i)=>{o.position.set(c.x,c.y,c.z);o.scale.set(c.sx,c.sy,c.sz);o.updateMatrix();im.setMatrixAt(i,o.matrix);});im.castShadow=true;im.receiveShadow=false;im.renderOrder=-1;group.add(im);own.push(g,m);}}town.debug={lotOf,lots,civics:T.civics,adPlan,elevators,walls,lotFurniture,items:T.items};
  civ=buildCivic(T.civics,{vehicle});group.add(civ.group);
  for(const [ax,az,bx,bz] of civ.blocks)for(let cy=Math.floor(az/S);cy<=Math.floor(bz/S);cy++)for(let cx=Math.floor(ax/S);cx<=Math.floor(bx/S);cx++)addWall(cx,cy,ax,az,bx,bz);
 }
 else if(downtown){
  const items=[],isH=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&hollow[y*W+x]===1,lotAt=(x,y)=>lots[lotOf[y*W+x]];
  // Paredes de choque: rectángulo en planta y, opcional, el tramo de alturas en que existe (y0..y1).
  const addWall=(cx,cy,ax,az,bx,bz,y0=-1e3,y1=1e3)=>{const key=cy*W+cx;(walls.get(key)||walls.set(key,[]).get(key)).push([Math.min(ax,bx),Math.min(az,bz),Math.max(ax,bx),Math.max(az,bz),y0,y1]);};
  // Una fila de piezas a lo largo de un lado (4 m): pieces=[[nombre,ancho],…] se repite hasta llenar.
  // Una fila de piezas a lo largo de un lado (S m): la lista se repite hasta llenar; si una pieza no entra en lo que
  // queda, va fit (una de 2 m).
  const HALF=S/2;
  const row=(list,x,y,dx,dy,yb,extra=()=>({}),shift=0,fit=null)=>{const ry=Math.atan2(dx,dy),tx=dy,tz=-dx,mx=(x+.5+dx*(.5+shift/S))*S,mz=(y+.5+dy*(.5+shift/S))*S;let at_=-HALF,i=0;
   while(at_<HALF-.01){let [name,w]=list[i%list.length];if(at_+w>HALF+.01)[name,w]=fit||list.find(e=>e[1]<=HALF-at_+.01)||[name,w];const c=at_+w/2;items.push({piece:name,x:mx+tx*c,y:yb,z:mz+tz*c,ry,...extra(c,i)});at_+=w;i++;}};
  const wallRect=(x,y,dx,dy,from,to,y0,y1)=>{const tx=dy,tz=-dx,mx=(x+.5+dx*.5)*S,mz=(y+.5+dy*.5)*S;addWall(x,y,mx+tx*from,mz+tz*from,mx+tx*to-dx*WALL_T,mz+tz*to-dy*WALL_T,y0,y1);};
  // Edificios públicos (civic3d.js): los lotes más grandes con frente a la calle, separados entre sí, pasan a ser
  // hospital, bomberos, colegio, mercado, biblioteca y cine (más cuanto más grande la ciudad). Toman estilo, color y
  // altura propios; el hospital y los bomberos tienen portones abiertos con su vehículo adentro.
  const civics=[],bays=new Map(),lotCells=new Map(),lotFront=new Map(),keyOf=(x,y,dx,dy)=>`${x},${y},${dx},${dy}`;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!isH(x,y))continue;const id=lotOf[y*W+x];(lotCells.get(id)||lotCells.set(id,[]).get(id)).push([x,y]);
   for(const [dx,dy] of DIRS){const nk=at(x+dx,y+dy);if(nk===K.street||nk===K.avenue||nk===K.plaza)(lotFront.get(id)||lotFront.set(id,[]).get(id)).push({x,y,dx,dy});}}
  const centerOf=id=>{const c=lotCells.get(id);return [c.reduce((a,p)=>a+p[0],0)/c.length,c.reduce((a,p)=>a+p[1],0)/c.length];};
  // Un portón necesita fondo: la casilla de atrás tiene que ser del mismo lote (y no ser una puerta del mapa).
  const bayEdges=id=>lotFront.get(id).filter(e=>{const bx=e.x-e.dx,by=e.y-e.dy;return kind[e.y*W+e.x]!==K.door&&isH(bx,by)&&lotOf[by*W+bx]===id;});
  const pool=[...lotFront.keys()].filter(id=>!lots[id].site&&!lots[id].station&&lotFront.get(id).length>=2&&lotCells.get(id).length>=3)
   .sort((a,b)=>lotCells.get(b).length-lotCells.get(a).length||hash(a,13,map.seed)-hash(b,13,map.seed));
  for(const type of CIVIC_ORDER.slice(0,Math.min(CIVIC_ORDER.length,Math.max(3,Math.round(lotCells.size/16))))){const info=CIVIC[type];
   const pick=pool.find(id=>!lots[id].civic&&(!info.bay||bayEdges(id).length)&&civics.every(c=>{const [ax,ay]=centerOf(id),[bx,by]=centerOf(c.id);return Math.hypot(ax-bx,ay-by)>6;}));
   if(pick===undefined)continue;const L=lots[pick];
   Object.assign(L,{civic:type,style:info.style,fs:null,paint:info.tint||null,upper:0,civicName:info.names[Math.floor(hash(pick,19,map.seed+83)*info.names.length)]});
   L.floors=info.floors[0]+Math.floor(hash(pick,17,map.seed+79)*(info.floors[1]-info.floors[0]+1));L.h=L.floors*FLOOR;
   const c={id:pick,type,name:L.civicName,bay:[]};civics.push(c);
   if(info.bay)for(const e of bayEdges(pick).sort((a,b)=>hash(a.x,a.y,7)-hash(b.x,b.y,7)).slice(0,info.bays||1))bays.set(keyOf(e.x,e.y,e.dx,e.dy),c);}
  // La comisaría (la del mapa) también lleva letrero en la azotea y dos portones con patrulla.
  for(const [id] of lotCells){if(!lots[id].station)continue;const c={id,type:'comisaria',name:'Comisaría',bay:[]};civics.push(c);
   for(const e of bayEdges(id).sort((a,b)=>hash(a.x,a.y,7)-hash(b.x,b.y,7)).slice(0,2))bays.set(keyOf(e.x,e.y,e.dx,e.dy),c);
   stationInfo={floors:lots[id].floors,cells:lotCells.get(id).map(([x,y])=>[x*S,y*S,(x+1)*S,(y+1)*S])};}
  // El tramo de fachada más largo de cada edificio público: ahí va su nombre (en la azotea; el cine, en marquesina).
  for(const c of civics){const runs=new Map();for(const e of lotFront.get(c.id)){const k=`${e.dx},${e.dy},${e.dx?e.x:e.y}`;(runs.get(k)||runs.set(k,[]).get(k)).push(e);}
   let best=[];for(const list of runs.values()){list.sort((a,b)=>a.dx?a.y-b.y:a.x-b.x);let run=[list[0]];for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];if((a.dx?b.y-a.y:b.x-a.x)===1)run.push(b);else{if(run.length>best.length)best=run;run=[b];}}if(run.length>best.length)best=run;}
   c.run=best;if(CIVIC[c.type].marquee)blankOut(best,FLOOR,FLOOR+1.6);}
  adPlan=barrio||LOWPOLY.on?[]:planFacadeAds();// (van en la azotea: la fachada conserva sus ventanas; con LOWPOLY, sin publicidad)
  // Puertas: las del mapa y, en cada lote que no tenga, una hacia la calle (y otra lejos de la primera si tiene mucho
  // frente). Así se puede entrar a todos los edificios; el motor 2D se calibra aparte.
  const doorSet=new Set(),fronts_=new Map(),leaves=[],ekey=e=>`${e.x},${e.y},${e.dx},${e.dy}`;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!isH(x,y))continue;for(const [dx,dy] of DIRS){const nk=at(x+dx,y+dy);if(!OPEN.has(nk)||isH(x+dx,y+dy)||bays.has(keyOf(x,y,dx,dy)))continue;
   const id=lotOf[y*W+x];(fronts_.get(id)||fronts_.set(id,[]).get(id)).push({x,y,dx,dy,street:nk===K.street||nk===K.avenue||nk===K.plaza,engine:kind[y*W+x]===K.door,r:hash(x*5+dx,y*7+dy,map.seed+71)});}}
  for(const list of fronts_.values()){const chosen=list.filter(e=>e.engine),want=list.length>=6?2:1;
   const rest=list.filter(e=>!e.engine).sort((a,b)=>(b.street-a.street)||(a.r-b.r));
   while(chosen.length<want&&rest.length){const far=chosen.length?rest.reduce((m,e)=>{const d=Math.min(...chosen.map(c=>Math.abs(c.x-e.x)+Math.abs(c.y-e.y)));return d>m.d?{e,d}:m;},{e:null,d:-1}).e:rest[0];
    if(!far||chosen.length&&Math.min(...chosen.map(c=>Math.abs(c.x-far.x)+Math.abs(c.y-far.y)))<3)break;chosen.push(far);rest.splice(rest.indexOf(far),1);}
   for(const e of chosen)doorSet.add(ekey(e));}
  WORLD_TIMES.lap('nombres');
  // ---------- Nombres de los edificios ----------
  // Cada edificio tiene el suyo, sin repetirse en la ciudad (con su propio azar: no cambia nada más). Va en una placa
  // sobre cada puerta y en la barra de lugar al entrar. Los públicos, objetivos y la comisaría usan el que ya tienen.
  {const nr=rng(map.seed*991+5),pool=[...BUILDING_NAMES],used=new Set();for(let i=pool.length-1;i>0;i--){const j=Math.floor(nr()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}let k=0;
   for(const id of [...lotCells.keys()].sort((a,b)=>a-b)){const L=lots[id];
    if(L.civicName)L.bname=L.civicName;else if(L.site)L.bname=L.site.name;else if(L.station)L.bname='Comisaría';
    else{const kinds=L.floors>=6?['Torre','Edificio']:L.floors>=4?['Edificio','Torre','Residencias']:['Edificio','Residencias','Casa'],first=Math.floor(nr()*kinds.length);
     // Sin repetir: si el nombre ya está, el siguiente de la lista (y si se acaba, con otro prefijo).
     let name=null;for(let t=0;t<pool.length*kinds.length&&!name;t++){const n=`${kinds[(first+Math.floor(t/pool.length))%kinds.length]} ${pool[(k+t)%pool.length]}`;if(!used.has(n))name=n;}
     k++;L.bname=name||`Edificio ${id}`;}used.add(L.bname);}}
  const plaques=[];
  WORLD_TIMES.lap('ascensores');
  // ---------- Ascensores: uno por edificio de dos pisos o más ----------
  // Una cabina de 1,7 m por piso, apiladas en una esquina de una casilla del lote (lejos de las puertas), con la puerta
  // hacia el centro de la casilla. No cortan los pisos ni cambian las fachadas. Se usa con E (subir) y Q (bajar).
  elevators=[];
  for(const [id,cells] of lotCells){const L=lots[id];if(L.floors<2)continue;let best=null;
   for(const [x,y] of cells){const doorSides=DIRS.filter(([dx,dy])=>doorSet.has(keyOf(x,y,dx,dy))||bays.has(keyOf(x,y,dx,dy)));
    const outside=DIRS.filter(([dx,dy])=>!isH(x+dx,y+dy)).length;
    for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){if(doorSides.some(([dx,dy])=>dx===sx||dy===sy))continue;
     const score=outside*2+hash(x*5+sx,y*5+sy,map.seed+89);if(!best||score<best.score)best={x,y,sx,sy,score};}}
   if(!best)continue;const cx=(best.x+.5)*S+best.sx*(S/2-.95),cz=(best.y+.5)*S+best.sy*(S/2-.95);
   elevators.push({lot:id,cx,cz,fx:-best.sx,fz:0,sx:best.sx,sy:best.sy,cell:best.y*W+best.x,floors:L.floors,open:new Float32Array(L.floors)});}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!isH(x,y))continue;
   const L=lotAt(x,y),st=STYLES[L.style],cx=(x+.5)*S,cz=(y+.5)*S,tint=L.paint?{c:L.paint,on:PAINT_ON[L.style]}:null;
   // Un piso por nivel (el de arriba hace de cielo raso del de abajo) y, bajo el techo, el cielo raso del último.
   const fs=S/4; // las piezas de piso y techo miden 4×4 m: se estiran a la casilla
   for(let f=0;f<L.floors;f++)items.push({piece:'Floor_4x4',x:cx,y:f?f*FLOOR:.02,z:cz,sx:fs,sz:fs});
   items.push({piece:'Floor_4x4',x:cx,y:L.h-.03,z:cz,sx:fs,sz:fs},{piece:'Roof_4x4',x:cx,y:L.h+.2,z:cz,sx:fs,sz:fs});
   for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy,nk=at(nx,ny),O=isH(nx,ny)?lotAt(nx,ny):null;
    if(O&&owner[ny*W+nx]===owner[y*W+x]){
     // Entre dos lotes: muro interior en los pisos que comparten (lo pone uno solo de los dos), y pared para los choques.
     const a=lotOf[y*W+x],b=lotOf[ny*W+nx];
     if(a<b){for(let f=0;f<Math.min(L.floors,O.floors);f++)row([['Brick_InteriorWall_3',2]],x,y,dx,dy,f*FLOOR,()=>({}),.2);wallRect(x,y,dx,dy,-HALF,HALF);}
     // Escalón entre lotes de la misma manzana: muro ciego del alto, mirando al bajo, y su cornisa.
     if(O.h<L.h){for(let f=O.floors;f<L.floors;f++)row([st.plain],x,y,dx,dy,f*FLOOR,()=>({tint}),0,[st.plain2,2]);row([[st.cornice,2]],x,y,dx,dy,L.h,()=>({tint}));}
     continue;}
    if(O){ // dos edificios pegados de manzanas distintas: una pared entera, la pone el más alto
     if(O.h>L.h||(O.h===L.h&&ny*W+nx<y*W+x))continue;
     for(let f=0;f<L.floors;f++)row([st.plain],x,y,dx,dy,f*FLOOR,()=>({tint}),0,[st.plain2,2]);wallRect(x,y,dx,dy,-HALF,HALF);continue;}
    // Fachada hacia afuera.
    const toStreet=nk===K.street||nk===K.avenue||nk===K.plaza,door=doorSet.has(`${x},${y},${dx},${dy}`);
    const shop=toStreet&&hash(x,y,map.seed+63)<.6?st.ground[0]:st.ground[1];
    // De noche se enciende un piso entero de un lote (los locales de abajo, casi siempre).
    const lit=(c,i,f)=>hash(lotOf[y*W+x]*7+f,f*3+1,map.seed+67)<(f?.5:.8)?0:-1;
    const bay=bays.get(keyOf(x,y,dx,dy));
    if(bay){ // portón abierto: dos columnas en las puntas, sin pared; el vehículo y el letrero los pone civic3d
     const mx=(x+.5+dx*.5)*S,mz=(y+.5+dy*.5)*S,tx=dy,tz=-dx;for(const s of [-1,1])items.push({piece:st.column,x:mx+tx*s*(HALF-.05),y:0,z:mz+tz*s*(HALF-.05),tint});
     doorFronts.push({x:mx,z:mz,nx:dx,nz:dy,half:HALF});
     wallRect(x,y,dx,dy,-HALF,HALF,2.5);const kindV=CIVIC[bay.type].bay;bay.bay.push({kind:kindV,x:mx,z:mz,ry:Math.atan2(dx,dy),len:kindV==='camion'?6.4:kindV==='patrulla'?4.5:5.2});}
    else if(door){const n=Math.round(S/2),k=Math.floor(hash(x,y,map.seed+61)*n),side=-HALF+1+2*k;row([...Array(n)].map((_,j)=>j===k?[st.door,2]:shop),x,y,dx,dy,0,(c,i)=>({tint,lit:lit(c,i,0)}));
     // El hueco del marco mide 1 a 1,12 m: la pared de choque deja libre ±0,6 m (un poco más que el marco, para no trabarse en la puerta).
     wallRect(x,y,dx,dy,-HALF,side-.6);wallRect(x,y,dx,dy,side+.6,HALF);wallRect(x,y,dx,dy,side-.6,side+.6,2.5); // sobre la puerta (y en los pisos de arriba) es pared
     const tx=dy,tz=-dx,mx=(x+.5+dx*.5)*S,mz=(y+.5+dy*.5)*S;
     doorFronts.push({x:mx+tx*side,z:mz+tz*side,nx:dx,nz:dy,half:1});
     plaques.push({x:mx+tx*side+dx*.08,z:mz+tz*side+dy*.08,ry:Math.atan2(dx,dy),name:L.bname});
     leaves.push({piece:st.leaf,x:mx+tx*(side+.5)-dx*.12,y:0,z:mz+tz*(side+.5)-dy*.12,ry:Math.atan2(dx,dy),cx:mx+tx*side,cz:mz+tz*side});}
    else{row([shop],x,y,dx,dy,0,(c,i)=>({tint,lit:lit(c,i,0)}));wallRect(x,y,dx,dy,-HALF,HALF);}
    const up=st.upper[L.upper],order=up.length>1&&(x+y)%2?[...up].reverse():up;
    for(let f=1;f<L.floors;f++){const bl=blank.has(`${x},${y},${dx},${dy},${f}`);row(bl?[st.plain]:order,x,y,dx,dy,f*FLOOR,(c,i)=>({tint,lit:lit(c,i,f)}),0,bl?[st.plain2,2]:[st.single,2]);}
    row([[st.cornice,2]],x,y,dx,dy,L.h,()=>({tint}));
   }
   // Esquinas hacia afuera: una columna por piso.
   for(const [ex,ey] of [[-1,-1],[1,-1],[-1,1],[1,1]]){if(isH(x+ex,y)||isH(x,y+ey))continue;
    for(let f=0;f<L.floors;f++)items.push({piece:st.column,x:(x+.5+ex*.5)*S,y:f*FLOOR,z:(y+.5+ey*.5)*S,tint});}
  }
  // Las cabinas: paredes de metal, techo con luz y botonera (cajas con instancias), y las puertas corredizas aparte
  // (se abren cuando el jugador está cerca, en ese piso). Para los choques, sus paredes con el hueco de la puerta.
  const cab=[],cabLight=[],E=.85,T=.07,DOOR=.5;
  for(const e of elevators){const ax=Math.abs(e.fx)>0;
   // (la cabina del catálogo de objetos, la misma que la de los edificios con plano: su frente, +z, mira a fx,fz)
   for(let f=0;f<e.floors;f++){const y0=f*FLOOR+.02;for(const q of placeParts(OBJETOS.ascensor.piezas(),{x:e.cx,y:y0,z:e.cz,ry:Math.atan2(e.fx,e.fz||0)}))(q.luz?cabLight:cab).push(q);}
   // Choques (todos los pisos): espalda, costados y el frente menos el vano.
   const r=(x0,z0,x1,z1)=>{for(let cy=Math.floor(Math.min(z0,z1)/S);cy<=Math.floor(Math.max(z0,z1)/S);cy++)for(let cx=Math.floor(Math.min(x0,x1)/S);cx<=Math.floor(Math.max(x0,x1)/S);cx++)addWall(cx,cy,x0,z0,x1,z1);};
   const bx=e.cx-e.fx*E,fxp=e.cx+e.fx*E;r(bx-.05,e.cz-E,bx+.05,e.cz+E);r(e.cx-E,e.cz-E-.05,e.cx+E,e.cz-E+.05);r(e.cx-E,e.cz+E-.05,e.cx+E,e.cz+E+.05);
   r(fxp-.05,e.cz-E,fxp+.05,e.cz-DOOR);r(fxp-.05,e.cz+DOOR,fxp+.05,e.cz+E);}
  if(cab.length){const sm=new THREE.MeshStandardMaterial({roughness:.45,metalness:.12});own.push(sm);instanced(group,base(new THREE.BoxGeometry(1,1,1)),sm,cab);
   // La luz del techo de la cabina: siempre encendida (adentro no llega el sol).
   const lm=new THREE.MeshStandardMaterial({color:'#fff8e8',emissive:'#fff1d6',emissiveIntensity:1.1});own.push(lm);instanced(group,base(new THREE.BoxGeometry(1,1,1)),lm,cabLight,{cast:false});}
  // Puertas corredizas: dos hojas por cabina y piso; se mueven hacia los costados al abrir.
  let doorMesh=null;const doorList=[];for(const e of elevators)for(let f=0;f<e.floors;f++)for(const s2 of [-1,1])doorList.push({e,f,s2});
  if(doorList.length){const dm=new THREE.MeshStandardMaterial({color:'#c3c9cd',roughness:.3,metalness:.2});own.push(dm);doorMesh=new THREE.InstancedMesh(base(new THREE.BoxGeometry(1,1,1)),dm,doorList.length);doorMesh.frustumCulled=false;doorMesh.castShadow=true;group.add(doorMesh);}
  const o3=new THREE.Object3D();
  setElevatorDoors=()=>{if(!doorMesh)return;doorList.forEach((d,i)=>{const a=d.e.open[d.f];o3.position.set(d.e.cx+d.e.fx*(E+.02),d.f*FLOOR+.02,d.e.cz+d.s2*(DOOR/2+a*DOOR*.9));o3.scale.set(.04,2.2,DOOR);o3.updateMatrix();doorMesh.setMatrixAt(i,o3.matrix);});doorMesh.instanceMatrix.needsUpdate=true;};
  setElevatorDoors();
  WORLD_TIMES.lap('cuartos');
  // ---------- Cuartos y muebles ----------
  // Pisos de arriba: cada casilla del lote es un cuarto; entre cuartos, tabique de revoque con un vano de 2 m (y su
  // dintel) donde hace falta para llegar a todos desde el ascensor (y alguno más), o cerrado. El cuarto del ascensor es
  // la sala; los demás, dormitorios y cocina; un lote de una casilla, un estudio. La planta baja es un local abierto.
  // Los muebles van contra las paredes (sin tapar vanos, puertas ni el ascensor) y los grandes no se atraviesan. Se
  // dibujan sólo en los edificios cerca de la cámara (updateInteriors); los choques quedan siempre.
  if(furniture){const FK=.52,hz=HALF,elevOf=new Map(elevators.map(e=>[e.lot,e]));
   const block=(cx,cy,x0,z0,x1,z1,y0,y1)=>addWall(cx,cy,x0,z0,x1,z1,y0,y1);
   for(const [id,cells] of lotCells){const L=lots[id];if(!L.floors)continue;const set=new Set(cells.map(([x,y])=>y*W+x)),E=elevOf.get(id);
    // Vanos entre cuartos: árbol desde la casilla del ascensor (o la primera) y, a veces, uno más.
    const start=E?E.cell:cells[0][1]*W+cells[0][0],open_=new Set(),seen=new Set([start]),q=[start],order=[start];
    for(let h=0;h<q.length;h++){const c=q[h],x=c%W,y=(c-x)/W;for(const [dx,dy] of DIRS){const n=(y+dy)*W+x+dx;if(!set.has(n)||seen.has(n))continue;seen.add(n);q.push(n);order.push(n);open_.add(Math.min(c,n)+':'+Math.max(c,n));}}
    // Todos los tabiques entre cuartos llevan su vano de puerta (con marco): se entra a cada cuarto desde los vecinos.
    for(const c of set){const x=c%W,y=(c-x)/W;for(const [dx,dy] of [[1,0],[0,1]]){const n=(y+dy)*W+x+dx;if(set.has(n))open_.add(c+':'+n);}}
    const types=new Map();order.forEach((c,i)=>types.set(c,cells.length===1?'estudio':c===start&&E?'sala':['dormitorio','cocina','dormitorio','sala','dormitorio','cocina'][(i-(E?1:0))%6]));
    const items_=[],beds_=[],seats_=[],sleeps_=[],who=L.station?'police':L.civic==='hospital'?'doctor':'civil';let lotDesk=false;const deskFloor=L.floors-1;lotFurniture.set(id,{id,who,floors:L.floors,cells:cells.map(([x,y])=>[x*S,y*S,(x+1)*S,(y+1)*S]),items:items_,beds:beds_,seats:seats_,sleeps:sleeps_,x:cells.reduce((a,c)=>a+(c[0]+.5)*S,0)/cells.length,z:cells.reduce((a,c)=>a+(c[1]+.5)*S,0)/cells.length,r:Math.sqrt(cells.length)*S});
    for(const c of set){const x=c%W,y=(c-x)/W,cx=(x+.5)*S,cz=(y+.5)*S;
     // Tabiques hacia los vecinos del mismo lote (de este lado, una sola vez por par), en los pisos de arriba.
     for(const [dx,dy] of [[1,0],[0,1]]){const n=(y+dy)*W+x+dx;if(!set.has(n))continue;const isOpen=open_.has(c+':'+n);
      for(let f=1;f<L.floors;f++){const yb=f*FLOOR;row(isOpen?[['Brick_InteriorWall_3',2],['__',2],['Brick_InteriorWall_3',2]]:[['Brick_InteriorWall_3',2]],x,y,dx,dy,yb,()=>({}),.2);
       if(isOpen){row([['__',2],['Brick_InteriorWall_1',2],['__',2]],x,y,dx,dy,yb+2.05,()=>({}),.2);
        // Marco de madera alrededor del vano: dos jambas y el cabezal.
        const bx2=cx+dx*hz,bz2=cz+dy*hz,tx2=dy,tz2=-dx;for(const s3 of [-1,1])doorFrames.push({x:bx2+tx2*s3*1.02,y:yb,z:bz2+tz2*s3*1.02,sx:Math.abs(dx)?.3:.1,sy:2.08,sz:Math.abs(dx)?.1:.3});
        doorFrames.push({x:bx2,y:yb+2.0,z:bz2,sx:Math.abs(dx)?.3:2.14,sy:.1,sz:Math.abs(dx)?2.14:.3});}
       const bx=cx+dx*hz,bz=cz+dy*hz,tx=dy,tz=-dx,seg_=(a,b2)=>block(x,y,Math.min(bx+tx*a,bx+tx*b2)-Math.abs(dx)*.12,Math.min(bz+tz*a,bz+tz*b2)-Math.abs(dy)*.12,Math.max(bx+tx*a,bx+tx*b2)+Math.abs(dx)*.12,Math.max(bz+tz*a,bz+tz*b2)+Math.abs(dy)*.12,yb-.05,yb+FLOOR-.05);
       if(isOpen){seg_(-hz,-1);seg_(1,hz);}else seg_(-hz,hz);}}
     // Muebles de cada piso. Zonas que se dejan libres: la cabina del ascensor y 1,3 m frente a su puerta, 1,1 m frente a
     // cada vano entre cuartos, la puerta de calle y los portones. Cada mueble se mide entero (ancho y fondo) y no
     // puede pisar esas zonas, salirse del cuarto ni pisar otro mueble.
     for(let f=0;f<L.floors;f++){const yb=f*FLOOR+.06,atDoor=DIRS.some(([dx,dy])=>doorSet.has(keyOf(x,y,dx,dy))),
       type=L.station?(f===0&&atDoor?'recepcion':'oficina'):L.civic==='hospital'?(f===0?(atDoor?'recepcion':'hospital'):'hospital'):L.civic==='biblioteca'?'biblioteca':L.civic==='colegio'?(f===0&&atDoor?'recepcion':'aula'):L.civic?'oficina':f===0?'local':types.get(c);
      if(f===0&&(L.site||L.civic&&!['hospital','biblioteca','colegio'].includes(L.civic)))continue;
      const sideKind=(dx,dy)=>{const n=(y+dy)*W+x+dx;if(set.has(n))return f>0&&open_.has(Math.min(c,n)+':'+Math.max(c,n))?'vano':f>0?'pared':'abierto';
       if(f===0&&bays.has(keyOf(x,y,dx,dy)))return 'porton';if(f===0&&doorSet.has(keyOf(x,y,dx,dy)))return 'puerta';return 'muro';};
      const R=(ax,az,bx2,bz2)=>[Math.min(ax,bx2),Math.min(az,bz2),Math.max(ax,bx2),Math.max(az,bz2)],ko=[],placed=[];
      const edgeRect=(dx,dy,t0,t1,depth)=>{const tx=dy,tz=-dx,ex=cx+dx*hz,ez=cz+dy*hz;return R(ex+tx*t0,ez+tz*t0,ex+tx*t1-dx*depth,ez+tz*t1-dy*depth);};
      if(E&&E.cell===c){const e2=.95;ko.push(R(E.cx-e2,E.cz-e2,E.cx+e2,E.cz+e2),R(E.cx+E.fx*.85,E.cz-.85,E.cx+E.fx*2.2,E.cz+.85));}
      for(const [dx,dy] of DIRS){const sk=sideKind(dx,dy);if(sk==='vano')ko.push(edgeRect(dx,dy,-1.15,1.15,1.15));
       if(sk==='puerta'){const k3=Math.floor(hash(x,y,map.seed+61)*Math.round(S/2)),t=-hz+1+2*k3;ko.push(edgeRect(dx,dy,t-.85,t+.85,1.5));}if(sk==='porton')ko.push(edgeRect(dx,dy,-hz,hz,3.2));}
      const hit=(r2,list)=>list.some(o=>r2[0]<o[2]&&r2[2]>o[0]&&r2[1]<o[3]&&r2[3]>o[1]);
      const inside=r2=>r2[0]>=cx-hz+.15&&r2[2]<=cx+hz-.15&&r2[1]>=cz-hz+.15&&r2[3]<=cz+hz-.15;
      const SC=n=>furniture[n]?.scale||FK;
      const sizeOf=n=>n==='bed'?[1.6,2.15]:(m=>m?[(m.box.max.x-m.box.min.x)*SC(n),(m.box.max.z-m.box.min.z)*SC(n)]:[.6,.6])(furniture[n]);
      const fits=(px,pz,ry,w2,d2)=>{const t=Math.abs(Math.sin(ry))>.5,r2=R(px-(t?d2:w2)/2,pz-(t?w2:d2)/2,px+(t?d2:w2)/2,pz+(t?w2:d2)/2);return inside(r2)&&!hit(r2,ko)&&!hit(r2,placed)?r2:null;};
      // Pone un mueble con el centro de su caja en (px,pz): los modelos no siempre traen el origen al centro.
      const put=(name,px,pz,ry,blockIt=true,yo=0,r2=null)=>{const m=furniture[name];if(!m)return;const sc=SC(name),b=m.box,ox=(b.max.x+b.min.x)/2*sc,oz=(b.max.z+b.min.z)/2*sc,c2=Math.cos(ry),s2=Math.sin(ry);
       items_.push({name,x:px-(ox*c2+oz*s2),y:yb+yo,z:pz-(-ox*s2+oz*c2),ry,s:sc,f});if(r2)placed.push(r2);
       // Toda silla es un asiento para la gente del edificio (indoor3d.js): mira hacia donde mira la silla.
       if(/Chair/.test(name))seats_.push({x:px,y:yb,z:pz,yaw:ry,f,lot:id,who,lift:liftFor((b.max.y-b.min.y)*sc),ap:-.55,by:null});if(!blockIt)return;
       const [w2,d2]=sizeOf(name),t=Math.abs(s2)>.5;block(x,y,px-(t?d2:w2)/2,pz-(t?w2:d2)/2,px+(t?d2:w2)/2,pz+(t?w2:d2)/2,yb,yb+(b.max.y-b.min.y)*sc);};
      // Un lugar contra la pared (lado dx,dy; tercio o=-1,0,1) donde entre el mueble entero.
      const slotFor=(n,os,sides)=>{const [w2,d2]=sizeOf(n);for(const o of os)for(const [dx,dy] of sides){const sk=sideKind(dx,dy);if(sk==='abierto')continue;
        const tx=dy,tz=-dx,px=cx+dx*(hz-.25-d2/2)+tx*o*1.9,pz=cz+dy*(hz-.25-d2/2)+tz*o*1.9,ry=Math.atan2(-dx,-dy),r2=fits(px,pz,ry,w2,d2);if(r2)return {px,pz,ry,dx,dy,o,r2};}return null;};
      const place=(n,os,sides,blockIt=true)=>{const sl=slotFor(n,os,sides);if(sl)put(n,sl.px,sl.pz,sl.ry,blockIt,0,sl.r2);return sl;};
      const sidesR=[...DIRS].sort((a,b2)=>hash(c+a[0]*7,f+a[1]*5,61)-hash(c+b2[0]*7,f+b2[1]*5,61));
      const ceil=n=>put(n,cx+(E&&E.cell===c?-E.sx*1.2:0),cz+(E&&E.cell===c?-E.sy*1.2:0),0,false,FLOOR-.2);
      // Mesa con sillas (y alfombra) en el primer lugar libre de 2,8 m cerca del centro.
      const tableSet=chairs=>{for(const [ox,oz] of [[0,0],...(E&&E.cell===c?[[-E.sx*1.3,-E.sy*1.3]]:[]),[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const tx2=cx+ox,tz2=cz+oz,r2=R(tx2-1.35,tz2-1.35,tx2+1.35,tz2+1.35);
        if(!inside(r2)||hit(r2,ko)||hit(r2,placed))continue;put('Carpet_Round',tx2,tz2,0,false,.01);put('Table_RoundSmall',tx2,tz2,0,true,0,r2);
        [[1,0],[-1,0],[0,1],[0,-1]].slice(0,chairs).forEach(([ax,az],i)=>put(i%2?'Chair_1':'Chair_3',tx2+ax*.85,tz2+az*.85,Math.atan2(-ax,-az),false));return true;}return false;};
      // La cama (armada con cajas): cabecera contra la pared.
      const bed=()=>{const sl=slotFor('bed',[0,-1,1],sidesR);if(!sl)return null;placed.push(sl.r2);const fx=-sl.dx,fz=-sl.dy,bx=sl.px,bz=sl.pz,ry=sl.ry,col=['#c2412d','#3d6f8f','#7b4e7e','#4f7d5a','#d9a23a'][Math.floor(hash(c,f,13)*5)];
       beds_.push({x:bx,y:yb+.15,z:bz,sx:1.55,sy:.3,sz:2.05,ry,color:'#7a5a3a',f},{x:bx,y:yb+.45,z:bz,sx:1.5,sy:.18,sz:1.95,ry,color:col,f},{x:bx-fx*.75,y:yb+.6,z:bz-fz*.75,sx:1.3,sy:.12,sz:.38,ry,color:'#f3efe8',f},{x:bx-fx*1.02,y:yb+.6,z:bz-fz*1.02,sx:1.6,sy:1.2,sz:.08,ry,color:'#6b4e36',f});
       block(x,y,...sl.r2,yb,yb+1);const tx=sl.dy,tz=-sl.dx;
       // Para dormir (indoor3d.js): pies hacia el cuarto, costados a 1,1 m del centro.
       sleeps_.push({x:bx,z:bz,top:yb+.54,yaw:Math.atan2(fx,fz),f,by:null,sides:[{x:bx+tx*1.1,z:bz+tz*1.1},{x:bx-tx*1.1,z:bz-tz*1.1}]});for(const s2 of [-1,1]){const px=bx-fx*.75+tx*s2*1.25,pz=bz-fz*.75+tz*s2*1.25,r2=fits(px,pz,ry,.5,.5);if(r2)put(s2<0?'NightStand_1':'NightStand_2',px,pz,ry,true,0,r2);}return sl;};
      // Con el paquete de oficina: escritorio con silla de oficina, mesa de reuniones con sillas, bibliotecas, armarios,
      // sofás de espera y las camas blancas del hospital.
      // Puesto de trabajo (escritorio con silla): un monitor sobre el escritorio mirando a la silla. (fx,fz): dirección
      // del escritorio a la silla.
      const workplace=(dx2,dz2,fx,fz,sx2,sz2)=>{const m=furniture.Desk;if(!m)return;const top=yb+m.box.max.y*SC('Desk'),ry=Math.atan2(fx,fz),bx=dx2-fx*.12,bz=dz2-fz*.12;
       beds_.push({x:bx,y:top+.01,z:bz,sx:.24,sy:.02,sz:.16,ry,color:'#2a2d30',f},{x:bx-fx*.02,y:top+.08,z:bz-fz*.02,sx:.05,sy:.14,sz:.04,ry,color:'#2a2d30',f},
        {x:bx,y:top+.32,z:bz,sx:.58,sy:.36,sz:.04,ry,color:'#1c1f22',f},{x:bx+fx*.022,y:top+.32,z:bz+fz*.022,sx:.53,sy:.31,sz:.005,ry,color:'#3d78a8',f});
       lotDesk=true;};
      const OF=!!furniture.Desk,deskSet=()=>{const sl=slotFor('Desk',[-1,1,0],sidesR);if(!sl)return false;put('Desk',sl.px,sl.pz,sl.ry,true,0,sl.r2);const fx=-sl.dx,fz=-sl.dy,px=sl.px+fx*.85,pz=sl.pz+fz*.85,r2=fits(px,pz,sl.ry,.65,.65);if(r2){put('OfficeChair',px,pz,sl.ry+Math.PI,false,0,r2);workplace(sl.px,sl.pz,fx,fz,px,pz);}return true;};
      const meeting=()=>{for(const [ox,oz] of [[0,0],...(E&&E.cell===c?[[-E.sx*1.3,-E.sy*1.3]]:[]),[1,0],[-1,0],[0,1],[0,-1]]){const ry=hash(c,f,3)<.5?0:Math.PI/2,px=cx+ox,pz=cz+oz,[tw,td]=sizeOf('Table'),t=Math.abs(Math.sin(ry))>.5;
        const r2=R(px-(t?td:tw)/2-.7,pz-(t?tw:td)/2-.7,px+(t?td:tw)/2+.7,pz+(t?tw:td)/2+.7);if(!inside(r2)||hit(r2,ko)||hit(r2,placed))continue;put('Table',px,pz,ry,true,0,r2);
        const ax=t?[0,1]:[1,0],al=t?[1,0]:[0,1];for(const sgn of [-1,1])for(const k3 of [-.75,0,.75])put('Chair',px+ax[0]*sgn*.95+al[0]*k3,pz+ax[1]*sgn*.95+al[1]*k3,Math.atan2(-ax[0]*sgn,-ax[1]*sgn),false);return true;}return false;};
      // Por la trama (el ladrón del dron trabaja en una computadora), todo edificio tiene al menos un escritorio con
      // computador: si nada lo puso antes, va en el primer cuarto de su último piso donde quepa.
      if(OF&&!lotDesk&&f===deskFloor)deskSet();
      if(OF&&(type==='recepcion'||type==='oficina'||type==='hospital'||type==='biblioteca'||type==='aula')){
       if(type==='recepcion'){for(const [ox,oz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const ry=sidesR[0][0]?Math.PI/2:0,r2=fits(cx+ox,cz+oz,ry,...sizeOf('Desk'));if(r2){put('Desk',cx+ox,cz+oz,ry,true,0,r2);put('OfficeChair',cx+ox-Math.sin(ry)*.8,cz+oz-Math.cos(ry)*.8,ry,false);workplace(cx+ox,cz+oz,-Math.sin(ry),-Math.cos(ry),cx+ox-Math.sin(ry)*.8,cz+oz-Math.cos(ry)*.8);break;}}
        place('Sofa2',[0,-1,1],sidesR)||place('Sofa_individual',[-1,1],sidesR);place('Sofa_individual',[-1,1],sidesR);place('Bookcase',[-1,1],sidesR);place('Houseplant_6',[1,-1],sidesR,false);ceil('Light_Ceiling3');}
       else if(type==='oficina'){deskSet();deskSet();meeting()||deskSet();place('Bookcase_Books',[-1,1,0],sidesR);place('ShortCloset',[-1,1,0],sidesR);place('Houseplant_8',[1,-1],sidesR,false);ceil('Light_Ceiling1');}
       else if(type==='hospital'){let n2=0;for(let k3=0;k3<4;k3++){const sl=slotFor('HospitalBed',[-1,1,0],sidesR);if(!sl)break;put('HospitalBed',sl.px,sl.pz,sl.ry,true,0,sl.r2);n2++;
         const tx=sl.dy,tz=-sl.dx,np=[sl.px+tx*1.05+sl.dx*.7,sl.pz+tz*1.05+sl.dy*.7],r2=fits(np[0],np[1],sl.ry,.6,.5);if(r2)put('NightStand',np[0],np[1],sl.ry,true,0,r2);}
        place('ShortCloset',[-1,1,0],sidesR);place('Houseplant_1',[1,-1],sidesR,false);ceil('Light_Ceiling1');}
       else if(type==='biblioteca'){for(let k3=0;k3<6;k3++)if(!place('Bookcase_Books',[-1,1,0],sidesR))break;meeting();place('Houseplant_8',[1,-1],sidesR,false);ceil('Light_Ceiling3');}
       else{// aula: escritorio del profesor contra una pared y pupitres (escritorio + silla) en dos filas mirando hacia él
        const front=slotFor('Desk',[0],sidesR);if(front){put('Desk',front.px,front.pz,front.ry,true,0,front.r2);const fx=-front.dx,fz=-front.dy,tx=front.dy,tz=-front.dx;
         for(const row3 of [2.1,3.6])for(const col of [-1.25,1.25]){const px=front.px+fx*row3+tx*col,pz=front.pz+fz*row3+tz*col,r2=fits(px,pz,front.ry,...sizeOf('Desk'));if(!r2)continue;put('Desk',px,pz,front.ry+Math.PI,true,0,r2);
          const cp=[px+fx*.7,pz+fz*.7],r3=fits(cp[0],cp[1],front.ry,.55,.55);if(r3){put('Chair',cp[0],cp[1],front.ry+Math.PI,false,0,r3);workplace(px,pz,fx,fz,cp[0],cp[1]);}}}
        place('Bookcase_Books',[-1,1],sidesR);ceil('Light_Ceiling1');}}
      // Comisaría: recepción abajo (mostrador, sillas de espera, archivos) y oficinas arriba (escritorios con silla,
      // mesa de reuniones, archivos). Nada de camas.
      else if(type==='recepcion'||type==='oficina'||type==='hospital'||type==='biblioteca'||type==='aula'){
       const desk=(n,chairN)=>{const sl=slotFor(n,[-1,1,0],sidesR);if(!sl)return;put(n,sl.px,sl.pz,sl.ry,true,0,sl.r2);const fx=-sl.dx,fz=-sl.dy,px=sl.px+fx*.85,pz=sl.pz+fz*.85;
        const r2=fits(px,pz,sl.ry,.6,.6);if(r2)put(chairN,px,pz,sl.ry+Math.PI,false,0,r2);};
       if(type==='recepcion'){for(const [ox,oz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const ry=sidesR[0][0]?Math.PI/2:0,r2=fits(cx+ox,cz+oz,ry,...sizeOf('Drawer_2'));if(r2){put('Drawer_2',cx+ox,cz+oz,ry,true,0,r2);break;}}
        const row2=slotFor('Couch_Small2',[-1,1,0],sidesR);if(row2){const tx=row2.dy,tz=-row2.dx;placed.push(row2.r2);for(const s2 of [-.6,0,.6])put('Chair_1',row2.px+tx*s2,row2.pz+tz*s2,row2.ry,false);}
        place('Shelf_2',[-1,1,0],sidesR);place('Houseplant_6',[1,-1],sidesR,false);place('Houseplant_8',[1,-1,0],sidesR,false);ceil('Light_Ceiling3');}
       else{desk('Drawer_1','Chair_3');desk('Drawer_1','Chair_1');tableSet(4);place('Shelf_2',[-1,1,0],sidesR);place('Houseplant_1',[1,-1],sidesR,false);ceil('Light_Ceiling1');}}
      else if(type==='local'){for(const n of ['Shelf_2','Shelf_2','Shelf_1','Shelf_2'])place(n,[-1,1,0],sidesR);
       for(const [ox,oz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const r2=fits(cx+ox,cz+oz,sidesR[0][0]?Math.PI/2:0,...sizeOf('Drawer_2'));if(r2){put('Drawer_2',cx+ox,cz+oz,sidesR[0][0]?Math.PI/2:0,true,0,r2);break;}}
       place('Houseplant_6',[1,-1],sidesR,false);ceil('Light_Ceiling3');}
      else if(type==='sala'){place('Couch_Medium2',[0],sidesR)||place('Couch_Small2',[-1,1,0],sidesR);place('Shelf_1',[-1,1],sidesR);place('Houseplant_8',[1,-1],sidesR,false);place('Light_Floor3',[-1,1],sidesR,false);tableSet(2);ceil('Light_Ceiling1');}
      else if(type==='cocina'||type==='estudio'){const sl=slotFor('Kitchen_Sink',[-1,1,0],sidesR);
       if(sl){const tx=sl.dy,tz=-sl.dx;let off=-.87;for(const n of ['Kitchen_Fridge','Kitchen_Sink','Kitchen_2Drawers']){const m=furniture[n];if(!m)continue;const [kw,kd]=sizeOf(n),px=sl.px+tx*(off+kw/2),pz=sl.pz+tz*(off+kw/2),r2=fits(px,pz,sl.ry,kw,kd);if(r2)put(n,px,pz,sl.ry,true,0,r2);off+=kw;}}
       place('Trashcan_Small1',[1,-1,0],sidesR,false);place('Houseplant_1',[1,-1],sidesR,false);
       if(type==='estudio')bed();tableSet(type==='cocina'?4:2);ceil('Light_Ceiling3');}
      else{const b=bed();place('Drawer_1',[0,-1,1],sidesR);place('Light_Floor1',[-1,1],sidesR,false);place('Houseplant_7',[1,-1],sidesR,false);
       const r2=fits(cx,cz,b?b.ry:0,...sizeOf('Carpet_1'));if(r2)put('Carpet_1',cx,cz,b?b.ry:0,false,.01);ceil('Light_Ceiling1');}
     }}}}
    if(doorFrames.length){const fm=new THREE.MeshStandardMaterial({color:'#8a6a4a',roughness:.8});own.push(fm);instanced(group,base(new THREE.BoxGeometry(1,1,1)),fm,doorFrames,{cast:false});}
    lotPlaques=plaques;town=buildDowntown(downtown,items,leaves);group.add(town.group);town.debug={doorSet,lotOf,lots,civics,adPlan,elevators,walls,lotFurniture};
  // Lo de cada edificio público: letrero en su tramo de fachada más largo, cruz en la azotea del hospital, bandera del
  // colegio junto a su puerta; y sus puertas pasan a ser lugares que visita la gente.
  for(const c of civics){const L=lots[c.id],best=c.run;
   const e0=best[0],e1=best[best.length-1],mx=((e0.x+e1.x)/2+.5+e0.dx*.5)*S,mz=((e0.y+e1.y)/2+.5+e0.dy*.5)*S,w=Math.min(best.length*S-.8,9);
   // En la azotea, un poco detrás de la cornisa y parado sobre patas; el cine lo lleva en marquesina sobre la entrada.
   c.sign=CIVIC[c.type].marquee?{x:mx+e0.dx*.24,z:mz+e0.dy*.24,ry:Math.atan2(e0.dx,e0.dy),w}
    :{x:mx-e0.dx*.8,z:mz-e0.dy*.8,ry:Math.atan2(e0.dx,e0.dy),w:Math.min(w*1.15,11),roof:L.h};
   if(c.sign.roof)c.sign.y0=Math.max(L.h+1.35,clearance(c.sign.x,c.sign.z,e0.dy,-e0.dx,c.sign.w/2,e0.dx,e0.dy)+.6);
   if(c.type==='hospital'){const [ax,ay]=centerOf(c.id),cell=lotCells.get(c.id).reduce((m,p)=>Math.hypot(p[0]-ax,p[1]-ay)<Math.hypot(m[0]-ax,m[1]-ay)?p:m);c.roof={x:(cell[0]+.5)*S,y:L.h,z:(cell[1]+.5)*S};}
   const doors=[...doorSet].map(k=>k.split(',').map(Number)).filter(([x,y])=>lotOf[y*W+x]===c.id);
   for(const [x,y,dx,dy] of doors)civicFronts.push({x:(x+.5+dx*.9)*S,z:(y+.5+dy*.9)*S});
   // Las puertas de la comisaría: de ahí salen (y ahí vuelven) los policías que patrullan la calle.
   if(c.type==='comisaria'&&stationInfo)stationInfo.doors=doors.map(([x,y,dx,dy])=>({x:(x+.5+dx*.75)*S,z:(y+.5+dy*.75)*S}));
   if(CIVIC[c.type].flag&&doors.length){const [x,y,dx,dy]=doors[0];c.flag={x:(x+.5+dx*.7)*S+dy*1.8,z:(y+.5+dy*.7)*S-dx*1.8};}}
  civ=buildCivic(civics,{vehicle});group.add(civ.group);
  // Los vehículos estorban: su huella entra a los choques (en cada casilla que pisan).
  for(const [ax,az,bx,bz] of civ.blocks)for(let cy=Math.floor(az/S);cy<=Math.floor(bz/S);cy++)for(let cx=Math.floor(ax/S);cx<=Math.floor(bx/S);cx++)addWall(cx,cy,ax,az,bx,bz);
 }

  WORLD_TIMES.lap('veredas');
 // ---------- Veredas: una grilla de cuartos de casilla, pegada a lo construido ----------
 // (el ancho: el del 2D, CALLE.vereda —3 m, NV cuartos—; hasta 2026-10-16 era uno solo, 1 m, y los árboles y faroles del
 // plano, puestos en un andén de 3 m, quedaban sobre el asfalto)
 const NV=Math.max(1,Math.round(CALLE.vereda/SW)),SWW=W*SUB,curb=new Uint8Array(SWW*H*SUB),puntas=[],puntaVista=new Set(),RP=CIRCULACION.vehiculo.esquina;
 const built=(x,y)=>{if(exitOut.has(x+','+y))return false;const k=at(x,y);return isSolid(k)||ROOF.has(k);};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const k=kind[y*W+x];if(k!==K.street&&k!==K.avenue)continue;
  // (andén donde el 2D lo pone: junto a todo lo que no es calle —lo construido, y también plazas, patios, parques y
  // callejones—; la salida del muro, no. Así frente a una plaza el árbol de la vereda queda en el andén y no en el asfalto)
  const lado=(xx,yy)=>{if(exitOut.has(xx+','+yy))return false;const k=at(xx,yy);return k!==K.street&&k!==K.avenue;};
  const L=lado(x-1,y),R=lado(x+1,y),U=lado(x,y-1),D=lado(x,y+1);
  for(let j=0;j<SUB;j++)for(let i=0;i<SUB;i++){
   // (la punta de la manzana en un cruce, 2026-10-16: redondeada como dice el 2D —el cordón con radio
   // CIRCULACION.vehiculo.esquina desde la esquina de la manzana—; cuadrada, los autos que doblaban a la derecha la
   // pisaban. Un cuarto entra si su centro queda a menos de radio − 0,1 de la esquina)
   const pu=(ci,cj)=>Math.hypot((i+.5)*SW-ci*S,(j+.5)*SW-cj*S)<=CIRCULACION.vehiculo.esquina-.1;
   const on=(i<NV&&L)||(i>=SUB-NV&&R)||(j<NV&&U)||(j>=SUB-NV&&D);
   // (2026-10-16, Miguel: «que las esquinas de los andenes se vean curvas»: la punta ya no va en cuadros de 1 m —escalonada—
   // sino como un cuarto de círculo de radio CIRCULACION.vehiculo.esquina con centro en la esquina de la manzana: esos cuartos
   // quedan marcados 2 y se dibujan aparte —puntas—; la física mira la distancia al centro)
   const pq=(ci,cj)=>{const k=x+','+y+','+ci+','+cj;if(!puntaVista.has(k)){puntaVista.add(k);puntas.push({cx:(x+ci)*S,cz:(y+cj)*S,dx:ci?-1:1,dz:cj?-1:1});}return 2;};
   const pt=!on&&((i<NV&&j<NV&&lado(x-1,y-1)&&pq(0,0))||(i>=SUB-NV&&j<NV&&lado(x+1,y-1)&&pq(1,0))||(i<NV&&j>=SUB-NV&&lado(x-1,y+1)&&pq(0,1))||(i>=SUB-NV&&j>=SUB-NV&&lado(x+1,y+1)&&pq(1,1)));
   if(on)curb[(y*SUB+j)*SWW+x*SUB+i]=1;else if(pt)curb[(y*SUB+j)*SWW+x*SUB+i]=2;
  }
 }
 const curbAt=(sx,sy)=>sx>=0&&sy>=0&&sx<SWW&&sy<H*SUB&&curb[sy*SWW+sx]>=1;
 // (en una punta, la vereda es el cuarto de círculo: a ≤ RP del centro, del lado de la manzana)
 const enPunta=(px,pz)=>{for(const p of puntas){const ux=(px-p.cx)*p.dx,uz=(pz-p.cz)*p.dz;if(ux>=0&&uz>=0&&ux<=NV*SW&&uz<=NV*SW)return Math.hypot(ux,uz)<=RP;}return false;};
 for(let sy=0;sy<H*SUB;sy++)for(let sx=0;sx<SWW;sx++){
  if(!curbAt(sx,sy)||curb[sy*SWW+sx]===2)continue;const x0=sx*SW,z0=sy*SW;
  q('sidewalk').flat(x0,z0,x0+SW,z0+SW,CURB,true,{us:1/S});
  for(const [dx,dy] of DIRS){const nx=sx+dx,ny=sy+dy;if(curbAt(nx,ny))continue;const pk=at(Math.floor(nx/SUB),Math.floor(ny/SUB));if(!OPEN.has(pk)&&pk!==K.border)continue;// (también hacia el muro de la ciudad: sin esa cara la vereda se veía flotando 15 cm —validar-empalmes, 2026-10-16—)
   const cx=x0+SW/2+dx*SW/2,cz=z0+SW/2+dy*SW/2;q('sidewalk').wall(cx-dy*SW/2,cz-dx*SW/2,cx+dy*SW/2,cz+dx*SW/2,0,CURB,dx,dy,{us:1/S,vs:1/S});}
 }

  WORLD_TIMES.lap('pintura');
 // ---------- Pintura de la calle: doble amarilla en las avenidas (un carril por sentido) y cebras antes de cada cruce.
 // Las calles angostas son de doble vía (un carril por sentido): línea blanca discontinua al centro.
 // las puntas: un abanico de triángulos a la altura de la vereda y el cordón por el arco (de 0 a CURB, mirando a la calle)
 {const Qs=q('sidewalk'),N=12;for(const p of puntas){const P=k=>{const a=k/N*Math.PI/2;return [p.cx+p.dx*RP*Math.cos(a),p.cz+p.dz*RP*Math.sin(a)];};
   for(let k=0;k<N;k++){const [ax,az]=P(k),[bx,bz]=P(k+1),uv=[p.cx/S,p.cz/S,ax/S,az/S,bx/S,bz/S,bx/S,bz/S];
    // (con la normal hacia arriba)
    const sg=Math.sign((ax-p.cx)*(bz-p.cz)-(az-p.cz)*(bx-p.cx));const A=[p.cx,CURB,p.cz],B=[ax,CURB,az],C=[bx,CURB,bz];if(sg<0)Qs.tri(A,B,C,[0,1,0],uv);else Qs.tri(A,C,B,[0,1,0],uv);
    const mx=(ax+bx)/2-p.cx,mz=(az+bz)/2-p.cz,ml=Math.hypot(mx,mz)||1;Qs.wall(ax,az,bx,bz,0,CURB,mx/ml,mz/ml,{us:1/S,vs:1/S});}}}
 const road=(x,y)=>{const k=at(x,y);return k===K.street||k===K.avenue;};
 const hRun=new Int16Array(W*H),vRun=new Int16Array(W*H);
 for(let y=0;y<H;y++){let x=0;while(x<W){if(!road(x,y)){x++;continue;}let e=x;while(e<W&&road(e,y))e++;for(let i=x;i<e;i++)hRun[y*W+i]=e-x;x=e;}}
 for(let x=0;x<W;x++){let y=0;while(y<H){if(!road(x,y)){y++;continue;}let e=y;while(e<H&&road(x,e))e++;for(let i=y;i<e;i++)vRun[i*W+x]=e-y;y=e;}}
 const junction=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&road(x,y)&&hRun[y*W+x]>2&&vRun[y*W+x]>2;
 const WHITE=[.95,.95,.92],YELLOW=[.95,.78,.25],mk=q('marking'),Y0=.012;
 const strip=(x0,z0,x1,z1,col)=>mk.flat(x0,z0,x1,z1,Y0,true,{col});
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  if(!road(x,y)||junction(x,y))continue;const i=y*W+x,x0=x*S,z0=y*S,cx=x0+S/2,cz=z0+S/2,av=kind[i]===K.avenue;
  const horiz=hRun[i]>2&&vRun[i]<=2,vert=vRun[i]>2&&hRun[i]<=2;
  if(horiz){
   if(av&&at(x,y+1)===K.avenue){const z=z0+S;strip(x0,z-.16,x0+S,z-.05,YELLOW);strip(x0,z+.05,x0+S,z+.16,YELLOW);}
   if(!av&&vRun[i]===1)for(let xx=x0+.4;xx<x0+S-.2;xx+=2)strip(xx,cz-.06,xx+1.1,cz+.06,WHITE);
   const zA=z0+(built(x,y-1)?SW:0),zB=z0+S-(built(x,y+1)?SW:0);
   if(mobiliario)for(const side of [-1,1])if(junction(x+side,y)){const xe=side<0?x0:x0+S,xa=side<0?xe+.25:xe-1.45;for(let z=zA+.15;z+.3<=zB;z+=.6)strip(xa,z,xa+1.2,z+.3,WHITE);}
  }else if(vert){
   if(av&&at(x+1,y)===K.avenue){const xx=x0+S;strip(xx-.16,z0,xx-.05,z0+S,YELLOW);strip(xx+.05,z0,xx+.16,z0+S,YELLOW);}
   if(!av&&hRun[i]===1)for(let zz=z0+.4;zz<z0+S-.2;zz+=2)strip(cx-.06,zz,cx+.06,zz+1.1,WHITE);
   const xA=x0+(built(x-1,y)?SW:0),xB=x0+S-(built(x+1,y)?SW:0);
   if(mobiliario)for(const side of [-1,1])if(junction(x,y+side)){const ze=side<0?z0:z0+S,za=side<0?ze+.25:ze-1.45;for(let xx=xA+.15;xx+.3<=xB;xx+=.6)strip(xx,za,xx+.3,za+1.2,WHITE);}
  }
 }


  WORLD_TIMES.lap('peatones');
 // ---------- Por dónde camina un peatón: veredas, cebras, plazas, patios y callejones (en cuartos de casilla) ----------
 const SH=H*SUB,ped=new Uint8Array(SWW*SH),pedSet=(sx,sy)=>{if(sx>=0&&sy>=0&&sx<SWW&&sy<SH)ped[sy*SWW+sx]=1;};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const k=kind[y*W+x],i=y*W+x;
  if(k===K.plaza||k===K.alley||k===K.courtyard){for(let j=0;j<SUB;j++)for(let ii=0;ii<SUB;ii++)pedSet(x*SUB+ii,y*SUB+j);continue;}
  if(!road(x,y))continue;
  for(let j=0;j<SUB;j++)for(let ii=0;ii<SUB;ii++)if(curbAt(x*SUB+ii,y*SUB+j))pedSet(x*SUB+ii,y*SUB+j);
  if(junction(x,y))continue;
  const horiz=hRun[i]>2&&vRun[i]<=2,vert=vRun[i]>2&&hRun[i]<=2;
  // La cebra: la franja de la casilla pegada al cruce, de vereda a vereda.
  if(horiz)for(const side of [-1,1])if(junction(x+side,y))for(let j=0;j<SUB;j++)pedSet(x*SUB+(side<0?0:SUB-1),y*SUB+j);
  if(vert)for(const side of [-1,1])if(junction(x,y+side))for(let ii=0;ii<SUB;ii++)pedSet(x*SUB+ii,y*SUB+(side<0?0:SUB-1));
 }
 // Los edificios de vivienda también se caminan (puerta, cuartos y pasillos): la gente entra y sale. Los objetivos y la
 // comisaría no.
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=kind[y*W+x];if(k!==K.door&&k!==K.room&&k!==K.hall)continue;
  const b=owner[y*W+x]>=0?blocks[owner[y*W+x]]:null;if(!b||b.site||b.station)continue;for(let j=0;j<SUB;j++)for(let ii=0;ii<SUB;ii++)pedSet(x*SUB+ii,y*SUB+j);}

 // Las escalinatas (planta baja levantada) ocupan la vereda entera: sus casillas se sacan y la gente las rodea por la
 // franja de calle pegada al cordón (un metro más afuera, un metro más a cada lado).
 for(const list of stoopsByCell.values())for(const st of list){const tx=-st.nz,tz=st.nx;
  const cellAt=(sv,tv)=>[Math.floor((st.x+st.nx*sv+tx*tv)/SW),Math.floor((st.z+st.nz*sv+tz*tv)/SW)];
  for(const sv of [.5])for(const tv of [-.5,.5]){const [sx,sy]=cellAt(sv,tv);if(sx>=0&&sy>=0&&sx<SWW&&sy<SH)ped[sy*SWW+sx]=0;}
  for(const tv of [-1.5,-.5,.5,1.5])pedSet(...cellAt(1.5,tv));}

  WORLD_TIMES.lap('toldos');
 // ---------- Toldos sobre algunos locales ----------
 // (con el plan y LOWPOLY no: los toldos son los de cada fachada, town3d.js; éstos caían encima, dobles)
 for(const f of (plan&&LOWPOLY.on?[]:streetFaces)){
  if(f.inf.site||f.inf.station||f.nk===K.plaza||at(f.x+f.dx,f.y+f.dy)===K.kiosk||(f.inf.civic==='mercado'?false:f.inf.civic||hash(f.x,f.y,f.dx*5+f.dy+31)>.24))continue;
  const [ax,az,bx,bz]=f.e,nx=f.dx,nz=f.dy,tx=nz,tz=-nx,D=.95,Y0=2.97+(f.inf.raise||0),Y1=Y0-.42;// arriba de la vidriera (su vidrio llega a 2,94 m)
  const a=[ax+tx*.3,Y0,az+tz*.3],b=[bx-tx*.3,Y0,bz-tz*.3],c=[b[0]+nx*D,Y1,b[2]+nz*D],d=[a[0]+nx*D,Y1,a[2]+nz*D];
  const col=new THREE.Color(['#c2412d','#2e6f5e','#3d6f8f','#d9a23a','#7b4e7e','#4f7d5a'][Math.floor(hash(f.y,f.x,9)*6)]),cc=[col.r,col.g,col.b];
  const u0=(a[0]*tx+a[2]*tz)/2,u1=(b[0]*tx+b[2]*tz)/2;
  q('awning').add(a,d,c,b,[nx*.37,.93,nz*.37],[u0,1,u0,0,u1,0,u1,1],cc);
  q('awning').wall(d[0],d[2],c[0],c[2],Y1-.28,Y1,nx,nz,{us:.5,vs:2,col:cc});
 }

  WORLD_TIMES.lap('letreros');
 // ---------- Letreros de los locales (sin toldo): nombres de barrio, de un solo color, encendidos de noche ----------
 const shops=[];
 for(const f of streetFaces){
  if(f.inf.site||f.inf.station||f.inf.civic||f.nk===K.plaza||hash(f.x,f.y,f.dx*5+f.dy+31)<=.24||hash(f.x,f.y,91)>.42)continue;
  const [ax,az,bx,bz]=f.e;shops.push({x:(ax+bx)/2+f.dx*.05,y:2.58+(f.inf.raise||0),z:(az+bz)/2+f.dy*.05,ry:Math.atan2(f.dx,f.dy),k:Math.floor(hash(f.y,f.x,92)*SHOPS.length)});
 }
 const shopMats=shopMaterials();
 if(!LOWPOLY.on)shopMats.forEach((m,k)=>instanced(group,shopPlane(),m,shops.filter(s=>s.k===k),{cast:false}));

 for(const [key,qq] of Object.entries(Q)){
  const [name,tint]=key.split(':'),mat=tint?M[name==='fac'?'facade':'store'].get(tint):M[name];
  const mesh=qq.mesh(mat,{cast:!['asphalt','paving','court','marking','ceiling','wood','tile','vault'].includes(name)});if(mesh){mesh.name=(['asphalt','paving','grass','court','sidewalk'].includes(name)?'suelo:':'ciudad:')+key;group.add(mesh);}// (el nombre: para medir sin pantalla —validar-triangulos—; «suelo:…» es piso de la calle)
 }

  WORLD_TIMES.lap('mobiliario');
 // ---------- Mobiliario: postes de luz, canecas, hidrantes, bancas, árboles, kioscos ----------
 const colliders=new Map(),addCollider=(x,z,r)=>{const key=Math.floor(z/S)*W+Math.floor(x/S);(colliders.get(key)||colliders.set(key,[]).get(key)).push({x,z,r});};
 // Árboles y arbustos: con el paquete de naturaleza, sus modelos (cuatro árboles y tres arbustos, al azar con la
 // semilla); sin él, tronco y copa armados acá.
 const natTrees=[],natBushes=[],natGrass=[],natRocks=[],CROWNS=['#5f8a4b','#4f7a45','#6f9655','#587f4e','#7a9a4a'];
 const tree=(x,z,sc,ry)=>{if(!arboles)return;if(nature){natTrees.push({x,z,sc,ry});return;}trunks.push({x,z,sy:sc});crowns.push({x,y:2.1*sc,z,sx:sc,sy:sc,sz:sc,ry,color:CROWNS[Math.floor(hash(x*7,z*7,3)*5)]});};
 const bush=(x,z,ry)=>{if(!arboles)return;if(nature){natBushes.push({x,z,ry});return;}crowns.push({x,y:.38,z,sx:.6,sy:.45,sz:.6,ry,color:'#4f7a3f'});};
 const fountain=[],parkPoles=[],globes=[],mupis=[],lamps=[],arms=[],heads=[],pools=[],cans=[],lids=[],hydrants=[],trunks=[],crowns=[],benches=[],kioskBody=[],kioskRoof=[],dumpsters=[],bags=[],panels=[];
 // Nada de mobiliario frente a una puerta: en una franja de 2 m de ancho (el portón entero) y 2,4 m hacia afuera.
 const inDoor=(px,pz,r=.3)=>doorFronts.some(d=>{const ax=px-d.x,az=pz-d.z,out=ax*d.nx+az*d.nz,lat=Math.abs(ax*d.nz-az*d.nx);return out>-.3&&out<2.4+r&&lat<d.half+r;});
 // Nada de mobiliario frente a una puerta: estorbaría la entrada.
 const sides=(x,y)=>[[0,-1],[0,1],[-1,0],[1,0]].filter(([dx,dy])=>built(x+dx,y+dy)&&at(x+dx,y+dy)!==K.door);
 if(mobiliario)for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  if(vacio&&vacio[y*W+x])continue;
  const k=kind[y*W+x],x0=x*S,z0=y*S;
  if((k===K.street||k===K.avenue)&&!junction(x,y)){
   for(const [dx,dy] of sides(x,y)){
    // Punto sobre la vereda, pegado al cordón (a e m de la calle), y la dirección hacia la calle (-dx,-dy). Así entre el
    // mobiliario y la fachada queda paso libre para caminar.
    const along=(t,e=.2)=>dx?[x0+(dx>0?S-SW+e:SW-e),z0+t*S]:[x0+t*S,z0+(dy>0?S-SW+e:SW-e)];
    const seed=hash(x,y,dx*3+dy+map.seed);
    if((x+y+(dx+dy>0?2:0))%4===0){const t=[.5,.15,.85].find(t=>!inDoor(...along(t,.12),.2));if(t===undefined)continue;const [px,pz]=along(t,.12),ry=Math.atan2(-dy,dx);
     lamps.push({x:px,z:pz});arms.push({x:px,y:4.45,z:pz,ry});heads.push({x:px-dx*1.15,y:4.35,z:pz-dy*1.15,ry});pools.push({x:px-dx*1.15,y:.02,z:pz-dy*1.15});addCollider(px,pz,.06);}
    else if(seed<.11&&!inDoor(...along(.2+seed*5,.32),.35)){const [px,pz]=along(.2+seed*5,.32);cans.push({x:px,z:pz,color:seed<.05?'#3f7a4f':'#3d6f8f'});lids.push({x:px,y:.95,z:pz});} // la caneca no frena: se pasa rozándola
    else if(seed<.16&&k===K.avenue&&!inDoor(...along(.5,.16),1.1)){const [px,pz]=along(.5,.16);mupis.push({x:px,z:pz,nx:-dx,nz:-dy,ad:Math.floor(hash(x,y,77)*99)});addCollider(px+dy*.8,pz+dx*.8,.1);addCollider(px-dy*.8,pz-dx*.8,.1);}
    else if(seed>.955&&!inDoor(...along(.75,.2),.2)){const [px,pz]=along(.75,.2);hydrants.push({x:px,z:pz,color:seed>.98?'#d9b43a':'#c2412d'});addCollider(px,pz,.1);}
   }
  }
  if(k===K.plaza&&parkOf[y*W+x]>=0){
   // Parque: faroles y bancas a lo largo de los senderos, árboles y arbustos en el pasto, una fuente al centro.
   const s=hash(x,y,map.seed+11),b=map.parks[parkOf[y*W+x]],mx=Math.floor((b.x0+b.x1)/2),my=Math.floor((b.y0+b.y1)/2),cx=x0+S/2,cz=z0+S/2;
   if(barrio){// jardín: un farol cada tres casillas, y árboles y arbustos (lejos de las fachadas: a 1,8 m del borde de la casilla)
    if(x%3===1&&y%3===1){parkPoles.push({x:cx,z:cz});globes.push({x:cx,y:3.3,z:cz});pools.push({x:cx,y:.02,z:cz,sx:.8,sz:.8});addCollider(cx,cz,.15);}
    else{const lejos=(dx,dy)=>built(x+dx,y+dy)?1.8:.6,ax=x0+lejos(-1,0),bx=x0+S-lejos(1,0),az=z0+lejos(0,-1),bz=z0+S-lejos(0,1);
     for(let t=0;t<2;t++){const h1=hash(x*3+t,y*5,map.seed+41);if(h1>.75)continue;const tx=ax+(bx-ax)*hash(y,x*7+t,1),tz=az+(bz-az)*hash(x*7+t,y,2),sc=.8+.5*hash(x+t,y,3);tree(tx,tz,sc,h1*20);addCollider(tx,tz,.2);}
     if(s>.4)bush(ax+(bx-ax)*s,az+(bz-az)*(1-s),s*9);if(s<.12&&!inDoor(cx,cz,1)){benches.push({x:cx,z:cz,ry:Math.floor(s*40)%4*Math.PI/2});addCollider(cx,cz,.7);}
     if(nature)for(let t=0;t<4;t++)natGrass.push({x:x0+S*hash(x*13+t,y,21),z:z0+S*hash(x,y*13+t,22),ry:t*1.3});}}
   else if(x===mx&&y===my){fountain.push({x:cx,z:cz});addCollider(cx,cz,1.25);}
   else if(pathCell(x,y)){
    if(x%2===0&&y%2===0&&!inDoor(cx,cz)){parkPoles.push({x:cx,z:cz});globes.push({x:cx,y:3.3,z:cz});pools.push({x:cx,y:.02,z:cz,sx:.8,sz:.8});addCollider(cx,cz,.15);}
    else if(s<.3&&!inDoor(cx,cz,1.4)){const along=x===b.x0||x===b.x1||x===mx?0:Math.PI/2,side=s<.15?1:-1;benches.push({x:cx+(along?0:side*1.3),z:cz+(along?side*1.3:0),ry:along+(side<0?Math.PI:0)});addCollider(cx+(along?0:side*1.3),cz+(along?side*1.3:0),.6);}
   }else{
    for(let t=0;t<2;t++){const h1=hash(x*3+t,y*5,map.seed+41);if(h1>.7)continue;const tx=x0+S*(.2+.6*hash(y,x*7+t,1)),tz=z0+S*(.2+.6*hash(x*7+t,y,2)),sc=.85+.6*hash(x+t,y,3);
     tree(tx,tz,sc,h1*20);addCollider(tx,tz,.2);}
    if(s>.55)bush(x0+S*(.25+.5*s),z0+S*(.75-.5*s),s*9);
    // Pasto alto y, de vez en cuando, una piedra (sólo con el paquete de naturaleza).
    if(nature){for(let t=0;t<5;t++)natGrass.push({x:x0+S*hash(x*13+t,y,21),z:z0+S*hash(x,y*13+t,22),ry:t*1.3});if(s<.08)natRocks.push({x:x0+S*(.3+.4*hash(y,x,23)),z:z0+S*(.3+.4*hash(x,y,24)),ry:s*40});}
   }
  }
  else if(k===K.plaza||k===K.courtyard){
   const s=hash(x,y,map.seed+11);
   // Faroles de parque: uno cada dos casillas en las dos direcciones (unos 8 m), con su globo de luz.
   if(x%2===0&&y%2===0&&!inDoor(x0+S/2,z0+S/2)){const px=x0+S/2,pz=z0+S/2;parkPoles.push({x:px,z:pz});globes.push({x:px,y:3.3,z:pz});pools.push({x:px,y:.02,z:pz,sx:.8,sz:.8});addCollider(px,pz,.15);}
   else if(s<(k===K.plaza?.32:.28)&&!inDoor(x0+S*(.3+.4*hash(y,x,1)),z0+S*(.3+.4*hash(x,y,2)),.5)){const tx=x0+S*(.3+.4*hash(y,x,1)),tz=z0+S*(.3+.4*hash(x,y,2)),sc=.8+.5*hash(x,y,3);
    tree(tx,tz,sc,s*20);addCollider(tx,tz,.2);}
   else if(k===K.plaza&&s>.86&&!inDoor(x0+S/2,z0+S/2,1)){const ry=Math.floor(s*40)%4*Math.PI/2;benches.push({x:x0+S/2,z:z0+S/2,ry});addCollider(x0+S/2,z0+S/2,.7);}
  }
  if(k===K.kiosk&&parkOf[y*W+x]>=0){
   // Arboleda: en el juego es un obstáculo (tapa la vista y no se pasa); acá, un grupo apretado de árboles y arbustos.
   for(let t=0;t<4;t++){const tx=x0+S*(.22+.56*hash(x*11+t,y,5)),tz=z0+S*(.22+.56*hash(x,y*11+t,6)),sc=1+.6*hash(x+t*3,y,7);tree(tx,tz,sc,t*1.7);}
   for(let t=0;t<3;t++)bush(x0+S*(.15+.7*hash(t,x,y)),z0+S*(.15+.7*hash(y,t,x)),t);
   addCollider(x0+S/2,z0+S/2,1.9);
  }
  else if(k===K.kiosk){const c=['#c2412d','#3d6f8f','#d9b43a','#4f7d5a'][Math.floor(hash(x,y,4)*4)];kioskBody.push({x:x0+S/2,z:z0+S/2,color:'#e9e2d3'});kioskRoof.push({x:x0+S/2,y:2.35,z:z0+S/2,color:c});addCollider(x0+S/2,z0+S/2,1.05);}
 }
 // Los escondites (contenedores) los pone el motor; si en el 3D uno cae frente a una puerta, se corre a lo largo de la
 // fachada hasta un lugar libre (en el 2D sigue donde estaba).
 for(const h of map.hideouts){let x=h.x*S,z=h.y*S;
  if(inDoor(x,z,.9)){const d=doorFronts.find(d=>{const ax=x-d.x,az=z-d.z;return Math.abs(ax*d.nz-az*d.nx)<d.half+1.2&&ax*d.nx+az*d.nz<3.6;});
   if(d)for(const off of [2.6,-2.6,3.4,-3.4,4.2,-4.2]){const nx=x+d.nz*off,nz=z-d.nx*off;const cx2=Math.floor(nx/S),cy2=Math.floor(nz/S),k2=at(cx2,cy2),wallNear=(walls.get(cy2*W+cx2)||[]).some(([a0,b0,a1,b1])=>nx>a0-.9&&nx<a1+.9&&nz>b0-.9&&nz<b1+.9);
    if(!inDoor(nx,nz,.9)&&OPEN.has(k2)&&!wallNear){x=nx;z=nz;break;}}}
  dumpsters.push({x,z,ry:hash(h.x*S,h.y*S,1)*Math.PI});addCollider(x,z,.9);}
 if(!plan)for(const s of map.sites)for(const l of s.loot||[])bags.push({x:l.x*S,z:l.y*S,ry:hash(l.x*9,l.y*9,2)*3});
 // Los paneles de rescate de la comisaría (los pone el motor, a veces en plena calle): no frenan, para no tapar puertas.
 if(!plan)for(const p of map.station?.rescuePanels||[])panels.push({x:p.x*S,z:p.y*S});

 const mat=(o)=>{const m=new THREE.MeshStandardMaterial({roughness:.7,...o});own.push(m);return m;},geo=g=>{own.push(g);return g;};
 const metal=mat({color:'#3a3f43',metalness:.5,roughness:.5}),headMat=mat({color:'#fdf6e3',emissive:'#ffd9a0',emissiveIntensity:.15});
 // (los faroles de la calle y del parque son del catálogo de objetos: ver más abajo)
 instanced(group,geo(new THREE.BoxGeometry(1,1,1)),mat({roughness:.85}),trims);
 instanced(group,geo(new THREE.BoxGeometry(1,1,1)),mat({roughness:.9}),plinths);
 // El paseo del borde: un farol cada tres casillas.
 if(mobiliario)for(const [x,y] of seawall){
  const out=[[x===0?-1:x===W-1?1:0,0],[0,y===0?-1:y===H-1?1:0]].filter(([a,b])=>a||b);
  if(out.length===1&&(x+y)%3===0&&!inDoor((x+.5)*S,(y+.5)*S)){const px=(x+.5)*S,pz=(y+.5)*S;parkPoles.push({x:px,z:pz});globes.push({x:px,y:3.3,z:pz});pools.push({x:px,y:.03,z:pz,sx:.6,sz:.6});addCollider(px,pz,.15);}
 }
 const poolMesh=instanced(group,geo(new THREE.PlaneGeometry(7,7).rotateX(-Math.PI/2)),M.pool,pools,{cast:false});if(poolMesh){poolMesh.receiveShadow=false;poolMesh.visible=false;}
 instanced(group,geo(base(new THREE.CylinderGeometry(.11,.16,2.3,7))),mat({color:'#6b4e36'}),trunks);
 if(nature){const TREES=[['Tree1',4.1],['Tree2',4.98],['Tree3',4.08],['Tree4',6.85]],TINT=['#ffffff','#e8f2d8','#f4f0d0','#dbe9c8','#fff4dc'];
  TREES.forEach(([n,h],i)=>plantInstances(nature,n,natTrees.filter(t=>Math.floor(hash(t.x*3,t.z*3,9)*4)===i).map(t=>({x:t.x,y:0,z:t.z,ry:t.ry,s:5.2*t.sc/h,tint:TINT[Math.floor(hash(t.z,t.x,4)*5)]})),group));
  ['Bush1','Bush2','Bush3'].forEach((n,i)=>plantInstances(nature,n,natBushes.filter(b=>Math.floor(hash(b.x*5,b.z*5,8)*3)===i).map(b=>({x:b.x,y:0,z:b.z,ry:b.ry,s:1.1})),group));
  ['Grass1','Grass2','Grass3'].forEach((n,i)=>plantInstances(nature,n,natGrass.filter((g,k)=>k%3===i).map(g=>({x:g.x,y:0,z:g.z,ry:g.ry,s:3})),group,{shadow:false}));
  ['Rock1','Rock2','Rock3'].forEach((n,i)=>plantInstances(nature,n,natRocks.filter((r,k)=>k%3===i).map(r=>({x:r.x,y:0,z:r.z,ry:r.ry,s:.45})),group));
  for(const r of natRocks)addCollider(r.x,r.z,.5);}
 instanced(group,geo(new THREE.IcosahedronGeometry(1.25,1)),mat({roughness:.9,flatShading:true}),crowns);
 // Fuente: pileta de piedra, agua, columna y taza.
 // Bancas, papeleras, kioscos y contenedores: los del catálogo de objetos (objetos3d.js), todos en tres InstancedMesh.
 {const street=[],put=(id,list,o=()=>({}))=>{for(const it of list)street.push(...placeParts(OBJETOS[id].piezas(o(it)),{x:it.x,y:it.y||0,z:it.z,ry:it.ry||0}));};
  put('banca',benches);put('papelera',cans,c=>({color:c.color}));put('hidrante',hydrants,h=>({color:h.color}));put('fuente',fountain);put('kiosco',kioskBody.map((k,i)=>({...k,roof:kioskRoof[i]?.color})),k=>({color:k.roof}));put('contenedor',dumpsters);
  if(street.length){const g=partsMesh(street);group.add(g);g.traverse(o=>{if(o.isInstancedMesh)own.push(o);});}
  // Los faroles: lo que brilla va con headMat (de noche se prende). El de la calle mira hacia donde sale su brazo.
  const lights=[];for(const [i,l] of lamps.entries()){const a=arms[i].ry;lights.push(...placeParts(OBJETOS.farol.piezas(),{x:l.x,z:l.z,ry:Math.atan2(-Math.cos(a),Math.sin(a))}));}
  for(const q of parkPoles)lights.push(...placeParts(OBJETOS.farol_parque.piezas(),{x:q.x,z:q.z}));
  if(lights.length){const g=partsMesh(lights,{light:headMat});group.add(g);g.traverse(o=>{if(o.isInstancedMesh){own.push(o);if(o.material===headMat)o.castShadow=false;}});}}
 instanced(group,geo(base(new THREE.DodecahedronGeometry(.28,0))),mat({color:'#d7b23f',roughness:.4,metalness:.3}),bags);
 instanced(group,geo(base(new THREE.BoxGeometry(.4,1.3,.4))),mat({color:'#4f7fa8',emissive:'#2a5d8a',emissiveIntensity:.2}),panels);

 // Letreros sobre la puerta de cada objetivo y de la comisaría.
 const signs=[];
 const sign=(door,text,bg,fg)=>{
  const cx=Math.floor(door.x),cy=Math.floor(door.y),d=DIRS.find(([dx,dy])=>OPEN.has(at(cx+dx,cy+dy)));if(!d)return;
  const tex=signTexture(text,bg,fg),m=new THREE.MeshStandardMaterial({map:tex,emissiveMap:tex,emissive:0x000000,roughness:.5});own.push(tex,m);
  const p=new THREE.Mesh(geo(new THREE.PlaneGeometry(2.6,.65)),m);p.position.set((cx+.5+d[0]*.5)*S+d[0]*.04,CEIL+.5,(cy+.5+d[1]*.5)*S+d[1]*.04);p.rotation.y=Math.atan2(d[0],d[1]);group.add(p);signs.push(m);
 };
 if(!plan){for(const s of map.sites)for(const d of s.doors)sign(d,s.name,'#2f3437','#f1d27a');
 for(const d of map.station?.doors||[])sign(d,'Policía','#2c5f8a','#ffffff');}

  WORLD_TIMES.lap('carteles');
 // ---------- Nombres a la vista: letreros de esquina, placas de los edificios y el cartel de cada parque o plaza ----------
 const names=map.names,texCache=new Map();
 const plateTex=(text,bg,fg)=>{const key=text+bg;if(!texCache.has(key)){const t=signTexture(text,bg,fg);texCache.set(key,t);own.push(t);}return texCache.get(key);};
 const plate=(text,bg,fg,w,h,x,y,z,ry,both=true)=>{const m=new THREE.MeshStandardMaterial({map:plateTex(text,bg,fg),emissiveMap:plateTex(text,bg,fg),emissive:0x000000,roughness:.5});own.push(m);signs.push(m);
  for(const side of both?[0,Math.PI]:[0]){const p=new THREE.Mesh(geo(new THREE.PlaneGeometry(w,h)),m);p.position.set(x+Math.sin(ry+side)*.03,y,z+Math.cos(ry+side)*.03);p.rotation.y=ry+side;group.add(p);}};
 if(names){
  // Esquinas: en cada cruce (un grupo de casillas de cruce), un poste en una esquina de vereda con la calle y la carrera.
  const done=new Set(),poles=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const i=y*W+x;if(done.has(i)||!junction(x,y))continue;
   const q=[i];done.add(i);for(let h=0;h<q.length;h++){const k=q[h],kx=k%W,ky=(k-kx)/W;for(const [dx,dy] of DIRS){const nk=(ky+dy)*W+kx+dx;if(kx+dx>=0&&ky+dy>=0&&kx+dx<W&&ky+dy<H&&!done.has(nk)&&junction(kx+dx,ky+dy)){done.add(nk);q.push(nk);}}}
   const hl=q.map(k=>names.hLine[k]).find(v=>v>=0),vl=q.map(k=>names.vLine[k]).find(v=>v>=0);if(hl===undefined||vl===undefined)continue;
   const xs=q.map(k=>k%W),ys=q.map(k=>Math.floor(k/W)),x0=Math.min(...xs),x1=Math.max(...xs)+1,y0=Math.min(...ys),y1=Math.max(...ys)+1;
   const corner=[[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]].map(([cxx,cyy,ix,iy])=>({sx:cxx*SUB+(ix>0?0:-1),sy:cyy*SUB+(iy>0?0:-1)})).find(c=>curbAt(c.sx,c.sy));
   if(!corner)continue;const px=(corner.sx+.5)*SW,pz=(corner.sy+.5)*SW;if(inDoor(px,pz,.15))continue;poles.push({x:px,z:pz});addCollider(px,pz,.12);
   plate(names.lines[hl].short,'#1f4f8f','#ffffff',1.25,.32,px,3.05,pz,0);plate(names.lines[vl].short,'#1f4f8f','#ffffff',1.25,.32,px,2.65,pz,Math.PI/2);
  }
  instanced(group,geo(base(new THREE.CylinderGeometry(.05,.06,3.3,8))),mat({color:'#3a3f43',metalness:.5,roughness:.5}),poles);
  // Placas: sobre una puerta que dé a la calle (o, si no tiene, en la fachada que da a la calle), con el nombre.
  map.blocks.forEach((b,bi)=>{
   const name=names.blocks[bi],binf=blocks[bi];if(downtown||!name||binf.site||binf.station||/^(Parque|Plaza)/.test(name))return;
   let spot=null;
   for(let y=b.y0;y<=b.y1&&!spot;y++)for(let x=b.x0;x<=b.x1&&!spot;x++)if(kind[y*W+x]===K.door){const d=DIRS.find(([dx,dy])=>OPEN.has(at(x+dx,y+dy)));if(d)spot={x,y,d,h:CEIL+.42};}
   if(!spot){const f=streetFaces.find(f=>f.x>=b.x0&&f.x<=b.x1&&f.y>=b.y0&&f.y<=b.y1);if(f)spot={x:f.x,y:f.y,d:[f.dx,f.dy],h:FLOOR+.45};}
   if(!spot)return;const [dx,dy]=spot.d;plate(name,'#2f3437','#f1e3b5',2.4,.42,(spot.x+.5+dx*.5)*S+dx*.05,spot.h,(spot.y+.5+dy*.5)*S+dy*.05,Math.atan2(dx,dy),false);
  });
  // Parques y plazas: un cartel de madera en el borde que da a una calle.
  map.blocks.forEach((b,bi)=>{const name=names.blocks[bi];if(!/^(Parque|Plaza)/.test(name))return;
   for(let x=b.x0;x<=b.x1;x++)for(const [y,dy] of [[b.y0,-1],[b.y1,1]]){if(!road(x,y+dy))continue;const px=(x+.5)*S,pz=(y+.5+dy*.42)*S;
    plate(name,'#4f6b3a','#f6efd9',2.6,.6,px,1.55,pz,dy>0?0:Math.PI);const legs=[{x:px-1.1,z:pz},{x:px+1.1,z:pz}];instanced(group,geo(base(new THREE.BoxGeometry(.12,1.85,.12))),mat({color:'#6b4e36'}),legs);return;}
  });
 }

  WORLD_TIMES.lap('publicidad');
 // ---------- Publicidad: vallas en fachadas y azoteas, y paneles de calle iluminados ----------
 // Pantallas digitales: cada aviso cambia cada ~8 s (cada pantalla a su ritmo), con un parpadeo corto en negro entre
 // uno y otro. updateAds(t) lo llama la vista en cada cuadro; sólo toca las pantallas que cambian.
 const screens=[],SLOT=8,BLINK=.18;
 const screen=(mesh,ad)=>screens.push({mesh,ad,off:hash(screens.length*7,ad,77)*SLOT,cur:-2});
 function updateAds(t){for(const s2 of screens){const u=t+s2.off,slot=Math.floor(u/SLOT),blink=u-slot*SLOT<BLINK,key=blink?-1:slot;
  if(key===s2.cur)continue;s2.cur=key;s2.mesh.material=blink?blankAd:ADS[(s2.ad+slot)%ADS.length];}}
 const blankAd=new THREE.MeshStandardMaterial({color:'#05070a',emissive:'#0a1626',emissiveIntensity:.6,roughness:.3});own.push(blankAd);
 const ADS=adMaterials(),frameMat=mat({color:'#2a2e31',metalness:.4,roughness:.5});
 // Placas con el nombre del edificio sobre cada puerta (encima del marco, donde la fachada es muro).
 // (los letreros de los locales con giro traen sus colores, su tamaño y cuánto más arriba van: dy)
 // (con LOWPOLY, sin letreros de edificios ni de tiendas —2026-10-16, Miguel—: cada puerta lleva su dirección, plano3d.js)
 if(!LOWPOLY.on)for(const p of lotPlaques)plate(p.name,p.bg||'#2f3437',p.fg||'#f1e3b5',p.w||1.7,p.h||.42,p.x,3.22+(p.dy||0)+(p.y||0),p.z,p.ry,false);
 const panel=(w,h,x,y,z,nx,nz,ad,depth=.14)=>{
  const ry=Math.atan2(nx,nz),f=new THREE.Mesh(geo(new THREE.BoxGeometry(w+.3,h+.3,depth)),frameMat);f.position.set(x-nx*depth/2,y,z-nz*depth/2);f.rotation.y=ry;f.castShadow=true;group.add(f);
  const p=new THREE.Mesh(geo(new THREE.PlaneGeometry(w,h)),ADS[ad%ADS.length]);p.position.set(x+nx*.01,y,z+nz*.01);p.rotation.y=ry;group.add(p);screen(p,ad);
 };
 // El techo de un edificio (con la mansarda y la planta baja levantada).
 const topOf=inf=>(inf.h||0)+(inf.fs?.mansard?MANSARDA.alto:0)+(inf.raise||0);
 // Los avisos de los edificios (planFacadeAds: tramos de dos casillas o más): ya no van pegados a la fachada (tapaban
 // ventanas) sino en la azotea, al frente, sobre dos postes y mirando a la calle.
 const roofBoards=[];
 for(const a of adPlan||planFacadeAds()){const inf=a.run[0].inf,roof=topOf(inf),bottom=roof+1.2,y=bottom+a.h/2,tx=a.dy,tz=-a.dx,ex=a.cx-a.dx*.7,ez=a.cz-a.dy*.7;
  if(roofBoards.some(b=>Math.hypot(b.x-ex,b.z-ez)<6))continue;roofBoards.push({x:ex,z:ez,tx,tz,nx:a.dx,nz:a.dy,roof,bottom});
  panel(a.w,a.h,ex,y,ez,a.dx,a.dy,a.ad,.2);
  for(const s of [-1,1]){const l=new THREE.Mesh(geo(new THREE.CylinderGeometry(.09,.11,bottom-roof+.2,10)),frameMat);l.position.set(ex-a.dx*.4+tx*s*(a.w/2-.5),roof+(bottom-roof+.2)/2,ez-a.dy*.4+tz*s*(a.w/2-.5));l.castShadow=true;group.add(l);}}

 // Una valla de azotea por manzana: la publicidad de toda la cuadra. Va de frente a una avenida o plaza si la manzana
 // da a una, sobre el techo más bajo de ese frente (se ve mejor) y nunca sobre un edificio público.
 const byBlock=new Map();
 for(const f of streetFaces){if(f.inf.site||f.inf.station||f.inf.civic||f.o<0)continue;const b=owner[f.y*W+f.x];if(b<0)continue;(byBlock.get(b)||byBlock.set(b,[]).get(b)).push(f);}
 const wide=f=>f.nk===K.avenue||f.nk===K.plaza?1:0;
 // (con LOWPOLY, ninguna: la publicidad era del estilo de antes)
 for(const list of LOWPOLY.on?[]:byBlock.values()){list.sort((a,c)=>(wide(c)-wide(a))||(a.inf.h-c.inf.h)||(hash(a.x,a.y,57)-hash(c.x,c.y,57)));
  for(const f of list){
    const ex=(f.e[0]+f.e[2])/2-f.dx*1.2,ez=(f.e[1]+f.e[3])/2-f.dy*1.2,roof=topOf(f.inf);
    // Por encima del edificio más alto que haya bajo todo su ancho (si un vecino es más alto, sube sobre tubos largos);
    // si tuviera que subir más de 10 m, esa azotea queda sin valla.
    const bottom=Math.max(roof+1.1,clearance(ex,ez,f.dy,-f.dx,3.5,f.dx,f.dy)+.6);if(bottom>roof+10)continue;
    // Ni encima de la valla de otra manzana: a menos de 8 m se pisarían.
    if(roofBoards.some(b=>Math.hypot(b.x-ex,b.z-ez)<8))continue;
    const y=bottom+1.75,len=y-roof;roofBoards.push({x:ex,z:ez,tx:f.dy,tz:-f.dx,nx:f.dx,nz:f.dy,roof,bottom});
    panel(7,3.5,ex,y,ez,f.dx,f.dy,Math.floor(hash(f.x,f.y,21)*99),.2);
    for(const s of [-1,1]){const l=new THREE.Mesh(geo(new THREE.CylinderGeometry(.09,.11,len,10)),frameMat);l.position.set(ex-f.dx*.4+f.dy*s*2.6,roof+len/2,ez-f.dy*.4-f.dx*s*2.6);l.castShadow=true;group.add(l);}
    // Travesaños entre los tubos (uno cada 2,5 m) para que se vea armado.
    for(let hy=roof+1.2;hy<bottom-.3;hy+=2.5){const b=new THREE.Mesh(geo(new THREE.BoxGeometry(Math.abs(f.dy)*5.2+.1,.1,Math.abs(f.dx)*5.2+.1)),frameMat);b.position.set(ex-f.dx*.4,hy,ez-f.dy*.4);group.add(b);}
   break;}
 }
 // Paneles de calle (mupis) en las veredas de las avenidas: aviso por los dos lados, iluminado de noche.
 for(const m of mupis){
  const ry=Math.atan2(m.nx,m.nz),f=new THREE.Mesh(geo(new THREE.BoxGeometry(2,1.1,.22)),frameMat);f.position.set(m.x,CURB+1.6,m.z);f.rotation.y=ry;f.castShadow=true;group.add(f);
  for(const s of [-1,1]){const l=new THREE.Mesh(geo(new THREE.BoxGeometry(.1,1.05,.1)),frameMat);l.position.set(m.x+m.nz*s*.85,CURB+.52,m.z-m.nx*s*.85);group.add(l);}
  for(const side of [1,-1]){const p=new THREE.Mesh(geo(new THREE.PlaneGeometry(1.8,.9)),ADS[(m.ad+(side<0?5:0))%ADS.length]);screen(p,m.ad+(side<0?5:0));p.position.set(m.x+m.nx*.112*side,CURB+1.6,m.z+m.nz*.112*side);p.rotation.y=ry+(side<0?Math.PI:0);group.add(p);}
 }

  WORLD_TIMES.lap('techos');
 // ---------- Techos: tanques de agua, aires acondicionados y antenas ----------
 const tanks=[],tankBase=[],acs=[],antennas=[];
 for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
  const k=kind[y*W+x];if(OPEN.has(k)||k===K.border||DIRS.some(([dx,dy])=>OPEN.has(at(x+dx,y+dy))))continue;
  const hh=info(x,y).h,r=hash(x,y,map.seed+71),cx=(x+.3+.4*hash(y,x,5))*S,cz=(y+.3+.4*hash(x,y,6))*S;
  if(r<.07){tankBase.push({x:cx,y:hh,z:cz});tanks.push({x:cx,y:hh+.45,z:cz,color:r<.035?'#2b3a4a':'#d9d4c8'});}
  else if(r<.17)acs.push({x:cx,y:hh,z:cz,ry:Math.floor(r*40)*Math.PI/2});
  else if(r<.2)antennas.push({x:cx,y:hh,z:cz});
 }
 instanced(group,geo(base(new THREE.CylinderGeometry(.7,.7,1.3,14))),mat({roughness:.5}),tanks);
 instanced(group,geo(base(new THREE.BoxGeometry(1.3,.45,1.3))),metal,tankBase);
 instanced(group,geo(base(new THREE.BoxGeometry(1.1,.75,.85))),mat({color:'#c9cbc8',roughness:.5,metalness:.3}),acs);
 instanced(group,geo(base(new THREE.CylinderGeometry(.035,.05,3.2,5))),metal,antennas);

  WORLD_TIMES.lap('consultas');
 // ---------- Lo que la vista consulta ----------
 // Fuera de la grilla y el borde no bloquean acá: afuera manda la isla (lo resuelve la vista con island.walkable).
 const solidCell=(cx,cy)=>cx>=0&&cy>=0&&cx<W&&cy<H&&isSolid(kind[cy*W+cx])&&kind[cy*W+cx]!==K.border&&!hollow[cy*W+cx];
 // props=false: sólo paredes (para salir de algo en lo que el jugador quedó metido).
 // feet: la altura de los pies (en los pisos de arriba no cuentan los postes de la calle ni el hueco de la puerta).
 // (h: el alto de lo que se prueba, desde feet; una persona 1 m, la cámara 40 cm)
 function collide(px,pz,r,props=true,feet=0,h=1){
  const xa=Math.floor((px-r)/S),xb=Math.floor((px+r)/S),za=Math.floor((pz-r)/S),zb=Math.floor((pz+r)/S);
  for(let cy=za;cy<=zb;cy++)for(let cx=xa;cx<=xb;cx++){
   if(solidCell(cx,cy)){const nx=Math.max(cx*S,Math.min(px,cx*S+S)),nz=Math.max(cy*S,Math.min(pz,cy*S+S));if((px-nx)**2+(pz-nz)**2<r*r)return true;}
   for(const [ax,az,bx,bz,y0,y1] of walls.get(cy*W+cx)||[]){if(feet>=y1-.3*h||feet+h<=y0)continue;const nx=Math.max(ax,Math.min(px,bx)),nz=Math.max(az,Math.min(pz,bz));if((px-nx)**2+(pz-nz)**2<r*r)return true;}
   if(props&&feet<1)for(const c of colliders.get(cy*W+cx)||[])if((px-c.x)**2+(pz-c.z)**2<(r+c.r)**2)return true;
  }
  return false;
 }
 // Las cortinas que se están corriendo: k de 0 (abierta) a 1 (cerrada) en CORTINA_T s; cada caja, con su ancho a lo largo de la
 // pared por k y su lugar acercado al centro del paño por k (abierta, nada: escala casi cero).
 // (var: ponPanio se usa al armar el mundo, antes de esta línea)
 var CORTINA_T=.5,corriendo=corriendo||new Set(),mpC,vpC,spC;
 function ponPanio(p){if(!mpC){mpC=new THREE.Matrix4();vpC=new THREE.Vector3();spC=new THREE.Vector3();}const k=Math.max(.001,p.k);for(let i=0;i<p.n;i++){const a=p.partes[i];vpC.copy(a.pos);vpC[p.eje]=p.centro[p.eje]+(a.pos[p.eje]-p.centro[p.eje])*k;spC.copy(a.sc);spC[p.eje]*=k;if(p.k<=0)spC.set(0,0,0);mpC.compose(vpC,a.q,spC);const slot=cortinaSlot?cortinaSlot[p.i0+i]:p.i0+i;if(slot>=0)cortinaMesh.setMatrixAt(slot,mpC);}}
 function moverCortinas(dt){if(!corriendo.size||!cortinaMesh)return;for(const p of corriendo){const meta=p.cerrada?1:0;p.k+=Math.sign(meta-p.k)*Math.min(Math.abs(meta-p.k),dt/CORTINA_T);ponPanio(p);if(p.k===meta)corriendo.delete(p);}cortinaMesh.instanceMatrix.needsUpdate=true;}
 const groundAt=(px,pz)=>{const sx=Math.floor(px/SW),sy=Math.floor(pz/SW);if(sx>=0&&sy>=0&&sx<SWW&&sy<H*SUB&&curb[sy*SWW+sx]===2)return enPunta(px,pz)?CURB:0;return curbAt(sx,sy)?CURB:0;};
 // El piso bajo los pies: dentro de un edificio, el más alto de sus pisos que quede a menos de 45 cm por encima de los
 // pies (así no se «sube» un piso caminando: se llega con el ascensor); afuera, la calle o la vereda.
 function floorAt(px,pz,feet){const cx=Math.floor(px/S),cy=Math.floor(pz/S);if(cx<0||cy<0||cx>=W||cy>=H||!hollow[cy*W+cx]){const bl=balconyAt(px,pz,feet);if(bl!=null)return bl;const sp=stoopAt(px,pz);return sp!=null?Math.max(sp,groundAt(px,pz)):groundAt(px,pz);}
  // Con escalera (town3d.js): sobre el hueco de una losa no hay piso, y en los tramos el piso sube con los peldaños.
  // Con la planta baja levantada (escalinata), todo el edificio está R m más arriba.
  const id=lotOf[cy*W+cx],L=lots[id],st=stairsByLot.get(id),R=L.raise||0,fe=feet-R;let g=0;
  // La azotea (se llega en ascensor): el techo plano, o el de arriba de la mansarda.
  // (la mansarda: su pendiente desde cada fachada y la cubierta arriba —techos.js, la misma altura que mide el 2D—)
  const roof=L.h+(L.mansarda?alturaMansarda(L.mansarda,px,pz):0);if(fe>=roof-.45)return roof+R;
  for(let f=L.floors-1;f>0;f--)if(f*FLOOR<=fe+.45&&!(st&&st.inHole(px,pz,f))){g=f*FLOOR;break;}
  // (la planta baja se dibuja 2 cm arriba del suelo, para que no titile con él —town3d yb, piezasSinTitilar—: se pisa ahí.
  // 2026-10-16, medido sin pantalla —validar-pisos—: los pies quedaban 2 cm dentro del piso en toda planta baja)
  if(g===0)g=.02;
  if(st){const h=st.surface(px,pz,fe);if(h!==null&&h>g)g=h;}
  // (encima de un mueble pisable: la mesa, el sofá, el mesón —town3d T.superficies, con la planta baja ya subida—)
  let top=g+R;for(const p of surfByCell.get(cy*W+cx)||[])if(px>p.x0&&px<p.x1&&pz>p.z0&&pz<p.z1&&p.y<=feet+.45&&p.y>top)top=p.y;return top;}
 // El balcón bajo un punto (para quien está a su altura: los de la calle pasan por debajo).
 function balconyAt(px,pz,feet){let best=null;for(const b of balconiesByCell.get(Math.floor(pz/S)*W+Math.floor(px/S))||[]){if(b.y>feet+.45||(best!=null&&b.y<=best))continue;const dx=px-b.x,dz=pz-b.z,s2=dx*b.nx+dz*b.nz,t=Math.abs(-dx*b.nz+dz*b.nx);
   if(s2>=-.05&&s2<=b.d&&t<=b.w/2)best=b.y;}return best!=null&&feet<best+3-.45?best:null;}
 // La escalinata bajo un punto de la vereda: sube de 0 (su borde de afuera, a 1 m) hasta la planta baja (en la fachada).
 function stoopAt(px,pz){for(const st of stoopsByCell.get(Math.floor(pz/S)*W+Math.floor(px/S))||[]){const dx=px-st.x,dz=pz-st.z,s2=dx*st.nx+dz*st.nz,t=Math.abs(-dx*st.nz+dz*st.nx);
   if(s2>=-.05&&s2<=st.d&&t<=st.w/2)return st.h*(1-Math.max(0,s2)/st.d);}return null;}
 // Ascensores: si el punto está dentro de una cabina, cuál es y en qué piso (para la vista: E sube, Q baja).
 // Las paradas: los pisos y la azotea (la última). y(n): la altura de la parada n.
 const stopOf=(e,feet)=>{const f=feet-(e.raise||0);return e.roof!=null&&f>=e.roof-.5?e.floors:Math.min(e.floors-1,Math.round(f/FLOOR));};
 function elevatorAt(px,pz,feet){for(const e of elevators)if(Math.abs(px-e.cx)<.8&&Math.abs(pz-e.cz)<.8){const n=stopOf(e,feet),stops=e.roof!=null?e.floors+1:e.floors;
   return {e,floor:n,floors:stops,raise:e.raise||0,roof:e.roof!=null&&n===e.floors,y:k=>(k<e.floors?k*FLOOR:e.roof)+(e.raise||0)};}return null;}
 // Abre las puertas de la cabina del piso en que está el jugador cuando se acerca (o está adentro).
 function updateElevators(dt,player){let moved=false;for(const e of elevators){const near=(player.x-e.cx)**2+(player.z-e.cz)**2<4.4,pf=stopOf(e,player.feet);
   for(let f=0;f<e.open.length;f++){const t=near&&f===pf?1:0,a=e.open[f];if(a!==t){e.open[f]=t>a?Math.min(1,a+dt*2.2):Math.max(0,a-dt*1.6);moved=true;}}}if(moved)setElevatorDoors();}
 const NAMES={[K.street]:'Calle',[K.avenue]:'Avenida',[K.alley]:'Callejón',[K.plaza]:'Plaza',[K.courtyard]:'Patio',[K.kiosk]:'Avenida'};
 function where(px,pz){
  const cx=Math.floor(px/S),cy=Math.floor(pz/S),k=at(cx,cy),inf=owner[cy*W+cx]>=0?blocks[owner[cy*W+cx]]:null;
  const lo=cx>=0&&cy>=0&&cx<W&&cy<H&&hollow[cy*W+cx]?lots[lotOf[cy*W+cx]]:null;if(lo?.bname||lo?.civicName)return lo.bname||lo.civicName;
  const hide=map.hideouts.find(h=>Math.hypot(h.x-px/S,h.y-pz/S)<1.6);if(hide)return hide.name;
  // Con nombres: la esquina, la calle, o la manzana (parque, plaza, edificio).
  const named=map.names?City.placeName(map,px/S,pz/S):'';
  if(OPEN.has(k))return named||NAMES[k]||'Calle';
  if(inf?.site)return k===K.vault?`Bóveda · ${inf.site.name}`:inf.site.name;
  if(inf?.station)return jail.has(cy*W+cx)?'Celdas · Comisaría':'Comisaría';
  return named||'Casa';
 }
 function setNight(on){
  for(const m of M.facade.values()){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.75:0;}
  for(const m of M.store.values()){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.42:0;}
  for(const m of signs){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.6:0;}
  headMat.emissiveIntensity=on?3:.15;if(poolMesh)poolMesh.visible=on;
  setAdsNight(on);town?.setNight(on);civ?.setNight(on);
  for(const m of shopMaterials()){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.55:0;}
  // De noche el asfalto brilla un poco bajo las luces, como recién lavado.
  M.asphalt.roughness=on?.55:.92;M.sidewalk.roughness=on?.75:.92;
 }

 // Arranca en la salida del primer ladrón, mirando hacia donde la calle sigue más lejos.
 const sp=map.thiefSpawns[0]||{x:1.5,y:1.5},sx=Math.floor(sp.x),sy=Math.floor(sp.y);
 let best=-1,yaw=0;for(const [dx,dy] of DIRS){let n=0;while(!solidCell(sx+dx*(n+1),sy+dy*(n+1))&&n<60)n++;if(n>best){best=n;yaw=Math.atan2(-dx,-dy);}}
 const spawn={x:sp.x*S,z:sp.y*S,yaw};

 function dispose(){group.traverse(o=>{if(o.geometry)o.geometry.dispose();});for(const o of own)o.dispose?.();town?.dispose();civ?.dispose();}
 // Frentes que la gente visita, como en el motor: puertas de objetivos y de la comisaría, y escondites.
 const fronts=(plan?map.hideouts:[...map.sites.flatMap(s=>s.doors),...(map.station?.doors||[]),...map.hideouts]).map(p=>({x:p.x*S,z:p.y*S})).concat(civicFronts);
 // Muebles sólo cerca de la cámara: cada ~0,4 s se miran los edificios a menos de 45 m y, si cambió el grupo, se
 // rearman las instancias (una malla por modelo y pieza, más las cajas de las camas).
 const interior=new THREE.Group();group.add(interior);let activeKey='',clock=0;const bedMat=new THREE.MeshStandardMaterial({roughness:.85});own.push(bedMat);
 // La ronda (2026-10-17): lo robado no se dibuja (oculto(it, lote) → true) y las puertas trancadas no se abren solas
 // (trancada(x, z, y) → true). El 3D las fija con setOcultos / setTrancadas; refrescarInteriores rearma lo de adentro.
 let ocultoFn=null,trancadaFn=null;
 function updateInteriors(px,pz,dt=.016,py=1.7){if(!furniture||!lotFurniture.size)return;if((clock-=dt)>0)return;clock=.4;
  // Los edificios a menos de 15 m de la cámara, y sólo los pisos cerca de su altura (el de la cámara y los vecinos).
  const cf=Math.floor(Math.max(0,py-.5)/FLOOR),act=[...lotFurniture].filter(([id,L])=>Math.hypot(L.x-px,L.z-pz)<15+L.r).map(([id])=>id),key=act.join(',')+'|'+cf;if(key===activeKey)return;activeKey=key;
  const near=it=>Math.abs(it.f-cf)<=1;
  for(const m of [...interior.children]){interior.remove(m);m.dispose?.();}
  const by={};const beds=[],glass=[];for(const id of act){const L=lotFurniture.get(id);for(const it of L.items)if(near(it)&&!(ocultoFn&&ocultoFn(it,id)))(by[it.name]||(by[it.name]=[])).push(it);beds.push(...L.beds.filter(near));glass.push(...(L.glass||[]).filter(near));}
  for(const [n,list] of Object.entries(by))plantInstances(furniture,n,list,interior,{shadow:false});
  if(beds.length)instanced(interior,bedBox,bedMat,beds,{cast:false});
  if(glass.length){const g=instanced(interior,bedBox,glassMat,glass,{cast:false});g.renderOrder=2;}
  // Las hojas de las puertas de los cuartos (town3d innerLeaves): una instancia por puerta, por estilo; se mueven en
  // updateDoors.
  activeLeaves.length=0;const byStyle={};for(const id of act){const L=lotFurniture.get(id);for(const lf of L.leaves||[])if(near(lf))(byStyle[lf.style]||(byStyle[lf.style]=[])).push(lf);}
  for(const [st,list] of Object.entries(byStyle)){const M=leafModel(st),im=new THREE.InstancedMesh(M.parts[0].geometry,M.parts[0].materials,list.length);im.castShadow=false;im.receiveShadow=true;im.frustumCulled=false;
   list.forEach((lf,j)=>{activeLeaves.push({lf,im,j,M});setLeaf(im,j,lf,M);});im.instanceMatrix.needsUpdate=true;interior.add(im);}}
 // La hoja: la bisagra en (x, z), girada th0 (cerrada, a lo largo del vano) más sgn·a·85° (abierta, hacia el cuarto).
 const leafModels={},leafModel=st=>leafModels[st]||(leafModels[st]=kitModel('puerta',{variante:st})),activeLeaves=[];
 const lm4=new THREE.Matrix4(),lq=new THREE.Quaternion(),lp=new THREE.Vector3(),ls=new THREE.Vector3(),lY=new THREE.Vector3(0,1,0),lOff=new THREE.Matrix4();
 function setLeaf(im,j,lf,M){const b=M.box;lOff.makeTranslation(-b.min.x,-b.min.y,-(b.min.z+b.max.z)/2);
  lm4.compose(lp.set(lf.x,lf.y,lf.z),lq.setFromAxisAngle(lY,lf.th0+lf.sgn*lf.a*1.48),ls.set(lf.w/(b.max.x-b.min.x),lf.h/(b.max.y-b.min.y),.5)).multiply(lOff);im.setMatrixAt(j,lm4);}
 // Se abren con alguien a menos de 1,6 m del vano (en ese piso) y se cierran solas.
 function updateLeaves(dt,people){const moved=new Set();for(const o of activeLeaves){const lf=o.lf;if(lf.fija)continue;// (las que el plano deja abiertas no se mueven)
   const near=!(trancadaFn&&trancadaFn(lf.cx,lf.cz,lf.cy))&&people.some(p=>(p.x-lf.cx)**2+(p.z-lf.cz)**2<2.6&&((p.feet??p.y)==null||Math.abs((p.feet??p.y)-lf.cy)<1.6)),a=near?Math.min(1,lf.a+dt*2.5):Math.max(0,lf.a-dt*1.2);
   if(a!==lf.a){lf.a=a;setLeaf(o.im,o.j,lf,o.M);moved.add(o.im);}}for(const im of moved)im.instanceMatrix.needsUpdate=true;}
 const glassMat=new THREE.MeshStandardMaterial({color:'#bcd6e2',transparent:true,opacity:.28,roughness:.05,metalness:.1,depthWrite:false});own.push(glassMat);
 const bedBox=base(new THREE.BoxGeometry(1,1,1));own.push(bedBox);
 WORLD_TIMES.lap("fin");
 return {group,doorFronts,station:stationInfo,updateAds,updateInteriors,lots:lotFurniture,
  // Las bancas de parques y plazas: dos puestos por banca, para la gente de la calle (se sientan mirando hacia ry).
  setOcultos:fn=>{ocultoFn=fn;activeKey=null;clock=0;},setTrancadas:fn=>{trancadaFn=fn;},refrescarInteriores:()=>{activeKey=null;clock=0;},get lotFurniture(){return lotFurniture;},
  benchSeats:benches.flatMap(b=>[-.42,.42].map(o=>({x:b.x+Math.cos(b.ry||0)*o,y:0,z:b.z-Math.sin(b.ry||0)*o,yaw:b.ry||0,lift:.24,ap:.45,by:null}))),roofBoards,clearance,floorAt,curbAt:(x,z)=>curbAt(Math.floor(x/SW),Math.floor(z/SW)),kindAt:(x,z)=>at(Math.floor(x/S),Math.floor(z/S)),elevatorAt,updateElevators,buildings:town,updateDoors:(dt,people)=>{town?.updateDoors(dt,people);updateLeaves(dt,people);moverCortinas(dt);},spawn,collide,groundAt,where,setNight,dispose,size:{w:W*S,h:H*S},ped:{W:SWW,H:SH,size:SW,cells:ped},fronts,
  lights:[...heads.map(h=>({x:h.x,y:h.y-.15,z:h.z})),...globes.map(g=>({x:g.x,y:g.y-.3,z:g.z}))],roads:{W,H,at,road,junction,hRun,vRun,K,exits},
  // Si un punto está adentro de un edificio (en una casilla de lote hueco y por debajo de su techo): el demo prende ahí los
  // contornos de las paredes interiores, que desde afuera no se ven.
  // La losa sólida que hay en (x, z) entre las alturas y0 e y1 (o null): los pisos de cada nivel, la planta baja y el
  // techo, menos el hueco de la escalera. Para la cámara de tercera persona, que no debe pasar de un piso a otro
  // (2026-10-15). Cada losa ocupa de Y−.2 a Y+.1 (con lo que la cámara necesita para no recortarla con su plano cercano).
  slabAt:(x,z,y0,y1)=>{const cx=Math.floor(x/S),cy=Math.floor(z/S);if(cx<0||cy<0||cx>=W||cy>=H||!hollow[cy*W+cx])return null;const id=lotOf[cy*W+cx];if(id<0)return null;
   const L=lots[id],R=L.raise||0,st=stairsByLot.get(id),lo=Math.min(y0,y1),hi=Math.max(y0,y1);
   for(let k=0;k<=L.floors;k++){const Y=R+(k<L.floors?k*FLOOR:L.h);if(Y+.1<lo||Y-.2>hi)continue;if(k>0&&k<L.floors&&st?.inHole(x,z,k))continue;return Y;}
   // (y los tramos de la escalera: el de arriba se ve por debajo)
   if(st)for(const [y0,y1] of st.solids(x,z))if(R+y0-.1<hi&&R+y1+.1>lo)return R+y0;return null;},
  // Las cortinas (las acciones, 2026-10-16): ¿está cerrada la de la ventana key (lote:piso:ventana)? y cerrarla o abrirla.
  // (las cortinas de los lotes que se ven —set, como downtown3d setVisibles; null: todas—)
  setVisiblesCortinas(set){if(!cortinaMesh||set===cortinasVisibles)return;cortinasVisibles=set;const A=cortinaMesh.instanceMatrix.array,n=cortinaLote.length;
   // (las que se ven, juntas al principio, y count: las demás no se mandan a dibujar; cortinaSlot: dónde quedó cada una, o −1)
   let k=0;for(let i=0;i<n;i++){if(set&&!set.has(cortinaLote[i])){cortinaSlot[i]=-1;continue;}cortinaSlot[i]=k;for(let j=0;j<16;j++)A[k*16+j]=cortinaOrig[i*16+j];k++;}
   cortinaMesh.count=k;for(const p of new Set(panioDe.filter(Boolean)))if(cortinaSlot[p.i0]>=0)ponPanio(p);cortinaMesh.instanceMatrix.needsUpdate=true;},
  cortinaCerrada:key=>!!panios.get(key)?.cerrada,cortinaK:key=>panios.get(key)?.k,
  cortina:(key,cerrar)=>{const p=panios.get(key);if(!p||!cortinaMesh)return false;p.cerrada=cerrar??!p.cerrada;(corriendo||(corriendo=new Set())).add(p);return p.cerrada;},
  // El techo sobre (x, z) por encima de la altura y: lo más bajo que haya arriba —la losa del piso siguiente (menos el hueco
  // de la escalera) o un tramo de escalera—, o null. Para la cámara de tercera persona, que se queda debajo en vez de
  // chocar y acercarse de un salto (2026-10-16).
  techoEn:(x,z,y)=>{const cx=Math.floor(x/S),cy=Math.floor(z/S);if(cx<0||cy<0||cx>=W||cy>=H||!hollow[cy*W+cx])return null;const id=lotOf[cy*W+cx];if(id<0)return null;
   const L=lots[id],R=L.raise||0,st=stairsByLot.get(id);let t=null;
   for(let k=1;k<=L.floors;k++){const Y=R+(k<L.floors?k*FLOOR:L.h)-.2;if(Y<=y)continue;if(k<L.floors&&st?.inHole(x,z,k))continue;t=Y;break;}
   if(st)for(const [y0] of st.solids(x,z)){const Y=R+y0;if(Y>y&&(t==null||Y<t))t=Y;}return t;},
  // El lote (edificio hueco) de un punto, o −1.
  lotAt:(x,z)=>{const cx=Math.floor(x/S),cy=Math.floor(z/S);if(cx<0||cy<0||cx>=W||cy>=H||!hollow[cy*W+cx])return -1;return lotOf[cy*W+cx];},
  dentro:(x,z,y)=>{const cx=Math.floor(x/S),cy=Math.floor(z/S);if(cx<0||cy<0||cx>=W||cy>=H)return false;const o=lotOf[cy*W+cx];return o>=0&&!!hollow[cy*W+cx]&&y<(lots[o].h||0)+(lots[o].raise||0)+1;}};
}

/* Publicidad de la ciudad de /demo: avisos dibujados en canvas, de marcas inventadas (algunas guiñan al juego).
   Se dibujan una sola vez y se comparten entre vallas, paneles de calle y buses. De noche se encienden. */
import * as THREE from 'three';

const FONT='-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
function fit(g,text,max,size,weight=800){let s=size;do{g.font=`${weight} ${s}px ${FONT}`;s-=2;}while(g.measureText(text).width>max&&s>10);}

// Cada aviso: fondo, figura, marca y lema. Todos en 1024×512 (proporción 2:1).
const ADS=[
 {brand:'Arepas Doña Rosa',slogan:'¡Calienticas, como siempre!',bg:['#f6a623','#e2641b'],fg:'#fff8e6',accent:'#7a2e0e',shape:'sun'},
 {brand:'Seguros Candado',slogan:'Proteja su bóveda. Duerma tranquilo.',bg:['#14284b','#0b1730'],fg:'#f3d27a',accent:'#f3d27a',shape:'lock'},
 {brand:'Café Montaña',slogan:'Despierta la ciudad',bg:['#5b3a29','#2e1c13'],fg:'#f5e6d0',accent:'#c9894f',shape:'cup'},
 {brand:'Tenis Rayo',slogan:'Corre más. Mucho más.',bg:['#e3342f','#9b1c1c'],fg:'#ffffff',accent:'#ffe066',shape:'bolt'},
 {brand:'Cerrajería El Gato',slogan:'Abrimos todo · 24 horas',bg:['#2f3437','#16191b'],fg:'#ffd23f',accent:'#ffd23f',shape:'key'},
 {brand:'Burbuja',slogan:'La gaseosa que hace ¡pop!',bg:['#13b5b1','#0b6f8c'],fg:'#ffffff',accent:'#ff6fae',shape:'bubbles'},
 {brand:'Pizza Volcán',slogan:'Explota de queso',bg:['#ffcf3f','#f08a24'],fg:'#7a1f0e',accent:'#c0392b',shape:'slice'},
 {brand:'Radio Fuga 99.9',slogan:'La que suena en toda la ciudad',bg:['#6d3bd1','#2b1670'],fg:'#ffffff',accent:'#3ef0c8',shape:'waves'},
 {brand:'Cine Estrella',slogan:'Estreno: «El gran golpe»',bg:['#111111','#3a0d12'],fg:'#f7e7b4',accent:'#e0b04f',shape:'star'},
 {brand:'Gimnasio Titán',slogan:'Fuerza para lo que venga',bg:['#1d1d1d','#3a3a3a'],fg:'#ff5a1f',accent:'#ffffff',shape:'bar'},
 {brand:'Helados Polito',slogan:'Frío que alegra',bg:['#ffd6e7','#a8e6ff'],fg:'#2c3e8f',accent:'#ff5d8f',shape:'cone'},
 {brand:'Mudanzas Ya',slogan:'Lo llevamos sin que nadie se entere',bg:['#2e7d4f','#174a2e'],fg:'#ffffff',accent:'#bfe8a8',shape:'box'},
];

function shape(g,kind,x,y,s,color){
 g.save();g.translate(x,y);g.fillStyle=color;g.strokeStyle=color;g.lineWidth=s*.09;g.lineCap='round';g.lineJoin='round';
 const P=(pts)=>{g.beginPath();pts.forEach(([a,b],i)=>i?g.lineTo(a*s,b*s):g.moveTo(a*s,b*s));g.closePath();g.fill();};
 switch(kind){
  case 'sun':g.beginPath();g.arc(0,0,s*.32,0,7);g.fill();for(let i=0;i<12;i++){const a=i*Math.PI/6;g.beginPath();g.moveTo(Math.cos(a)*s*.42,Math.sin(a)*s*.42);g.lineTo(Math.cos(a)*s*.58,Math.sin(a)*s*.58);g.stroke();}break;
  case 'lock':g.lineWidth=s*.11;g.beginPath();g.arc(0,-s*.12,s*.22,Math.PI,0);g.stroke();g.fillRect(-s*.34,-s*.12,s*.68,s*.52);g.fillStyle='rgba(0,0,0,.45)';g.beginPath();g.arc(0,s*.1,s*.07,0,7);g.fill();break;
  case 'cup':g.fillRect(-s*.3,-s*.1,s*.5,s*.45);g.lineWidth=s*.08;g.beginPath();g.arc(s*.24,s*.1,s*.13,-Math.PI/2,Math.PI/2);g.stroke();for(const d of [-.15,0,.15]){g.beginPath();g.moveTo(d*s-s*.05,-s*.2);g.quadraticCurveTo(d*s+s*.05,-s*.32,d*s-s*.05,-s*.45);g.stroke();}break;
  case 'bolt':P([[.1,-.5],[-.25,.05],[0,.05],[-.1,.5],[.28,-.1],[.03,-.1]]);break;
  case 'key':g.lineWidth=s*.1;g.beginPath();g.arc(-s*.22,0,s*.17,0,7);g.stroke();g.fillRect(-s*.06,-s*.05,s*.5,s*.1);g.fillRect(s*.28,0,s*.08,s*.17);g.fillRect(s*.14,0,s*.08,s*.12);break;
  case 'bubbles':for(const [a,b,r] of [[-.2,.15,.2],[.15,-.1,.15],[.05,.3,.09],[-.15,-.32,.1],[.3,.22,.07]]){g.beginPath();g.arc(a*s,b*s,r*s,0,7);g.stroke();}break;
  case 'slice':P([[-.38,-.3],[.38,-.3],[0,.45]]);g.fillStyle='rgba(192,57,43,.9)';for(const [a,b] of [[-.12,-.12],[.13,-.08],[0,.15]]){g.beginPath();g.arc(a*s,b*s,s*.07,0,7);g.fill();}break;
  case 'waves':for(let i=1;i<=3;i++){g.beginPath();g.arc(-s*.2,0,s*.15*i,-.8,.8);g.stroke();}g.beginPath();g.arc(-s*.2,0,s*.06,0,7);g.fill();break;
  case 'star':g.beginPath();for(let i=0;i<10;i++){const r=i%2?s*.18:s*.42,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();g.fill();break;
  case 'bar':g.fillRect(-s*.42,-s*.04,s*.84,s*.08);for(const d of [-1,1]){g.fillRect(d*s*.3-s*.05,-s*.2,s*.1,s*.4);g.fillRect(d*s*.42-s*.04,-s*.14,s*.08,s*.28);}break;
  case 'cone':P([[-.2,-.05],[.2,-.05],[0,.48]]);g.fillStyle='#ff5d8f';g.beginPath();g.arc(0,-.12*s,s*.22,0,7);g.fill();break;
  case 'box':g.fillRect(-s*.35,-s*.2,s*.7,s*.5);g.fillStyle='rgba(0,0,0,.3)';g.fillRect(-s*.35,-s*.2,s*.7,s*.08);g.fillRect(-s*.04,-s*.2,s*.08,s*.5);break;
 }
 g.restore();
}

function draw(ad){
 const c=document.createElement('canvas');c.width=1024;c.height=512;const g=c.getContext('2d');
 const gr=g.createLinearGradient(0,0,1024,512);gr.addColorStop(0,ad.bg[0]);gr.addColorStop(1,ad.bg[1]);g.fillStyle=gr;g.fillRect(0,0,1024,512);
 g.globalAlpha=.12;g.fillStyle=ad.accent;for(let i=-4;i<12;i++){g.beginPath();g.moveTo(i*110,0);g.lineTo(i*110+60,0);g.lineTo(i*110-140,512);g.lineTo(i*110-200,512);g.fill();}g.globalAlpha=1;
 g.fillStyle='rgba(255,255,255,.12)';g.beginPath();g.arc(830,256,210,0,7);g.fill();
 shape(g,ad.shape,830,256,330,ad.accent);
 g.fillStyle=ad.fg;g.textBaseline='alphabetic';fit(g,ad.brand,600,108);g.fillText(ad.brand,60,230);
 g.fillStyle=ad.fg;g.globalAlpha=.88;fit(g,ad.slogan,600,46,600);g.fillText(ad.slogan,62,310);g.globalAlpha=1;
 g.fillStyle=ad.accent;g.fillRect(62,350,140,10);
 g.fillStyle=ad.fg;g.globalAlpha=.6;g.font=`600 26px ${FONT}`;g.fillText('www.'+ad.brand.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'')+'.co',62,430);g.globalAlpha=1;
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}

let cache=null;
// Un material por aviso: de día es un cartel; de noche, una pantalla encendida (emissive).
export function adMaterials(){
 if(cache)return cache;
 cache=ADS.map(ad=>{const t=draw(ad);return new THREE.MeshStandardMaterial({map:t,emissiveMap:t,emissive:0x000000,roughness:.45});});
 return cache;
}
export function setAdsNight(on){for(const m of adMaterials()){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.7:0;}}

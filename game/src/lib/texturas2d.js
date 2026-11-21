// LAS TEXTURAS DEL PLANO (2026-11-21, Miguel: «hagamos paquetes de textura, así sean muy simples, para fachadas y
// techos; eso no en el lado 3D sino en cómo se ven las fachadas»). Cada textura es una baldosa chica que se repite, dibujada
// acá mismo —sin imágenes— y TRANSPARENTE: sólo las juntas, las sombras y los brillos. Así va encima del color que ya
// decide el plano para cada edificio (la regla 60-30-10 no se toca) y sirve para cualquier pintura.
//
// Todo va en METROS: una baldosa dice cuánto mide (un ladrillo de 50 × 20 cm, un sillar de 90 × 45) y `textura()` la
// escala a los píxeles por metro con que se esté dibujando, así el ladrillo mide lo mismo en el alzado chico, en el
// ampliado y, cuando llegue, en el 3D: las mismas baldosas se pueden hornear a una imagen (ver `baldosa()`).
//
// Un PAQUETE dice qué textura lleva cada cosa: el muro según la familia del edificio (ladrillo, piedra, metal), el zócalo,
// la mansarda y la losa. Agregar uno es agregar un renglón a PAQUETES; agregar una textura, una función a TEXTURAS.
const PPM=120;// píxeles por metro con que se dibuja cada baldosa (después se escala)
const azar=(i,j,k=0)=>{const v=Math.sin(i*127.1+j*311.7+k*74.7)*43758.5453;return v-Math.floor(v);};
const JUNTA='rgba(255,255,255,.26)',SOMBRA='rgba(0,0,0,.16)',LUZ='rgba(255,255,255,.10)';

// Cada una: {w, h} en metros y cómo se pinta su baldosa (g ya viene en píxeles de la baldosa: W × H).
export const TEXTURAS={
 // el ladrillo a soga: hiladas de 20 cm, cada una corrida media pieza; algunos ladrillos más oscuros o más claros
 ladrillo:{w:1,h:.4,nombre:'Ladrillo a soga',pinta(g,W,H){const bw=W/2,bh=H/2,j=Math.max(2,PPM*.022);
  for(let f=0;f<2;f++)for(let c=-1;c<3;c++){const x=c*bw+(f?bw/2:0),y=f*bh,t=azar(c+7,f,1);g.fillStyle=t<.3?`rgba(0,0,0,${.05+t*.2})`:t>.8?`rgba(255,255,255,${(t-.8)*.4})`:'rgba(0,0,0,0)';g.fillRect(x,y,bw,bh);}
  g.fillStyle=JUNTA;for(let f=0;f<2;f++){g.fillRect(0,f*bh,W,j);for(let c=-1;c<3;c++)g.fillRect(c*bw+(f?bw/2:0),f*bh,j,bh);}
  g.fillStyle=SOMBRA;for(let f=0;f<2;f++)g.fillRect(0,f*bh+bh-j*.6,W,j*.6);}},
 // el sillar: piedras de 90 × 45 cm con la junta hundida y un filo de luz arriba
 sillar:{w:.9,h:.9,nombre:'Sillar de piedra',pinta(g,W,H){const bh=H/2,j=Math.max(2,PPM*.02);
  for(let f=0;f<2;f++)for(let c=-1;c<2;c++){const x=c*W+(f?W/2:0),t=azar(c+3,f,2);g.fillStyle=`rgba(${t<.5?'0,0,0':'255,255,255'},${Math.abs(t-.5)*.14})`;g.fillRect(x,f*bh,W,bh);}
  for(let f=0;f<2;f++){g.fillStyle=SOMBRA;g.fillRect(0,f*bh,W,j);g.fillRect(f?W/2:0,f*bh,j,bh);g.fillStyle=LUZ;g.fillRect(0,f*bh+j,W,j);}}},
 // el estuco: liso, con un grano parejo (manchitas claras y oscuras)
 estuco:{w:1,h:1,nombre:'Estuco',pinta(g,W,H){for(let k=0;k<170;k++){const t=azar(k,3,5);g.fillStyle=t<.5?'rgba(0,0,0,.05)':'rgba(255,255,255,.07)';const s=2+azar(k,9)*5;g.fillRect(azar(k,1)*W,azar(k,2)*H,s,s);}}},
 // el revoque rústico: manchas grandes y un grano más grueso, como una pared encalada a mano
 revoque:{w:1.6,h:1.6,nombre:'Revoque rústico',pinta(g,W,H){for(let k=0;k<26;k++){const t=azar(k,4,8);g.fillStyle=t<.5?'rgba(0,0,0,.045)':'rgba(255,255,255,.06)';g.beginPath();g.ellipse(azar(k,1)*W,azar(k,2)*H,18+azar(k,5)*46,10+azar(k,6)*26,azar(k,7)*3,0,7);g.fill();}
  for(let k=0;k<240;k++){g.fillStyle=azar(k,11)<.5?'rgba(0,0,0,.07)':'rgba(255,255,255,.08)';const s=2+azar(k,12)*4;g.fillRect(azar(k,13)*W,azar(k,14)*H,s,s);}}},
 // el panel: chapas de 1,2 m con la junta vertical marcada y una horizontal por piso
 panel:{w:1.2,h:3,nombre:'Panel metálico',pinta(g,W,H){const j=Math.max(2,PPM*.02);g.fillStyle=SOMBRA;g.fillRect(0,0,j,H);g.fillRect(0,0,W,j);g.fillStyle=LUZ;g.fillRect(j,0,j,H);g.fillRect(0,j,W,j);
  g.fillStyle='rgba(255,255,255,.05)';g.fillRect(W*.5,0,W*.5,H);}},
 // el hormigón a la vista: tableros de 1,2 × 0,6 con los agujeros de los pasadores
 hormigon:{w:1.2,h:.6,nombre:'Hormigón a la vista',pinta(g,W,H){const j=Math.max(1.5,PPM*.012);g.fillStyle=SOMBRA;g.fillRect(0,0,W,j);g.fillRect(0,0,j,H);for(const [u,v] of [[.2,.5],[.8,.5]]){g.beginPath();g.arc(W*u,H*v,PPM*.02,0,7);g.fill();}
  for(let k=0;k<50;k++){g.fillStyle=azar(k,21)<.5?'rgba(0,0,0,.04)':'rgba(255,255,255,.05)';g.fillRect(azar(k,22)*W,azar(k,23)*H,3+azar(k,24)*8,2);}}},
 // la pizarra: tejuelas de 40 × 30 cm, cada fila corrida media pieza, con la sombra del solape
 pizarra:{w:.4,h:.6,nombre:'Pizarra',pinta(g,W,H){const bh=H/2,j=Math.max(1.5,PPM*.014);
  for(let f=0;f<2;f++)for(let c=-1;c<2;c++){const t=azar(c+5,f,3);g.fillStyle=`rgba(${t<.5?'0,0,0':'255,255,255'},${Math.abs(t-.5)*.2})`;g.fillRect(c*W+(f?W/2:0),f*bh,W,bh);}
  for(let f=0;f<2;f++){g.fillStyle='rgba(0,0,0,.3)';g.fillRect(0,f*bh+bh-j*1.6,W,j*1.6);g.fillRect(f?W/2:0,f*bh,j,bh);g.fillStyle=LUZ;g.fillRect(0,f*bh,W,j);}}},
 // la teja de barro: canales de 30 cm con su lomo claro, y el solape de cada hilada cada 50 cm
 teja:{w:.3,h:.5,nombre:'Teja de barro',pinta(g,W,H){const gr=g.createLinearGradient(0,0,W,0);gr.addColorStop(0,'rgba(0,0,0,.24)');gr.addColorStop(.35,'rgba(255,255,255,.16)');gr.addColorStop(.7,'rgba(0,0,0,.04)');gr.addColorStop(1,'rgba(0,0,0,.24)');
  g.fillStyle=gr;g.fillRect(0,0,W,H);g.fillStyle='rgba(0,0,0,.26)';g.fillRect(0,H-PPM*.03,W,PPM*.03);g.fillStyle=LUZ;g.fillRect(0,0,W,PPM*.015);}},
 // la losa de azotea: baldosas de 60 cm con la junta fina y un grano de gravilla
 losa:{w:.6,h:.6,nombre:'Losa de azotea',pinta(g,W,H){const j=Math.max(1.5,PPM*.012);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,0,W,j);g.fillRect(0,0,j,H);
  for(let k=0;k<26;k++){g.fillStyle=azar(k,31)<.5?'rgba(0,0,0,.06)':'rgba(255,255,255,.08)';g.fillRect(azar(k,32)*W,azar(k,33)*H,3,3);}}},
 // las tablas: entablado horizontal de 15 cm con la sombra del solape y alguna tabla más clara u oscura
 tabla:{w:2.4,h:.6,nombre:'Entablado',pinta(g,W,H){const bh=H/4;for(let f=0;f<4;f++){const t=azar(f,51);g.fillStyle=`rgba(${t<.5?'0,0,0':'255,255,255'},${Math.abs(t-.5)*.12})`;g.fillRect(0,f*bh,W,bh);
   g.fillStyle='rgba(0,0,0,.2)';g.fillRect(0,f*bh+bh-PPM*.018,W,PPM*.018);g.fillStyle=LUZ;g.fillRect(0,f*bh,W,PPM*.012);g.fillStyle='rgba(0,0,0,.14)';g.fillRect(W*(.2+azar(f,52)*.6),f*bh,PPM*.012,bh);}}},
 // el zinc: chapa acanalada, una onda cada 20 cm, con el solape de las chapas cada 2 m
 zinc:{w:.2,h:2,nombre:'Chapa de zinc',pinta(g,W,H){const gr=g.createLinearGradient(0,0,W,0);gr.addColorStop(0,'rgba(0,0,0,.2)');gr.addColorStop(.5,'rgba(255,255,255,.2)');gr.addColorStop(1,'rgba(0,0,0,.2)');g.fillStyle=gr;g.fillRect(0,0,W,H);
  g.fillStyle='rgba(0,0,0,.22)';g.fillRect(0,H-PPM*.03,W,PPM*.03);}},
 // la piedra bola del zócalo: piedras irregulares
 piedra_bola:{w:.8,h:.5,nombre:'Zócalo de piedra',pinta(g,W,H){for(let k=0;k<9;k++){const x=(k%3+.5+(Math.floor(k/3)%2?.5:0))*W/3,y=(Math.floor(k/3)+.5)*H/3,t=azar(k,41);
   g.fillStyle=`rgba(${t<.5?'0,0,0':'255,255,255'},${.06+Math.abs(t-.5)*.2})`;g.strokeStyle='rgba(0,0,0,.22)';g.lineWidth=PPM*.014;g.beginPath();g.ellipse(x%W,y,W/6.6,H/6.6,t*2,0,7);g.fill();g.stroke();}}},
};

// Los paquetes: qué textura va en cada cosa. `muro` va por la familia del edificio (fachada.familia).
export const PAQUETES={
 liso:{nombre:'Liso',nota:'Sin texturas: sólo los colores del plano.',muro:{},zocalo:null,mansarda:null,losa:null},
 clasico:{nombre:'Clásico',nota:'Ladrillo a soga, sillar de piedra y panel metálico; mansardas de pizarra.',muro:{ladrillo:'ladrillo',piedra:'sillar',metal:'panel'},zocalo:'sillar',mansarda:'pizarra',losa:'losa'},
 colonial:{nombre:'Colonial',nota:'Muros encalados, zócalo de piedra y teja de barro en todo techo inclinado.',muro:{ladrillo:'revoque',piedra:'revoque',metal:'estuco'},zocalo:'piedra_bola',mansarda:'teja',losa:'losa'},
 moderno:{nombre:'Moderno',nota:'Hormigón a la vista, panel y estuco liso; techos de pizarra.',muro:{ladrillo:'hormigon',piedra:'estuco',metal:'panel'},zocalo:'hormigon',mansarda:'pizarra',losa:'losa'},
 costero:{nombre:'Costero',nota:'Entablado de madera pintada, estuco y techos de chapa de zinc.',muro:{ladrillo:'tabla',piedra:'estuco',metal:'panel'},zocalo:'hormigon',mansarda:'zinc',losa:'losa'},
 rustico:{nombre:'Rústico',nota:'Revoque a mano y estuco; zócalo de piedra bola y teja de barro.',muro:{ladrillo:'revoque',piedra:'estuco',metal:'hormigon'},zocalo:'piedra_bola',mansarda:'teja',losa:'losa'},
};

// La baldosa de una textura, ya pintada (un canvas de w × h metros a PPM píxeles por metro). Se guarda: se pinta una vez.
const baldosas=new Map();
export function baldosa(nombre){const T=TEXTURAS[nombre];if(!T)return null;if(baldosas.has(nombre))return baldosas.get(nombre);
 const c=document.createElement('canvas');c.width=Math.round(T.w*PPM);c.height=Math.round(T.h*PPM);const g=c.getContext('2d');T.pinta(g,c.width,c.height);baldosas.set(nombre,c);return c;}

// Rellena lo que ya esté trazado en g (después de un beginPath/rect) con la textura, a `m` píxeles por metro, anclada en
// (ox, oy) —la esquina desde donde se cuentan las hiladas—. No hace nada si la textura no existe o se vería de menos de
// medio píxel por junta (de muy lejos sólo ensucia).
export function textura(g,nombre,m,ox=0,oy=0){const b=baldosa(nombre);if(!b||m<6)return false;const p=g.createPattern(b,'repeat'),k=m/PPM;
 p.setTransform(new DOMMatrix([k,0,0,k,ox,oy]));g.save();g.fillStyle=p;g.fill();g.restore();return true;}

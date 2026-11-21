// LA FACHADA, EN TÉCNICO (2026-11-21, Miguel: «trabajemos en la vista de fachadas: que funcione como el mapa 2D, con los
// cálculos exactos de puertas y ventanas de toda una fachada; quitemos los detalles de los edificios y enfoquémonos en las
// fachadas antes de verlas en 3D, incluso dónde las paredes internas la cortan»).
//
// Un dibujo sin adornos: ni texturas, ni toldos, ni cornisas. Sólo lo que se calcula —engine/muros.js y
// engine/fachada-medida.js—, a escala:
//   · el muro, con sus pisos (línea llena) y sus módulos de 2 m (línea de puntos);
//   · cada PARED —de un tabique al siguiente, un piso de alto—: blanca y con su número si se pinta, gris si no;
//   · dónde una pared interna corta la fachada: la línea roja entre dos paredes;
//   · cada hueco con lo que de verdad ocupa su pieza: ventana (azul), puerta (marrón), vidriera (celeste), balcón o doble
//     (violeta), y la franja del zócalo (rayada);
//   · las cotas: el ancho de cada pared, el alto de cada piso y el ancho total.
// Devuelve lo medido, para mostrarlo al lado y para que se pueda comprobar.
import {ALTURA} from '../engine/medidas.js';
import {paredesDeFachada,fachadaPintable} from '../engine/muros.js';
import {fachadaMedida} from '../engine/fachada-medida.js';

const COLOR={ventana:['#cfe2f3','#3d7ab8'],puerta:['#e6d3bd','#8a5a3a'],vidriera:['#cdeef2','#1f8f9c'],balcon:['#e3d4ee','#6a3fa0'],doble:['#e3d4ee','#6a3fa0']};
export const LEYENDA=[['#ffffff','#18a06a','pared que se pinta (con su número)'],['#e2e3e6','#9aa3a8','pared que no se pinta'],...Object.entries({ventana:'ventana',puerta:'puerta',vidriera:'vidriera',balcon:'balcón o ventana doble'}).map(([k,t])=>[COLOR[k][0],COLOR[k][1],t]),['#c9c4bb','#8a857c','zócalo'],['#d6332e','#d6332e','una pared interna corta acá']];

export function drawFachadaTecnica(canvas,bp,L,lado,{width=640,cotas=true}={}){const F=fachadaPintable(bp,L,lado),paredes=paredesDeFachada(L,lado),FM=fachadaMedida(L,lado),H=ALTURA.piso,ancho=F.ancho,alto=F.alto;
 const dpr=window.devicePixelRatio||1,padL=46,padR=14,padT=22,padB=34,m=Math.min(34,(width-padL-padR)/ancho),w=ancho*m,h=alto*m,W=width,Hh=h+padT+padB;
 canvas.width=Math.round(W*dpr);canvas.height=Math.round(Hh*dpr);canvas.style.width=W+'px';canvas.style.height=Hh+'px';const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,Hh);
 const x0=padL+(W-padL-padR-w)/2,suelo=padT+h,X=u=>x0+u*m,Y=y=>suelo-y*m,pint=new Map(F.paredes.map(p=>[p.id,p]));
 g.fillStyle='#fbfaf7';g.fillRect(0,0,W,Hh);
 // las paredes: blanca la que se pinta, gris la que no
 for(const p of paredes){const P=pint.get(p.id);g.fillStyle=P?'#ffffff':'#e2e3e6';g.fillRect(X(p.u0),Y(p.y0+p.alto),(p.u1-p.u0)*m,p.alto*m);}
 // el zócalo
 for(const z of F.huecos.filter(q=>q.clase==='zocalo')){g.fillStyle='#c9c4bb';g.fillRect(X(z.u0),Y(z.y1),(z.u1-z.u0)*m,(z.y1-z.y0)*m);g.strokeStyle='rgba(0,0,0,.18)';g.lineWidth=1;g.beginPath();for(let u=z.u0;u<z.u1;u+=.25){g.moveTo(X(u),Y(z.y0));g.lineTo(X(Math.min(z.u1,u+.2)),Y(z.y1));}g.stroke();}
 // los módulos de 2 m (puntos) y los pisos (llena)
 g.strokeStyle='rgba(60,70,84,.28)';g.lineWidth=1;g.setLineDash([2,4]);g.beginPath();for(let u=2;u<ancho-1e-6;u+=2){g.moveTo(X(u)+.5,Y(0));g.lineTo(X(u)+.5,Y(alto));}g.stroke();g.setLineDash([]);
 g.strokeStyle='rgba(60,70,84,.7)';g.beginPath();for(const P of FM.pisos.slice(1)){g.moveTo(X(0),Y(P.base)+.5);g.lineTo(X(ancho),Y(P.base)+.5);}g.stroke();
 // los huecos, con lo que ocupa cada pieza
 let nV=0,areaV=0;for(const q of F.huecos){const c=COLOR[q.clase];if(!c)continue;nV++;areaV+=(q.u1-q.u0)*(q.y1-q.y0);g.fillStyle=c[0];g.fillRect(X(q.u0),Y(q.y1),(q.u1-q.u0)*m,(q.y1-q.y0)*m);g.strokeStyle=c[1];g.lineWidth=1.2;g.strokeRect(X(q.u0)+.6,Y(q.y1)+.6,(q.u1-q.u0)*m-1.2,(q.y1-q.y0)*m-1.2);
  if(cotas&&(q.u1-q.u0)*m>44&&(q.y1-q.y0)*m>22){g.fillStyle=c[1];g.font='10px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(`${(q.u1-q.u0).toFixed(2)} × ${(q.y1-q.y0).toFixed(2)}`,X((q.u0+q.u1)/2),(Y(q.y1)+Y(q.y0))/2);}}
 // el borde de cada pared; verde y con número la que se pinta
 for(const p of paredes){const P=pint.get(p.id);g.strokeStyle=P?'#18a06a':'#9aa3a8';g.lineWidth=P?2:1;g.strokeRect(X(p.u0)+1,Y(p.y0+p.alto)+1,(p.u1-p.u0)*m-2,p.alto*m-2);
  if(P&&(p.u1-p.u0)*m>30){g.fillStyle='#0f6b47';g.font=`700 ${Math.max(10,Math.min(15,m*.55))}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(P.numero.slice(7),X((p.u0+p.u1)/2),Y(p.y0+p.alto/2+(p.nivel===0?.4:0)));}}
 // dónde una pared interna corta la fachada: entre dos paredes del mismo piso
 // (y si un corte cae sobre un vano —no debería: lo comprueba validar-fachada-piezas—, se marca con un aviso amarillo)
 g.strokeStyle='#d6332e';g.lineWidth=2;g.beginPath();let cortes=0,cortesMalos=0;const malos=[];for(const p of paredes){if(p.u0<=1e-6)continue;cortes++;g.moveTo(X(p.u0),Y(p.y0)-1);g.lineTo(X(p.u0),Y(p.y0+p.alto)+1);
  if(F.huecos.some(q=>COLOR[q.clase]&&p.u0>q.u0+.02&&p.u0<q.u1-.02&&q.y1>p.y0+.05&&q.y0<p.y0+p.alto-.05)){cortesMalos++;malos.push(p);}}g.stroke();
 for(const p of malos){g.fillStyle='#ffd166';g.strokeStyle='#8a5a00';g.lineWidth=1.5;g.beginPath();g.arc(X(p.u0),Y(p.y0+p.alto/2),7,0,7);g.fill();g.stroke();g.fillStyle='#3a2600';g.font='700 10px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('!',X(p.u0),Y(p.y0+p.alto/2));}
 g.strokeStyle='#2a3340';g.lineWidth=1.5;g.strokeRect(X(0)+.75,Y(alto)+.75,w-1.5,h-1.5);
 // las cotas
 if(cotas){g.fillStyle='#4a5563';g.font='10px system-ui,sans-serif';g.textAlign='right';g.textBaseline='middle';for(const P of FM.pisos)g.fillText(P.nivel===0?'PB':'P'+P.nivel,x0-22,Y(P.base+H/2));
  g.textAlign='right';for(const P of FM.pisos)g.fillText((P.base+H).toFixed(1),x0-4,Y(P.base+H)+(P.nivel===FM.pisos.length-1?6:0));g.fillText('0',x0-4,Y(0)-4);
  g.textAlign='center';g.textBaseline='top';for(const p of paredes.filter(q=>q.nivel===0))if((p.u1-p.u0)*m>26)g.fillText((p.u1-p.u0).toFixed(1)+' m',X((p.u0+p.u1)/2),suelo+4);
  g.fillStyle='#2a3340';g.font='600 11px system-ui,sans-serif';g.fillText(`${ancho} × ${alto.toFixed(1)} m · fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[lado]}`,x0+w/2,suelo+18);}
 const areaP=F.paredes.reduce((a,p)=>{const z=Math.max(0,...(p.huecos||[]).filter(q=>q.clase==='zocalo').map(q=>q.y1));return a+p.ancho*(p.alto-z);},0);
 return {ancho,alto,modulos:Math.round(ancho/2),pisos:FM.pisos.length,paredes:paredes.length,pintables:F.paredes.length,cortes,cortesMalos,vanos:nV,areaVanos:+areaV.toFixed(1),areaPintable:+areaP.toFixed(1),numeros:F.paredes.map(p=>p.numero),
  // (lo que tiene que cuadrar: las paredes de cada piso suman el ancho; ningún hueco se sale)
  cuadra:!cortesMalos&&FM.pisos.every(P=>Math.abs(paredes.filter(p=>p.nivel===P.nivel).reduce((a,p)=>a+p.ancho,0)-ancho)<.001)&&F.huecos.every(q=>q.u0>=-.001&&q.u1<=ancho+.001&&q.y0>=-.001&&q.y1<=alto+.001)};}

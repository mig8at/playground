// COLOCAR UN OBJETO EN UN CUARTO (2026-11-21, Miguel: «yo quiero comprar un cuadro y poderlo colocar en algún lugar
// específico de la casa: ahí viene todo el tema matemático, que debería encajar»).
//
// Hasta acá los muebles los ponía el generador. Esto es la misma matemática al revés: una persona dice «acá» y el plano
// contesta DÓNDE queda exactamente y SI SE PUEDE, con la razón cuando no. No dibuja nada ni guarda nada: recibe el piso
// (cuartos, puertas, ventanas y muebles, en metros) y devuelve números. Así sirve igual para el plano 2D, para el 3D y
// para un servidor que tenga que validar lo que manda un jugador.
//
// Dos clases de objeto:
//   · DE PARED (un cuadro, un espejo, un reloj): se pega a la pared más cercana al punto, se acomoda a la grilla a lo
//     largo de ella y a su altura; no puede pisar una puerta ni una ventana de esa pared, ni otro objeto colgado, ni
//     quedar detrás de un mueble alto arrimado a ella, y tiene que entrar entero en el tramo de pared de ese cuarto.
//   · DE PISO (una planta, un sillón): se acomoda a la grilla; tiene que entrar entero en el cuarto, no pisar un mueble
//     ni otro objeto, y no puede quedar en el paso de una puerta.
// Todo en metros. La grilla (GRILLA) es lo que hace que «encaje»: nadie mide, y dos cuadros quedan alineados solos.
export const GRILLA={pared:.05,piso:.1,giro:Math.PI/2};
export const HOLGURA={vano:.08,esquina:.1,objetos:.04,muro:.06,paso:.9};// (m: aire contra un vano, la esquina, otro objeto, el muro; y el paso frente a una puerta)
// Lo que se puede colocar (el catálogo de la tienda saldría de acá). pared: ancho × alto, y a qué altura va su centro.
export const OBJETOS={
 cuadro:{nombre:'Cuadro',modo:'pared',ancho:.8,alto:.6,altura:1.5,color:'#b0563c'},
 cuadro_grande:{nombre:'Cuadro grande',modo:'pared',ancho:1.4,alto:.9,altura:1.5,color:'#3f6f8f'},
 espejo:{nombre:'Espejo',modo:'pared',ancho:.6,alto:1.2,altura:1.4,color:'#9fc3d1'},
 reloj:{nombre:'Reloj',modo:'pared',ancho:.3,alto:.3,altura:1.9,color:'#3a3d40'},
 repisa:{nombre:'Repisa',modo:'pared',ancho:1,alto:.25,altura:1.6,fondo:.22,color:'#8b6a4e'},
 planta:{nombre:'Planta',modo:'piso',w:.42,d:.42,mueble:'planta'},
 lampara:{nombre:'Lámpara de pie',modo:'piso',w:.36,d:.36,mueble:'lampara'},
 sillon:{nombre:'Sillón',modo:'piso',w:.9,d:.8,mueble:'sillon'},
 mesa_centro:{nombre:'Mesa de centro',modo:'piso',w:.9,d:.6,mueble:'mesa_centro'},
 comoda:{nombre:'Cómoda',modo:'piso',w:.8,d:.45,mueble:'comoda'},
};
// Los muebles altos: arrimados a una pared tapan lo que se cuelgue detrás (el alto, de CHOQUE_MUEBLE, a ojo: > 1,2 m).
const ALTOS=new Set(['armario','estante','nevera','casillero','archivador','estanteria_ropa','tablero','espejo_pared','litera','probador','vitrina']);
const ajusta=(v,g)=>Math.round(v/g)*g,cruza=(a0,a1,b0,b1,h=0)=>Math.min(a1,b1)-Math.max(a0,b0)>-h;

// El cuarto que contiene el punto (o null).
// (justo sobre un tabique el punto es de los dos cuartos: gana el que lo tiene más adentro —lejos de sus bordes—, así un
// punto apenas corrido no cambia de cuarto)
export const cuartoEn=(lv,x,z)=>{let mejor=null,bd=-1;for(const q of lv.rooms){if(x<q.x||x>q.x+q.w||z<q.y||z>q.y+q.h)continue;const d=Math.min(x-q.x,q.x+q.w-x,z-q.y,q.y+q.h-z);if(d>bd){bd=d;mejor=q;}}return mejor;};

// Las cuatro paredes de un cuarto: {lado, fija (la coordenada de la pared), a0, a1 (su tramo), horiz, hacia (hacia adentro)}.
export function paredesDe(q){return [
 {lado:'N',horiz:true,fija:q.y,a0:q.x,a1:q.x+q.w,hacia:[0,1]},{lado:'S',horiz:true,fija:q.y+q.h,a0:q.x,a1:q.x+q.w,hacia:[0,-1]},
 {lado:'W',horiz:false,fija:q.x,a0:q.y,a1:q.y+q.h,hacia:[1,0]},{lado:'E',horiz:false,fija:q.x+q.w,a0:q.y,a1:q.y+q.h,hacia:[-1,0]}];}
// Los vanos (puertas y ventanas) que caen sobre una pared, como tramos [p, q] a lo largo de ella.
export function vanosDe(lv,P){const out=[],enLinea=v=>P.horiz?Math.abs(v.y0-P.fija)<.2&&Math.abs(v.y1-P.fija)<.2:Math.abs(v.x0-P.fija)<.2&&Math.abs(v.x1-P.fija)<.2;
 for(const [lista,clase] of [[lv.doors||[],'puerta'],[lv.windows||[],'ventana']])for(const v of lista){if(!enLinea(v))continue;const p=P.horiz?Math.min(v.x0,v.x1):Math.min(v.y0,v.y1),q=P.horiz?Math.max(v.x0,v.x1):Math.max(v.y0,v.y1);
  if(cruza(p,q,P.a0,P.a1))out.push({p,q,clase});}return out;}

// DE PARED. punto: {x, z} donde apunta la persona. ya: lo colocado antes en este piso. Devuelve
// {ok, razon, lado, x, z (el centro, sobre la pared), t0, t1 (su tramo), altura, rect (para dibujarlo en planta), cuarto}.
export function enPared(lv,punto,obj,ya=[]){const q=cuartoEn(lv,punto.x,punto.z);if(!q)return {ok:false,razon:'Ahí no hay un cuarto.'};
 // la pared más cercana al punto
 const P=paredesDe(q).map(P=>({P,d:Math.abs((P.horiz?punto.z:punto.x)-P.fija)})).sort((a,b)=>a.d-b.d)[0].P,m=obj.ancho/2;
 // a lo largo: a la grilla, y adentro del tramo (con su aire contra la esquina)
 const libre0=P.a0+HOLGURA.esquina+m,libre1=P.a1-HOLGURA.esquina-m;if(libre1<libre0)return {ok:false,razon:`No entra: esta pared mide ${(P.a1-P.a0).toFixed(2)} m y el objeto ${obj.ancho.toFixed(2)}.`,cuarto:q.id,lado:P.lado};
 const t=Math.max(libre0,Math.min(libre1,ajusta(P.horiz?punto.x:punto.z,GRILLA.pared))),t0=t-m,t1=t+m,f=obj.fondo||.05;
 const base={lado:P.lado,cuarto:q.id,t0:+t0.toFixed(3),t1:+t1.toFixed(3),altura:obj.altura,x:+(P.horiz?t:P.fija).toFixed(3),z:+(P.horiz?P.fija:t).toFixed(3),
  rect:P.horiz?{x:t0,y:P.hacia[1]>0?P.fija:P.fija-f,w:obj.ancho,h:f}:{x:P.hacia[0]>0?P.fija:P.fija-f,y:t0,w:f,h:obj.ancho}};
 for(const v of vanosDe(lv,P))if(cruza(t0,t1,v.p,v.q,HOLGURA.vano))return {...base,ok:false,razon:`Ahí hay una ${v.clase}.`};
 for(const o of ya)if(o.modo==='pared'&&o.cuarto===q.id&&o.lado===P.lado&&cruza(t0,t1,o.t0,o.t1,HOLGURA.objetos))return {...base,ok:false,razon:'Ahí ya hay algo colgado.'};
 // un mueble alto arrimado a esta pared (a menos de 15 cm) lo taparía
 for(const fu of lv.furniture||[]){if(!ALTOS.has(fu.kind))continue;const cerca=P.horiz?Math.min(Math.abs(fu.y-P.fija),Math.abs(fu.y+fu.h-P.fija))<.15:Math.min(Math.abs(fu.x-P.fija),Math.abs(fu.x+fu.w-P.fija))<.15;
  if(cerca&&cruza(t0,t1,P.horiz?fu.x:fu.y,P.horiz?fu.x+fu.w:fu.y+fu.h))return {...base,ok:false,razon:'Quedaría detrás de un mueble alto.'};}
 return {...base,ok:true};}

// DE PISO. giro: 0 o un cuarto de vuelta (GRILLA.giro). Devuelve {ok, razon, x, z (el centro), w, d (ya girado), giro, rect, cuarto}.
export function enPiso(lv,punto,obj,ya=[],giro=0){const q=cuartoEn(lv,punto.x,punto.z);if(!q)return {ok:false,razon:'Ahí no hay un cuarto.'};
 const girado=Math.abs(Math.sin(giro))>.5,w=girado?obj.d:obj.w,d=girado?obj.w:obj.d,M=HOLGURA.muro;
 if(w>q.w-2*M||d>q.h-2*M)return {ok:false,razon:'No entra en este cuarto.',cuarto:q.id};
 // a la grilla, y adentro del cuarto
 const x=Math.max(q.x+M+w/2,Math.min(q.x+q.w-M-w/2,ajusta(punto.x,GRILLA.piso))),z=Math.max(q.y+M+d/2,Math.min(q.y+q.h-M-d/2,ajusta(punto.z,GRILLA.piso)));
 const r={x:x-w/2,y:z-d/2,w,h:d},base={cuarto:q.id,x:+x.toFixed(3),z:+z.toFixed(3),w,d,giro,rect:r},pisa=o=>Math.min(r.x+r.w,o.x+o.w)-Math.max(r.x,o.x)>.001&&Math.min(r.y+r.h,o.y+o.h)-Math.max(r.y,o.y)>.001;
 for(const fu of lv.furniture||[])if(pisa(fu))return {...base,ok:false,razon:'Ahí hay un mueble.'};
 for(const o of ya)if(o.modo==='piso'&&pisa(o.rect))return {...base,ok:false,razon:'Ahí ya pusiste algo.'};
 // el paso de cada puerta del cuarto: su ancho, HOLGURA.paso hacia adentro
 for(const dr of lv.doors||[]){if(dr.a!==q.id&&dr.b!==q.id)continue;const horiz=Math.abs(dr.y0-dr.y1)<1e-6,p0=horiz?Math.min(dr.x0,dr.x1):Math.min(dr.y0,dr.y1),p1=horiz?Math.max(dr.x0,dr.x1):Math.max(dr.y0,dr.y1),fija=horiz?dr.y0:dr.x0;
  const adentro=horiz?(fija<q.y+q.h/2?1:-1):(fija<q.x+q.w/2?1:-1),paso=horiz?{x:p0,y:adentro>0?fija:fija-HOLGURA.paso,w:p1-p0,h:HOLGURA.paso}:{x:adentro>0?fija:fija-HOLGURA.paso,y:p0,w:HOLGURA.paso,h:p1-p0};
  if(pisa(paso))return {...base,ok:false,razon:'Taparía el paso de la puerta.'};}
 return {...base,ok:true};}

// Lo mismo, sin saber la clase: elige por el objeto.
export const colocar=(lv,punto,tipo,ya=[],giro=0)=>{const obj=OBJETOS[tipo];if(!obj)return {ok:false,razon:'Ese objeto no existe.'};const r=obj.modo==='pared'?enPared(lv,punto,obj,ya):enPiso(lv,punto,obj,ya,giro);return {...r,tipo,modo:obj.modo};};

// EL GRAFITI: PIXEL ART SOBRE UN MURO ENTERO (2026-11-21, Miguel: «que las personas puedan hacer pixel art en las
// fachadas»; y el mismo día, al verlo: «la zona de pintado es una pared completa, sin incluir ventanas ni puertas, tanto
// exteriores como interiores, para que las personas puedan decorar sus apartamentos o casas; y la grilla, más densa»).
//
// Un MURO (engine/muros.js) es un rectángulo de `ancho` × `alto` metros con sus HUECOS (las ventanas y las puertas, con
// su marco). Acá se vuelve una GRILLA de píxeles de GRAFITI.px de lado (5 cm: un piso de 3 m son 60 píxeles de alto), los
// que entran enteros, centrados. Se puede pintar todo píxel cuyo centro no cae en un hueco. No dibuja ni guarda: da las
// cuentas, para que el editor del plano 2D, el 3D y un servidor que reciba lo que pinta alguien usen lo mismo.
//   Un grafiti: {cols, rows, d}: d es un Uint8Array con un número por píxel, de izquierda a derecha y de ARRIBA hacia
//   abajo; 0 es sin pintar y 1…15, el color de ese lugar de la PALETA. Para guardarlo o mandarlo: aTexto / deTexto (por
//   tramos del mismo color: una pared casi vacía ocupa unas pocas letras).
export const GRAFITI={px:.05,marco:.08,paleta:[null,'#16181b','#ffffff','#e2433b','#f07f2c','#f2c230','#2f9e6b','#3fb6c4','#2f6fbf','#6a3fa0','#c2408a','#8a5a3a','#9aa3a8','#5d6266','#9ed27a','#f4c7c3']};

// La grilla de un muro: cuántos píxeles tiene y lo que sobra a cada lado (du, dy), en metros.
export function lienzoDe(m){const px=GRAFITI.px,cols=Math.floor(m.ancho/px+1e-6),rows=Math.floor(m.alto/px+1e-6);return {cols,rows,px,du:(m.ancho-cols*px)/2,dy:(m.alto-rows*px)/2};}
export const vacio=(cols,rows)=>({cols,rows,d:new Uint8Array(cols*rows)});
// El centro de un píxel, en metros del muro (u desde su borde izquierdo, y desde abajo).
export const centroDe=(L,c,f)=>({u:L.du+(c+.5)*L.px,y:L.dy+(L.rows-1-f+.5)*L.px});
// ¿Se puede pintar este píxel? Su centro no cae en un hueco (agrandado por el marco).
export function pintable(m,c,f,L=lienzoDe(m)){if(c<0||f<0||c>=L.cols||f>=L.rows)return false;const {u,y}=centroDe(L,c,f),k=GRAFITI.marco;for(const h of m.huecos||[])if(u>h.u0-k&&u<h.u1+k&&y>h.y0-k&&y<h.y1+k)return false;return true;}
// La máscara entera (1: se puede pintar), para no preguntar píxel por píxel al dibujar.
export function mascaraDe(m){const L=lienzoDe(m),M=new Uint8Array(L.cols*L.rows).fill(1),k=GRAFITI.marco;for(const h of m.huecos||[]){const c0=Math.max(0,Math.ceil((h.u0-k-L.du)/L.px-.5)),c1=Math.min(L.cols-1,Math.floor((h.u1+k-L.du)/L.px-.5)),y0=h.y0-k,y1=h.y1+k;
  for(let f=0;f<L.rows;f++){const y=L.dy+(L.rows-1-f+.5)*L.px;if(!(y>y0&&y<y1))continue;for(let c=c0;c<=c1;c++){const u=L.du+(c+.5)*L.px;if(u>h.u0-k&&u<h.u1+k)M[f*L.cols+c]=0;}}}return M;}
export const colorEn=(g,c,f)=>c<0||f<0||c>=g.cols||f>=g.rows?null:GRAFITI.paleta[g.d[f*g.cols+c]]||null;
// Pinta un píxel de ESTE grafiti (color: su lugar en la paleta; 0 borra). Devuelve si cambió algo. mascara: la del muro.
export function pintar(g,c,f,color,mascara=null){if(c<0||f<0||c>=g.cols||f>=g.rows||!(Number.isInteger(color)&&color>=0&&color<GRAFITI.paleta.length))return false;const i=f*g.cols+c;if(mascara&&!mascara[i])return false;if(g.d[i]===color)return false;g.d[i]=color;return true;}
export const pintados=g=>{let n=0;for(let i=0;i<g.d.length;i++)if(g.d[i])n++;return n;};
// Para guardar: tramos «letra del color + cuántos seguidos (en base 36)», separados por punto.
export function aTexto(g){const out=[];let i=0;const d=g.d;while(i<d.length){let j=i+1;while(j<d.length&&d[j]===d[i])j++;out.push(d[i].toString(16)+(j-i).toString(36));i=j;}return out.join('.');}
export function deTexto(t,cols,rows){const g=vacio(cols,rows);let i=0;for(const tr of String(t||'').split('.')){if(!tr)continue;const c=parseInt(tr[0],16),n=parseInt(tr.slice(1),36);if(!(c>=0&&c<16)||!(n>0)||i+n>g.d.length)return null;g.d.fill(c,i,i+n);i+=n;}return i===g.d.length?g:null;}
// ¿Este grafiti es de este muro? (lo que valida un servidor antes de aceptarlo): su grilla, sus colores, y nada pintado
// encima de una ventana o de una puerta.
export function valido(g,m){const L=lienzoDe(m);if(!g||g.cols!==L.cols||g.rows!==L.rows||!g.d||g.d.length!==L.cols*L.rows)return {ok:false,razon:`La grilla de este muro es de ${L.cols} × ${L.rows} píxeles.`};
 const M=mascaraDe(m);for(let i=0;i<g.d.length;i++){if(g.d[i]>=GRAFITI.paleta.length)return {ok:false,razon:'Hay un color que no es de la paleta.'};if(g.d[i]&&!M[i])return {ok:false,razon:'Hay algo pintado sobre una ventana o una puerta.'};}return {ok:true};}
// De un punto del muro (u, y en metros) a su píxel {c, f}; null si cae en el margen.
export function pixelEn(m,u,y){const L=lienzoDe(m),c=Math.floor((u-L.du)/L.px),f=L.rows-1-Math.floor((y-L.dy)/L.px);return c<0||f<0||c>=L.cols||f>=L.rows?null:{c,f};}
// La clave de una ciudad en lo guardado.
export const claveCiudad=(seed,team)=>seed+'|'+team;

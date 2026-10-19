/* El tránsito, lo que se puede calcular sin dibujar (2026-10-18, Miguel: «que giren orgánicamente, que paren en los
   semáforos»). Puro: lo usa el tráfico del 3D (lib/traffic3d.js) y lo prueba validar-transito. Números: TRANSITO.
   · luz(t, eje): 'verde' | 'amarillo' | 'rojo' del eje ('h': este–oeste, 'v': norte–sur) a los t s del ciclo, y cuánto
     le falta a esa luz (resta). Todos los cruces con semáforo van en el mismo ciclo.
   · parar(d, frena): la velocidad con la que todavía se para en d m frenando a «frena» m/s² (√(2·frena·d)).
   · curva(radio): la velocidad de un giro de ese radio (√(lateral·R), con piso curvaMin).
   · amarillo(v, d, resta, cruce): ante el amarillo, a d m de la línea yendo a v m/s: 'para' si se puede parar sin pasar
     de la frenada máxima (con su reacción), 'sigue' si alcanza a cruzar (d + cruce) antes de que termine el todo rojo.
   · objetivo(v, vmax, limites, adelanto): la velocidad a la que apuntar: vmax y, por cada límite {d, v, frena}, lo que deja llegar
     a d m yendo a lo más v (√(v² + 2·frena·d)).
   · paso(v, meta, dt): la nueva velocidad, acelerando o frenando con sus topes. */
import {TRANSITO as T} from './medidas.js';
const S=T.semaforo,FASE=S.verde+S.amarillo+S.todoRojo;
export const CICLO=2*FASE;
export function luz(t,eje){const u=((t%CICLO)+CICLO)%CICLO,k=eje==='h'?u:(u+FASE)%CICLO;
 if(k<S.verde)return {luz:'verde',resta:S.verde-k};if(k<S.verde+S.amarillo)return {luz:'amarillo',resta:S.verde+S.amarillo-k};return {luz:'rojo',resta:CICLO-k};}
export const parar=(d,frena=T.frena.comoda)=>Math.sqrt(Math.max(0,2*frena*d));
export const curva=radio=>Math.max(T.curvaMin,Math.sqrt(T.lateral*Math.max(0,radio)));
export function amarillo(v,d,resta,cruce=12){const frenar=v*T.reaccion+v*v/(2*T.frena.maxima);
 if(frenar<=d)return 'para';
 // (no alcanza a parar con su reacción: ¿alcanza a cruzar antes de que el otro eje tenga verde? —el amarillo que queda y
 // el todo rojo—; si tampoco, despacio y cerca de la línea: frena ya, sin la demora —el conductor bot no la necesita—)
 if((d+cruce)/Math.max(v,.1)<=resta+S.todoRojo)return 'sigue';
 // (parar puede pisar la cebra: hasta PISA m pasada la línea —arrancando despacio en la línea cuando cambia, cruzaba en rojo—)
 return v*v/(2*T.frena.maxima)<=d+PISA?'para':'sigue';}
export const PISA=1;
// (adelanto: s que se mira adelante —el cuadro que viene—: sin él la velocidad llega tarde un cuadro a la curva de frenado
// y en el último metro frena de golpe)
export function objetivo(v,vmax,limites=[],adelanto=0){let m=vmax;for(const l of limites){const d=l.d-v*adelanto,w=Math.sqrt(Math.max(0,l.v*l.v+2*(l.frena??T.frena.comoda)*Math.max(0,d)));if(w<m)m=w;}return m;}
export const paso=(v,meta,dt)=>meta<v?Math.max(meta,v-T.frena.maxima*dt):Math.min(meta,v+T.acelera*dt);

// El probador del 2D (2026-10-16, decisión de Miguel: el 2D prueba todo; cualquier arreglo del 3D se corrige en el 2D).
// Por NIVELES, de lo más grande a lo más chico (2026-10-16, Miguel: «niveles de pruebas empezando por lo más grande hasta
// lo más chico»): un error grande —una calle mal puesta— se arrastra y hace fallar todo lo de abajo, así que se corre un
// nivel por vez (sus pruebas en paralelo) y, si uno falla, los de abajo no se corren: los números que quedan apuntan a la
// causa y no a sus consecuencias. Al final, una tabla por nivel con el peor caso de cada prueba que falla y su detalle.
// Cómo se corre (2026-10-18, Miguel: «optimizar las pruebas haciendo paralelismo donde se pueda»): ya no de a un nivel —se
// esperaba a la prueba más lenta de cada nivel para empezar el siguiente—; todas a la vez, mientras alcancen los núcleos,
// la memoria y los navegadores (cada prueba dice cuánto usa: costo), las más largas primero (lo que tardaron la última
// vez: referencias/tiempos.json). El informe sale igual, por nivel; y si un nivel falla (sin --seguir), se cortan las de
// los niveles de abajo que estén corriendo y no se informan: la regla de arriba sigue valiendo. Las pruebas que van ciudad
// por ciudad sin mirar el conjunto (partir) se corren de a una ciudad por proceso y se suman sus fallas.
// Uso: node scripts/probar.mjs [ciudades=4] [semilla0=1] [--rapido: 1 ciudad y sin las pruebas lentas —para el día a día;
//      la entera, antes de dar algo por terminado—] [--nivel=3 | --nivel=2-5]
//      [--solo=nombre,nombre] [--seguir: no cortar en el nivel que falla] [--todo: salida completa de cada prueba] [--tiempo=600: s que puede tardar cada prueba]
import {spawn} from 'node:child_process';import {cpus,totalmem} from 'node:os';import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';

const A=process.argv.slice(2),num=A.filter(a=>!a.startsWith('--')),RAP=A.includes('--rapido'),TODO=A.includes('--todo'),SEGUIR=A.includes('--seguir');
const N=String(RAP?1:+(num[0]||4)),S0=String(+(num[1]||1)),solo=(A.find(a=>a.startsWith('--solo='))||'').slice(7).split(',').filter(Boolean);
const nv=(A.find(a=>a.startsWith('--nivel='))||'').slice(8),[NV0,NV1]=nv?(nv.includes('-')?nv.split('-').map(Number):[+nv,+nv]):[0,99];
const aqui=dirname(fileURLToPath(import.meta.url)),grande=['--max-old-space-size=8192'],F=/^fallas: (\d+)/m;
// Los niveles: qué valida cada uno y sus pruebas (script, argumentos, cómo se leen sus fallas y qué línea resume).
const NIVELES=[
 {n:0,t:'Medidas',d:'cada número con una sola fuente, y las reglas que salen de otras cuadran',p:[
  {n:'medidas',f:'validar-medidas.mjs',a:[],fallas:F,res:/^medidas/}]},
 {n:1,t:'Mundo',d:'la isla, la montaña, la ciudad y las zonas prohibidas',p:[
  {n:'mundo',f:'validar-mundo.mjs',a:[N,S0],fallas:F,res:/^\d+ mundos/},
  {n:'zonas',f:'validar-zonas.mjs',a:[N,S0],fallas:F,res:/^descartados/}]},
 {n:2,t:'Vías y manzanas',d:'calles, pendientes, terrazas, cruces, carriles, direcciones',p:[
  {n:'circulación',f:'validar-circulacion.mjs',a:[N,S0],fallas:F,res:/^vehículos/,node:grande},
  {n:'terrazas',f:'validar-terrazas.mjs',a:[N,S0],fallas:F,res:/^terrazas/},
  {n:'tráfico',f:'validar-trafico.mjs',a:[N,S0],fallas:F,res:/^tráfico/},
  {n:'tránsito',f:'validar-transito.mjs',a:[N,S0],fallas:F,res:/^tránsito ·/},
  {n:'direcciones',f:'validar-direcciones.mjs',a:[N,S0],fallas:F,res:/^direcciones/},
  {n:'ubicación',f:'validar-ubicacion.mjs',a:[N,S0],fallas:F,res:/^ubicación/}]},
 {n:3,t:'Lotes y edificios',d:'plantas, pisos, escaleras, fachadas y el acceso a los patios',p:[
  {n:'ciudad',f:'validar-ciudad.mjs',a:[N,S0],fallas:/edificios con alguna falla: (\d+)/,res:/^\d+ ciudades/},
  {n:'núcleos',f:'validar-nucleos.mjs',a:[N,S0],fallas:/(\d+) con fallas/,res:/con escalera/},
  {n:'casas modernas',f:'validar-casas-modernas.mjs',a:[N,S0],fallas:F,res:/^casas modernas/},// (2026-11-22: dúplex modernas del monte —hogar.js, vivienda.js—)
  {n:'escaleras de casa',f:'validar-escaleras-casa.mjs',a:[],fallas:/(\d+) con fallas/,res:/casas de dos pisos/},
  {n:'vanos de casa',f:'validar-vanos.mjs',a:[Math.min(N,3),S0],fallas:F,res:/^vanos/},
  {n:'fachada y uso',f:'validar-fachada-uso.mjs',a:[N,S0],fallas:F,res:/^fachada y uso/},
  {n:'fachada medida',f:'validar-fachada-medida.mjs',a:[N,S0],fallas:F,res:/^fachada medida/},
  {n:'fachada piezas',f:'validar-fachada-piezas.mjs',a:[N,S0],fallas:F,res:/^fachada piezas/},// (2026-11-21: el plano y el 3D ponen lo mismo en cada módulo —engine/fachada-piezas.js—)
  {n:'grafiti',f:'validar-grafiti.mjs',a:[N,S0],fallas:F,res:/^grafiti/},
  {n:'guardado',f:'validar-guardado.mjs',a:[N,S0],fallas:F,res:/^guardado/},
  {n:'grafo de muros',f:'validar-grafo-muros.mjs',a:[N,S0],fallas:F,res:/^grafo de muros/},// (2026-11-22: tramos, nodos, vanos y lo que no encaja —engine/grafo-muros.js—)
  {n:'departamentos',f:'validar-departamentos.mjs',a:[N,S0],fallas:F,res:/^departamentos/},// (2026-11-22: los departamentos abiertos —engine/duplex.js abrirDepartamentos—)
  {n:'dúplex',f:'validar-duplex.mjs',a:[N,S0],fallas:F,res:/^dúplex/},// (2026-11-22: los dúplex bajo la mansarda —engine/duplex.js—)// (2026-11-21: la huella de cada pared, la conciliación y la base SQLite de lo pintado)// (2026-11-21: la grilla de pixel art de cada paño —engine/grafiti.js—)// (2026-11-21: vanos, paños y textura de cada fachada —engine/fachada-medida.js—)
  {n:'fachada 3D',f:'validar-fachada3d.mjs',a:[],fallas:F,res:/^fachada low poly/},
  {n:'patios',f:'validar-patios.mjs',a:[N,S0],fallas:F,res:/^patios/}]},
 {n:4,t:'Interiores',d:'pasillos, muebles, usos y cortinas',p:[
  {n:'pasillos',f:'validar-pasillos.mjs',a:[N,S0],fallas:F,res:/^pasillos libres/},
  {n:'interiores',f:'validar-interiores.mjs',a:[N,S0],fallas:F,res:/^se llega caminando/},
  {n:'muebles',f:'validar-muebles.mjs',a:[N,S0],fallas:F,res:/^muebles/},
  {n:'usos',f:'validar-usos.mjs',a:[N,S0],fallas:F,res:/^usos/},
  {n:'colocar',f:'validar-colocar.mjs',a:[N,S0],fallas:F,res:/^colocar/},
  {n:'aparecer',f:'validar-aparecer.mjs',a:[N,S0],fallas:F,res:/^aparecer/},
  {n:'propiedades',f:'validar-propiedades.mjs',a:[N,S0],fallas:F,res:/^propiedades/},// (2026-11-21: el listado de lo que se vende —engine/propiedades.js—)// (2026-11-21: dónde aparece quien entra —engine/aparecer.js—)// (2026-11-21: colgar y apoyar objetos a mano —engine/colocar.js—)
  {n:'aulas',f:'validar-aulas.mjs',a:[N,S0],fallas:F,res:/^aulas/},
  {n:'giros',f:'validar-giros.mjs',a:[N,S0],fallas:F,res:/^giros/},
  {n:'cortinas',f:'validar-cortinas.mjs',a:[N,S0],fallas:F,res:/^cortinas/}]},
 {n:5,t:'Exterior',d:'árboles, equipamiento, pintura, color y los colores del mundo',p:[
  {n:'colores',f:'validar-colores.mjs',a:[],fallas:F,res:/^colores/},// (2026-11-22: el color del motor llega igual al 3D; la tabla en la familia)
  {n:'vegetación',f:'validar-vegetacion.mjs',a:[N,S0],fallas:F,res:/^3-30-300/},
  {n:'equipamiento',f:'validar-equipamiento.mjs',a:[N,S0],fallas:F,res:/^cobertura/},
  {n:'pintura',f:'validar-pintura.mjs',a:[N,S0],fallas:F,res:/^pintura/},
  {n:'color',f:'validar-color.mjs',a:[N,S0],fallas:F,res:/^color/,lento:true}]},
 {n:6,t:'Geometría sin pantalla',d:'lo que se dibuja contra el plano: piezas en su lugar, caras que no titilan, sin huecos ni triángulos que nunca se ven, empalmes al milímetro y objetos que no se tapan',p:[
  {n:'titileo',f:'validar-titileo.mjs',a:[1,S0],fallas:F,res:/^titileo/},
  {n:'contrato 3D',f:'validar-contrato.mjs',a:[N,S0],fallas:F,res:/entradas del contrato/,lento:true},
  {n:'huecos',f:'validar-huecos.mjs',a:[2,S0],fallas:F,res:/^huecos/,node:grande},
  {n:'triángulos',f:'validar-triangulos.mjs',a:[1,S0,'--mundo'],fallas:F,res:/^triángulos/,node:['--max-old-space-size=12000']},
  {n:'empalmes',f:'validar-empalmes.mjs',a:[RAP?1:2,S0],fallas:F,res:/^empalmes/,node:['--max-old-space-size=12000']},
  {n:'oclusión',f:'validar-oclusion.mjs',a:[RAP?1:2,S0],fallas:F,res:/^oclusión/,node:['--max-old-space-size=12000']}]},
 {n:7,t:'Física',d:'por dónde se pasa, qué frena y que el suelo que se pisa sea el que se ve',p:[
  {n:'escalera a la azotea',f:'validar-escalera-azotea.mjs',a:[N,S0],fallas:F,res:/^escalera a la azotea/},// (2026-11-22: se sube caminando del último piso a la azotea)
  {n:'lejos',f:'validar-lejos.mjs',a:[1,S0],fallas:F,res:/^lejos/},// (2026-11-22: la caja de lejos de cada edificio y la versión baja de las plantas)
  {n:'dúplex en 3D',f:'validar-duplex-3d.mjs',a:[N,S0],fallas:F,res:/^dúplex en 3D/},// (2026-11-22: se sube caminando por la escalera de cada dúplex hasta el altillo)
  {n:'mansarda',f:'validar-mansarda.mjs',a:[N,S0],fallas:F,res:/^mansarda/},
  {n:'azoteas con objetos',f:'validar-azoteas-objetos.mjs',a:[N,S0],fallas:F,res:/^azoteas con objetos/},
  {n:'colisiones',f:'validar-colisiones.mjs',a:[N,S0],fallas:F,res:/^paso libre/,node:grande},
  {n:'suelo',f:'validar-suelo.mjs',a:[2,S0],fallas:F,res:/^suelo/,node:grande},
  {n:'pisos',f:'validar-pisos.mjs',a:[RAP?1:2,S0],fallas:F,res:/^pisos/,node:grande}]},
 {n:8,t:'Visibilidad',d:'qué se ve desde adentro, qué se ve desde la calle (la oclusión) y qué se aclara',p:[
  {n:'visibles',f:'validar-visibles.mjs',a:[2,S0,800],fallas:F,res:/^visibles/,lento:true},
  {n:'calle',f:'validar-calle.mjs',a:[RAP?1:2,S0],fallas:F,res:/^calle/}]},
 {n:9,t:'Ciudad',d:'los personajes, las viviendas, la sociedad (familias, trabajos y horarios), la gente caminando y la rutina (agenda y necesidades)',p:[
  {n:'personajes',f:'validar-personajes.mjs',a:[],fallas:F,res:/^personajes/},
  {n:'estado',f:'validar-estado.mjs',a:[],fallas:F,res:/^estado/},
  {n:'portales',f:'validar-portales.mjs',a:[Math.min(N,2),S0],fallas:F,res:/^portales/},// (2026-11-22: lo que se ve por las aberturas, en el motor)// (2026-11-22: puertas y ventanas abiertas, como datos)
  {n:'viviendas',f:'validar-viviendas.mjs',a:[N,S0],fallas:F,res:/^viviendas/},
  {n:'sociedad',f:'validar-sociedad.mjs',a:[N,S0,14],fallas:F,res:/^sociedad/},
  {n:'caminar',f:'validar-caminar.mjs',a:[S0],fallas:F,res:/^caminar a las 15/},
  {n:'descanso',f:'validar-descanso.mjs',a:[Math.min(N,2),S0],fallas:F,res:/^descanso · ciudad/},
  {n:'rutina',f:'validar-rutina.mjs',a:[N,S0],fallas:F,res:/^rutina/}]},
 {n:10,t:'Pantalla',d:'el 3D de verdad en un navegador sin ventana: costo de cada cuadro, capturas, errores, el tránsito y la entrada',p:[
  {n:'3d',f:'validar-3d.mjs',a:[S0],fallas:F,res:/^3d/,lento:true},
  {n:'tránsito 3d',f:'validar-transito3d.mjs',a:[S0],fallas:F,res:/^tránsito 3d/,lento:true},
  {n:'entrada',f:'validar-entrada.mjs',a:[],fallas:F,res:/^entrada/}]}]
 .filter(L=>L.n>=NV0&&L.n<=NV1).map(L=>({...L,p:L.p.filter(p=>(!solo.length||solo.some(s=>p.n.startsWith(s)))&&!(RAP&&p.lento&&!solo.length))})).filter(L=>L.p.length);
// Para el panel del harness (2026-10-30): --lista imprime los niveles y sus pruebas («LISTA {json}») y termina; --eventos,
// además, una línea «PRUEBA {json}» al terminar cada una. La salida de siempre (la tabla) no cambia.
const EVENTOS=A.includes('--eventos')||A.includes('--lista');
if(EVENTOS)console.log('LISTA '+JSON.stringify(NIVELES.map(L=>({n:L.n,t:L.t,d:L.d,p:L.p.map(p=>({n:p.n,lento:!!p.lento}))}))));
if(A.includes('--lista'))process.exit(0);
// El peor caso de una salida: el tipo de falla con más casos y su primer ejemplo (el formato «  N\ttipo» + ejemplos).
const peor=out=>{const L=out.split('\n'),i=L.findIndex(l=>F.test(l));if(i<0)return null;let best=null;
 for(let k=i+1;k<L.length;k++){const m=/^\s+(\d+)\t(.+)$/.exec(L[k]);if(m&&(!best||+m[1]>best.n))best={n:+m[1],tipo:m[2].trim(),ej:(L[k+1]||'').trim()};}return best;};
// (2026-10-18: una prueba que se cuelga —la del dron quedó 1 h 30 min esperando a un navegador que no contestaba— ya no
// frena la corrida: a los TIEMPO s se mata con todo lo que abrió —su grupo de procesos: el navegador también— y cuenta
// como error. Las del 3D —nivel 10, un navegador cada una— van de a TOPE_3D a la vez: con más, la máquina no da y se
// cortan solas («la página no contestó»); si una se corta así —un error, no una falla—, se reintenta una vez y se avisa)
const TIEMPO=+(process.argv.find(a=>a.startsWith('--tiempo='))?.slice(9)||600),TOPE_3D=2;
const correr=(p,vivo=()=>{})=>new Promise(ok=>{const t=Date.now(),ch=spawn(process.execPath,[...(p.node||[]),join(aqui,p.f),...p.a],{cwd:join(aqui,'../..'),detached:true});vivo(ch);let out='',vencio=false;
 const reloj=setTimeout(()=>{vencio=true;out+=`\nse pasó de ${TIEMPO} s: se cortó (con su navegador)\n`;try{process.kill(-ch.pid,'SIGKILL');}catch{try{ch.kill('SIGKILL');}catch{}}},TIEMPO*1000);
 ch.stdout.on('data',d=>out+=d);ch.stderr.on('data',d=>out+=d);ch.on('close',code=>{clearTimeout(reloj);const m=vencio?null:out.match(p.fallas),res=vencio?`se pasó de ${TIEMPO} s`:out.split('\n').find(l=>p.res.test(l))||'';
  ok({...p,seg:(Date.now()-t)/1000,fallas:m?+m[1]:null,error:vencio||code!==0||!m,vencio,res:res.trim(),out,peor:peor(out)});});});
// ---- el planificador ----
// recursos: núcleos (uno libre para la máquina), memoria (el 70 %, en GB) y navegadores a la vez (TOPE_3D); el costo de una
// prueba: un núcleo y 1 GB; las de node grande 3 GB, las de 12 GB 6; las del 3D, un navegador, dos núcleos y 2,5 GB
const CPUS=Math.max(2,cpus().length-1),MEM=Math.floor(totalmem()/2**30*.7),TIEMPOS=join(aqui,'referencias','tiempos.json');
const costo=(p,L)=>L.n===10?{cpu:2,mem:2.5,nav:1}:{cpu:1,mem:(p.node||[]).some(a=>/12000/.test(a))?6:p.node?3:1,nav:0};
const previo=existsSync(TIEMPOS)?JSON.parse(readFileSync(TIEMPOS,'utf8')):{};
const t0=Date.now(),hechos=[];let corte=null;
// los trabajos: cada prueba, o cada ciudad de una prueba partida
const grupos=[],trabajos=[];
for(const [li,L] of NIVELES.entries())for(const p of L.p){const n=p.partir?+p.a[0]:1,partes=n>1?Array.from({length:n},(_,i)=>({...p,a:['1',String(+p.a[1]+i),...p.a.slice(2)],parte:i+1})):[p];
 const g={L,li,p,n:partes.length,rs:[]};grupos.push(g);for(const q of partes)trabajos.push({g,p:q,c:costo(q,L),dura:previo[p.n]?previo[p.n]/partes.length:60});}
// (las más largas primero, dentro del orden de los niveles: un nivel bajo no espera a que termine uno alto)
trabajos.sort((a,b)=>b.dura-a.dura);
const usado={cpu:0,mem:0,nav:0},vivos=new Map(),porNivel=NIVELES.map(()=>[]);let cortado=Infinity;
const cabe=c=>!usado.cpu||usado.cpu+c.cpu<=CPUS&&usado.mem+c.mem<=MEM&&usado.nav+c.nav<=TOPE_3D;
const juntar=g=>{if(g.n===1)return g.rs[0];const rs=g.rs.sort((a,b)=>a.parte-b.parte),err=rs.some(r=>r.error);
 return {...g.p,partes:g.n,seg:Math.max(...rs.map(r=>r.seg)),fallas:err?null:rs.reduce((a,r)=>a+(r.fallas||0),0),error:err,reintento:rs.some(r=>r.reintento),
  res:`${rs[0].res}${g.n>1?` (y ${g.n-1} ciudades más, de a una por proceso)`:''}`,out:rs.map(r=>`[ciudad ${r.parte}]\n`+r.out.trim()).join('\n'),peor:rs.map(r=>r.peor).filter(Boolean).sort((a,b)=>b.n-a.n)[0]||null};};
await new Promise(fin=>{const pendientes=[...trabajos];
 const mirar=()=>{for(let i=0;i<pendientes.length;i++){const j=pendientes[i];if(j.g.li>cortado){pendientes.splice(i--,1);continue;}if(!cabe(j.c))continue;pendientes.splice(i--,1);lanzar(j);}
  if(!pendientes.length&&!vivos.size)fin();};
 const lanzar=async j=>{for(const k in usado)usado[k]+=j.c[k];
  let r=await correr(j.p,ch=>vivos.set(j,ch));
  if(j.g.L.n===10&&r.error&&r.fallas==null&&j.g.li<=cortado){process.stderr.write(`  ↻ ${r.n}: se cortó, otra vez\n`);r={...(await correr(j.p,ch=>vivos.set(j,ch))),reintento:true};}
  vivos.delete(j);for(const k in usado)usado[k]-=j.c[k];
  if(j.g.li<=cortado){j.g.rs.push(r);process.stderr.write(`  ${r.error||r.fallas?'✗':'✓'} ${j.g.L.n}·${r.n}${j.p.parte?` (ciudad ${j.p.parte})`:''} (${r.seg.toFixed(0)} s)${r.reintento?' · al segundo intento':''}\n`);
   if(j.g.rs.length===j.g.n){const jr=juntar(j.g);porNivel[j.g.li].push(jr);const L=j.g.L;
    if(EVENTOS)console.log('PRUEBA '+JSON.stringify({nivel:L.n,n:jr.n,fallas:jr.fallas,error:!!jr.error,seg:Math.round(jr.seg),res:jr.res,peor:jr.peor}));
    // (un nivel entero hecho y con fallas, sin --seguir: se cortan los de abajo —los que corren se matan—)
    if(porNivel[j.g.li].length===L.p.length&&!SEGUIR&&porNivel[j.g.li].some(r=>r.error||r.fallas)&&j.g.li<cortado){cortado=j.g.li;
     for(const [k,ch] of vivos)if(k.g.li>cortado){try{process.kill(-ch.pid,'SIGKILL');}catch{}}}}}
  mirar();};
 mirar();});
for(const [li,L] of NIVELES.entries()){if(li>cortado)break;const rs=porNivel[li];if(rs.length<L.p.length)continue;rs.sort((a,b)=>L.p.findIndex(p=>p.n===a.n)-L.p.findIndex(p=>p.n===b.n));hechos.push({L,rs});if(li===cortado)corte=L;}
// (lo que tardó cada prueba —entera—, para ordenar la próxima vez)
try{const t={...previo};for(const {rs} of hechos)for(const r of rs)if(!r.error)t[r.n]=Math.round(r.seg*(r.partes||1));writeFileSync(TIEMPOS,JSON.stringify(t,null,1));}catch{}
console.log(`\nProbador del 2D · ${N} ciudades desde la semilla ${S0} · ${((Date.now()-t0)/1000).toFixed(0)} s en total (${CPUS} núcleos, ${MEM} GB, ${TOPE_3D} navegadores)\n`);
for(const {L,rs} of hechos){const mal=rs.filter(r=>r.error||r.fallas);console.log(`${mal.length?'✗':'✓'} nivel ${L.n} · ${L.t} — ${L.d}`);
 for(const r of rs){console.log(`  ${r.error?'ERROR':r.fallas?'FALLA':'  ok '} ${r.n.padEnd(18)} ${String(r.fallas??'—').padStart(4)} fallas ${r.seg.toFixed(0).padStart(4)} s   ${r.reintento?'(al segundo intento) ':''}${r.res.slice(0,140)}`);
  if((r.error||r.fallas)&&r.peor)console.log(`        peor: ${r.peor.n} × ${r.peor.tipo}${r.peor.ej?'  ·  '+r.peor.ej.slice(0,160):''}`);}}
const sin=NIVELES.filter(L=>!hechos.some(h=>h.L===L));
if(corte&&sin.length)console.log(`\n(sin correr, por el nivel ${corte.n}: ${sin.map(L=>L.n+' '+L.t).join(', ')} — con --seguir se corren igual)`);
const malos=hechos.flatMap(h=>h.rs).filter(r=>r.error||r.fallas);
for(const r of TODO?hechos.flatMap(h=>h.rs):malos)console.log(`\n──── ${r.n} (${r.f} ${r.a.join(' ')}) ────\n${r.out.trim().split('\n').slice(-30).join('\n')}`);
console.log(malos.length?`\n${malos.length} con fallas o errores${corte&&sin.length?`: se cortó en el nivel ${corte.n}`:''}.`:`\nTodo en 0 (${hechos.length} niveles, ${hechos.reduce((a,h)=>a+h.rs.length,0)} pruebas).`);process.exit(malos.length?1:0);

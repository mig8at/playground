// Los colores del mundo (2026-11-22, Miguel: «color armónico a todo, coherente a lo que es cada cosa, desde el motor 2D
// hasta el 3D; sin texturas»; engine/colores.js), en node:
//  · lo que decide el motor llega igual al 3D: ningún color de PALETA (fachadas, molduras, techos, cuartos) ni del follaje y
//    la flor de las especies cambia al armonizar;
//  · la tabla COLOR está dentro de la familia (armonizarla no la cambia) y ningún color es blanco o negro puro;
//  · lo que es cada cosa por su nombre: las hojas, verdes; la madera y el tronco, cafés; el vidrio, azulado y claro;
//  · un color puro de fábrica (rojo, amarillo, blanco, negro) sale recortado: dentro de ARMONIA.
// Uso: node harness/pruebas/validar-colores.mjs
import {PALETA,VEGETACION} from '../../src/engine/medidas.js';
import {COLOR,ARMONIA,armonizar,colorDeNombre,luz} from '../../src/engine/colores.js';
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const todos=o=>JSON.stringify(o).match(/#[0-9a-fA-F]{6}\b/g)||[];
const rgb=h=>{const n=parseInt(h.slice(1),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];},croma=h=>{const c=rgb(h);return Math.max(...c)-Math.min(...c);},tono=h=>{const [r,g,b]=rgb(h),M=Math.max(r,g,b),m=Math.min(r,g,b),d=M-m||1;return M===r?((g-b)/d+6)%6*60:M===g?((b-r)/d+2)*60:((r-g)/d+4)*60;};
const delMotor=[...todos(PALETA),...VEGETACION.especies.flatMap(e=>[e.follaje,e.flor]).filter(Boolean)];
for(const c of new Set(delMotor.map(c=>c.toLowerCase())))if(armonizar(c)!==c&&luz(c)<=ARMONIA.luzMax&&luz(c)>=ARMONIA.luzMin)falla('un color del motor cambia al armonizar',{c,sale:armonizar(c)});
const tabla=todos(COLOR);for(const c of tabla){if(armonizar(c)!==c.toLowerCase())falla('un color de la tabla está fuera de la familia',{c,sale:armonizar(c)});if(/^#(fff|000)/i.test(c)&&/^#(ffffff|000000)$/i.test(c))falla('blanco o negro puro en la tabla',{c});}
const verde=h=>tono(h)>60&&tono(h)<170,cafe=h=>tono(h)>10&&tono(h)<50&&luz(h)<.6;
if(!verde(colorDeNombre('Leaves')))falla('las hojas no son verdes',{c:colorDeNombre('Leaves')});
for(const n of ['Wood','Trunk','Tree'])if(!cafe(colorDeNombre(n)))falla('la madera o el tronco no son cafés',{n,c:colorDeNombre(n)});
const v=colorDeNombre('Glass');if(!(tono(v)>170&&tono(v)<230&&luz(v)>.6))falla('el vidrio no es azulado y claro',{c:v});
for(const c of ['#ff0000','#ffff00','#00ff00','#ffffff','#000000']){const a=armonizar(c);if(croma(a)>ARMONIA.cromaMax+.01||luz(a)>ARMONIA.luzMax+.01||luz(a)<ARMONIA.luzMin-.01)falla('un color puro no sale recortado',{c,sale:a});}
console.log(`colores · ${new Set(delMotor).size} colores del motor iguales en el 3D · la tabla: ${tabla.length} colores en la familia (croma ≤ ${ARMONIA.cromaMax}, luz ${ARMONIA.luzMin}–${ARMONIA.luzMax}) · hojas ${colorDeNombre('Leaves')}, madera ${colorDeNombre('Wood')}, vidrio ${v}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(fallas.size?1:0);

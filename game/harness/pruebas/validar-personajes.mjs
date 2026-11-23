// Nivel 9 del probador: los personajes (2026-11-22, Miguel: «saca todos los muñecos anteriores… para dejar lo que vamos a
// dejar»; reemplaza a validar-cuerpo, que probaba el muñeco viejo y quedó en before/). Sin pantalla:
//  · cada look de la gente (characters3d lookFor, de todos los modelos y muchas semillas) usa un cuerpo y un peinado que
//    existen (personajes3d PEINADOS), con su piel y su pelo en la paleta (vestuario COLORS) y su contextura dentro de los
//    rangos (CONTEXTURA.rango); hay de todas: delgados y gruesos, bajos y altos, y algunos musculosos;
//  · el peinado del perfil (peinadoDe): los de mujer van con el cuerpo de mujer, la barba con el de hombre, y siempre un
//    peinado de ese cuerpo;
//  · la ropa por zonas (ropa.js zonasDeRopa): la manga corta deja el antebrazo de piel, la chaqueta tapa las mangas, la
//    falda y la bermuda dejan la pantorrilla de piel, el vestido pinta el tronco y la falda, y cada atuendo de la gente
//    (outfitFor) usa prendas del catálogo;
//  · el uniforme de la policía: el chaleco reflectivo en el tronco y las mangas azules.
// Uso: node harness/pruebas/validar-personajes.mjs [semillas=2000]
import {COLORS} from '../../src/engine/vestuario.js';
import {PEINADOS,CONTEXTURA} from '../../src/lib/personajes3d.js';
import {lookFor,outfitFor,peinadoDe,uniformeDe,CIVILS} from '../../src/lib/characters3d.js';
import {zonasDeRopa,garmentById} from '../../src/lib/ropa.js';

const N=+(process.argv[2]||2000);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;
const combos=Object.fromEntries(Object.entries(PEINADOS).map(([q,l])=>[q,new Set(l.map(p=>p.join('+')))])),R=CONTEXTURA.rango;
const en=(x,[a,b])=>x>=a-1e-9&&x<=b+1e-9,cuenta={delgado:0,grueso:0,bajo:0,alto:0,musculoso:0},quienes={hombre:0,mujer:0};let looks=0,prendas=new Set();
for(let s=1;s<=N;s++){const r=rng(s*7919+1);for(const m of CIVILS){const L=lookFor(m,r);looks++;quienes[L.quien]=(quienes[L.quien]||0)+1;
 if(!combos[L.quien]?.has(L.pelos.join('+')))falla('el peinado no es de ese cuerpo',{m,quien:L.quien,pelos:L.pelos});
 if(!COLORS.piel[L.piel]||!COLORS.pelo[L.pelo])falla('la piel o el pelo no están en la paleta',{piel:L.piel,pelo:L.pelo});
 const f=L.forma;if(!en(f.estatura,[R.estatura[0]*.97,R.estatura[1]])||!en(f.peso,R.peso)||!en(f.musculo,R.musculo))falla('la contextura se sale de los rangos',f);
 if(f.peso<-.35)cuenta.delgado++;if(f.peso>.5)cuenta.grueso++;if(f.estatura<.96)cuenta.bajo++;if(f.estatura>1.04)cuenta.alto++;if(f.musculo>.5)cuenta.musculoso++;
 const o=outfitFor(L,r);for(const [lugar,p] of Object.entries(o)){if(!p)continue;const g=garmentById(p.id);prendas.add(p.id);if(!g||g.slot!==lugar)falla('una prenda no está en el catálogo o va en otro lugar',{lugar,id:p.id});}}}
for(const [k,n] of Object.entries(cuenta))if(n<looks*.01)falla('falta variedad de contextura',{k,n,looks});
// (el peinado del perfil)
for(const [peinado,barba,quien] of [['pelo:Casual_Female','','mujer'],['pelo:Casual2_Female','','mujer'],['pelo:Casual2_Male','','hombre'],['','','hombre'],['pelo:Casual_Female','bigote:Viking_Male:corta','hombre']]){
 const P=peinadoDe(peinado,barba);if(P.quien!==quien)falla('el peinado del perfil va con otro cuerpo',{peinado,barba,quien:P.quien});
 if(!combos[P.quien].has(P.pelos.join('+')))falla('el peinado del perfil no es de ese cuerpo',{peinado,barba,pelos:P.pelos});}
// (la ropa por zonas)
const piel='#d9a77f',z=o=>zonasDeRopa(o,piel);
const casos=[['manga corta: antebrazo de piel',z({top:{id:'camiseta',color:'#111'}}).antebrazo===piel],
 ['manga larga: antebrazo de la prenda',z({top:{id:'manga-larga',color:'#111'}}).antebrazo==='#111'],
 ['la chaqueta tapa las mangas',z({top:{id:'camiseta',color:'#111'},outer:{id:'abrigo',color:'#222'}}).antebrazo==='#222'],
 ['el chaleco deja las mangas de la camisa',(()=>{const k=z({top:{id:'camisa',color:'#111'},outer:{id:'chaleco',color:'#222'}});return k.camisa==='#222'&&k.antebrazo==='#111';})()],
 ['la falda deja la pantorrilla de piel',z({bottom:{id:'falda-corta',color:'#333'}}).pantaloneta===true],
 ['el jean llega al tobillo',z({bottom:{id:'jean',color:'#333'}}).pantaloneta===false],
 ['el vestido pinta tronco y falda',(()=>{const k=z({top:{id:'vestido',color:'#444'}});return k.camisa==='#444'&&k.pantalon==='#444'&&k.pantaloneta;})()],
 ['la policía: chaleco reflectivo y mangas azules',(()=>{const k=z(uniformeDe());return k.camisa==='#c6e83a'&&k.antebrazo==='#24406b'&&!k.pantaloneta;})()]];
for(const [n,ok] of casos)if(!ok)falla('ropa por zonas: '+n,{});
console.log(`personajes · ${looks} looks (${quienes.hombre} hombres, ${quienes.mujer} mujeres) · contexturas: ${Object.entries(cuenta).map(([k,n])=>`${k} ${(100*n/looks).toFixed(0)} %`).join(', ')} · ${prendas.size} prendas · ${casos.length} reglas de ropa por zonas`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(fallas.size?1:0);

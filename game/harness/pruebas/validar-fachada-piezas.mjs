// Valida que el plano y el 3D ponen LO MISMO en cada módulo de cada fachada (2026-11-21, engine/fachada-piezas.js):
// se arma la ciudad en 3D sin pantalla (lib/town3d.js anota lo que pone en cada módulo: fachadaArmada) y se compara,
// módulo por módulo, con lo que dice el plano (modulosDeFachada).
//  · los mismos módulos (casilla, lado, módulo y piso), ni uno de más ni uno de menos;
//  · en cada uno, el mismo tipo y la misma pieza;
//  · en el plano, cada casilla·lado·módulo·piso aparece una sola vez, y toda ventana doble tiene su otra mitad al lado.
// Uso: node harness/pruebas/validar-fachada-piezas.mjs [ciudades=2] [semilla0=1] [equipo=3]
await import('./sin-pantalla.mjs');
const {generateBlueprint}=await import('../../src/engine/blueprint.js'),{buildWorld}=await import('../../src/lib/world3d.js'),{modulosDeFachada,VENTANAL}=await import('../../src/engine/fachada-piezas.js');
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),T=+(process.argv[4]||3);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const clave=m=>`${m.lote}|${m.x},${m.y}|${m.dx},${m.dy}|${m.k}|${m.f}`;let total=0;const tipos={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:T}),w=buildWorld(bp.map,{plan:bp,downtown:{pieces:{}}}),armada=new Map(w.fachadaArmada.map(m=>[clave(m),m])),plano=new Map();
 for(const L of bp.lots)for(const m of modulosDeFachada(bp,L)){const k=clave(m);if(plano.has(k))falla('el plano repite un módulo',{ciudad:s,k});plano.set(k,m);tipos[m.tipo]=(tipos[m.tipo]||0)+1;}
 total+=plano.size;
 for(const [k,m] of plano){const a=armada.get(k);if(!a){falla('el plano tiene un módulo que el 3D no arma',{ciudad:s,k,tipo:m.tipo});continue;}
  if(a.tipo!==m.tipo)falla('distinto tipo en un módulo',{ciudad:s,k,plano:m.tipo,armado:a.tipo});
  // (el ventanal: el 3D le pone el nombre de su pieza según el material; en el plano es «ventanal»)
  else if((a.pieza||null)!==(m.pieza||null)&&!(m.pieza===VENTANAL&&String(a.pieza).startsWith('LP_Ventanal_')))falla('distinta pieza en un módulo',{ciudad:s,k,plano:m.pieza,armado:a.pieza});
  if(m.tipo==='doble'&&plano.get(`${m.lote}|${m.x},${m.y}|${m.dx},${m.dy}|${m.k+1}|${m.f}`)?.tipo!=='doble2')falla('una ventana doble sin su otra mitad',{ciudad:s,k});}
 for(const [k,a] of armada)if(!plano.has(k))falla('el 3D arma un módulo que el plano no tiene',{ciudad:s,k,tipo:a.tipo});}
console.log(`fachada piezas · ${N} ciudades de ${T} · ${total.toLocaleString('es-CO')} módulos comparados entre el plano y el 3D`);
console.log('  '+Object.entries(tipos).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);

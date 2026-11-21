// Valida que el plano y el 3D ponen LO MISMO en cada módulo de cada fachada (2026-11-21, engine/fachada-piezas.js):
// se arma la ciudad en 3D sin pantalla (lib/town3d.js anota lo que pone en cada módulo: fachadaArmada) y se compara,
// módulo por módulo, con lo que dice el plano (modulosDeFachada).
//  · los mismos módulos (casilla, lado, módulo y piso), ni uno de más ni uno de menos;
//  · en cada uno, el mismo tipo y la misma pieza;
//  · en el plano, cada casilla·lado·módulo·piso aparece una sola vez, y toda ventana doble tiene su otra mitad al lado;
//  · lo que ocupa cada módulo (vanoDeModulo) no se sale de su módulo de 2 × 3 m (la doble, de sus dos módulos);
//  · NINGUNA PARED INTERNA CORTA UN VANO: donde un tabique llega a la fachada no hay ventana, puerta ni vidriera;
//  · la medida de cada marco de puerta (PUERTA_VANO) es la de la pieza que arma el 3D (fachada3d.js, con las medidas
//    del .gltf): lo que sobresale del muro —marco y dintel— cabe justo en ese rectángulo.
// Uso: node harness/pruebas/validar-fachada-piezas.mjs [ciudades=2] [semilla0=1] [equipo=3]
await import('./sin-pantalla.mjs');
const {generateBlueprint}=await import('../../src/engine/blueprint.js'),{buildWorld}=await import('../../src/lib/world3d.js'),{modulosDeFachada,VENTANAL,vanoDeModulo,PUERTA_VANO}=await import('../../src/engine/fachada-piezas.js');
const {muroExterior,paredesDeFachada}=await import('../../src/engine/muros.js'),{piezaLowPoly}=await import('../../src/lib/fachada3d.js'),{readFileSync,existsSync}=await import('node:fs');
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),T=+(process.argv[4]||3);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const clave=m=>`${m.lote}|${m.x},${m.y}|${m.dx},${m.dy}|${m.k}|${m.f}`;let total=0,cortes=0;const tipos={};
// los marcos de puerta, contra la pieza armada con las medidas de su .gltf
{const DIR='public/models/downtown/Exports/glTF (Godot)/',medidas=n=>{const f=DIR+n+'.gltf';if(!existsSync(f))return null;const g=JSON.parse(readFileSync(f,'utf8')),M={};let X=[1e9,-1e9],Y=[1e9,-1e9];
  for(const m of g.meshes)for(const p of m.primitives){const mat=g.materials[p.material]?.name||'?';if(mat.startsWith('MI_FakeInterior'))continue;const a=g.accessors[p.attributes.POSITION],B=M[mat]||(M[mat]={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]});for(let i=0;i<3;i++){B.min[i]=Math.min(B.min[i],a.min[i]);B.max[i]=Math.max(B.max[i],a.max[i]);}X=[Math.min(X[0],a.min[0]),Math.max(X[1],a.max[0])];Y=[Math.min(Y[0],a.min[1]),Math.max(Y[1],a.max[1])];}M.__x=X;M.__y=Y;return M;};
 for(const [n,V] of Object.entries(PUERTA_VANO)){const M=medidas(n);if(!M){falla('marco de puerta sin su .gltf',{n});continue;}const C=piezaLowPoly(n,M).filter(c=>c.z1>.001&&c.mat!=='MI_Zocalo'),b=[Math.min(...C.map(c=>c.x0)),Math.max(...C.map(c=>c.x1)),0,Math.max(...C.map(c=>c.y1))];
  if(b[0]<V[0]-.03||b[1]>V[1]+.03||b[3]>V[3]+.03)falla('el marco de una puerta se sale de la medida del plano',{n,pieza:b.map(v=>+v.toFixed(2)),plano:V});if(b[0]>V[0]+.06||b[1]<V[1]-.06||b[3]<V[3]-.06)falla('la medida del plano es más grande que el marco de la puerta',{n,pieza:b.map(v=>+v.toFixed(2)),plano:V});}}
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:T}),w=buildWorld(bp.map,{plan:bp,downtown:{pieces:{}}}),armada=new Map(w.fachadaArmada.map(m=>[clave(m),m])),plano=new Map();
 for(const L of bp.lots)for(const m of modulosDeFachada(bp,L)){const k=clave(m);if(plano.has(k))falla('el plano repite un módulo',{ciudad:s,k});plano.set(k,m);tipos[m.tipo]=(tipos[m.tipo]||0)+1;}
 total+=plano.size;
 for(const [k,m] of plano){const a=armada.get(k);if(!a){falla('el plano tiene un módulo que el 3D no arma',{ciudad:s,k,tipo:m.tipo});continue;}
  if(a.tipo!==m.tipo)falla('distinto tipo en un módulo',{ciudad:s,k,plano:m.tipo,armado:a.tipo});
  // (el ventanal: el 3D le pone el nombre de su pieza según el material; en el plano es «ventanal»)
  else if((a.pieza||null)!==(m.pieza||null)&&!(m.pieza===VENTANAL&&String(a.pieza).startsWith('LP_Ventanal_')))falla('distinta pieza en un módulo',{ciudad:s,k,plano:m.pieza,armado:a.pieza});
  {const v=vanoDeModulo(m);if(v&&(v[0]<-1.001||v[1]>(m.tipo==='doble'?3.001:1.001)||v[3]>3.001||v[1]<=v[0]||v[3]<=v[2]))falla('lo que ocupa un módulo se sale de su módulo',{ciudad:s,k,tipo:m.tipo,v});}
  if(m.tipo==='doble'&&plano.get(`${m.lote}|${m.x},${m.y}|${m.dx},${m.dy}|${m.k+1}|${m.f}`)?.tipo!=='doble2')falla('una ventana doble sin su otra mitad',{ciudad:s,k});}
 for(const [k,a] of armada)if(!plano.has(k))falla('el 3D arma un módulo que el plano no tiene',{ciudad:s,k,tipo:a.tipo});
 // ninguna pared interna corta un vano
 for(const L of bp.lots){if(!L.levels?.length)continue;for(const lado of ['N','S','E','W']){const F=muroExterior(L,lado);for(const p of paredesDeFachada(L,lado)){if(p.u0<=1e-6)continue;cortes++;
   const h=F.huecos.find(q=>q.clase!=='zocalo'&&p.u0>q.u0+.02&&p.u0<q.u1-.02&&q.y1>p.y0+.05&&q.y0<p.y0+p.alto-.05);if(h)falla('una pared interna corta un vano',{ciudad:s,lote:L.id,lado,piso:p.nivel,en:p.u0,vano:[h.u0,h.u1,h.clase]});}}}}
console.log(`fachada piezas · ${N} ciudades de ${T} · ${total.toLocaleString('es-CO')} módulos comparados entre el plano y el 3D · ${cortes.toLocaleString('es-CO')} cortes de pared interna, ninguno sobre un vano salvo fallas`);
console.log('  '+Object.entries(tipos).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);

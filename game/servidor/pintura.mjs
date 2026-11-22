// LO PINTADO, EN UNA BASE (2026-11-21, Miguel: «si quieres usa sqlite»). Hasta acá el pixel art vivía en el navegador
// ('fuga.grafitis'): se perdía al cambiar de navegador y nadie más lo veía. Esto es lo mismo en un archivo SQLite
// (game/datos/pintura.sqlite, fuera de git), con el SQLite que trae node (node:sqlite), sin dependencias:
//   · ciudad:   una fila por ciudad (semilla|jugadores) con la versión de sus paredes (engine/grafiti.js versionDeParedes);
//   · pared:    una fila por pared pintada: su número de 10 cifras, su huella, la grilla y los píxeles (el texto RLE);
//   · huerfana: lo pintado sobre una pared que ya no existe, apartado con la versión en que se perdió (no se borra).
// No arma el plano: guarda y devuelve. Quién concilia números y huellas es el motor (conciliar), del lado de quien tiene
// el plano; acá sólo se valida la FORMA de lo que llega (número, huella, grilla, y que el texto llene esa grilla).
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {deTexto,GRAFITI} from '../src/engine/grafiti.js';

// (píxeles por lado de una pared, letras del texto, paredes por pedido y bytes del pedido. Una conciliación va en UN pedido
// —mudar y apartar son todo o nada— y la ciudad más grande tiene 26.764 paredes pintables: con 2.000 por pedido, la de 720 m
// con 2.974 pintadas no entraba —validar-guardado, equipo 16—)
export const LIMITE={lado:4000,texto:400000,cambios:60000,bytes:64e6};
const ES={ciudad:/^\d{1,9}\|\d{1,3}$/,numero:/^\d{10}$/,huella:/^[0-9a-f]{16}$/,version:/^[0-9a-f]{16}$/};
// La forma de una pared pintada: null si está bien, o la razón.
export function revisar(numero,s){if(!ES.numero.test(String(numero)))return 'El número de pared no tiene 10 cifras.';if(!s||typeof s!=='object')return 'Falta lo pintado.';
 if(!ES.huella.test(String(s.h||'')))return 'Falta la huella de la pared.';if(!Number.isInteger(s.cols)||!Number.isInteger(s.rows)||s.cols<1||s.rows<1||s.cols>LIMITE.lado||s.rows>LIMITE.lado)return 'La grilla no es válida.';
 if(typeof s.t!=='string'||s.t.length>LIMITE.texto)return 'Lo pintado es demasiado largo.';const g=deTexto(s.t,s.cols,s.rows);if(!g)return 'Lo pintado no llena la grilla de esa pared.';
 for(let i=0;i<g.d.length;i++)if(g.d[i]>=GRAFITI.paleta.length)return 'Hay un color que no está en la paleta.';return null;}

export function abrir(ruta){if(ruta!==':memory:')mkdirSync(path.dirname(ruta),{recursive:true});const db=new DatabaseSync(ruta);
 db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS ciudad(clave TEXT PRIMARY KEY,version TEXT NOT NULL,paredes INTEGER NOT NULL,actualizada TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pared(ciudad TEXT NOT NULL,numero TEXT NOT NULL,huella TEXT NOT NULL,cols INTEGER NOT NULL,rows INTEGER NOT NULL,datos TEXT NOT NULL,pixeles INTEGER NOT NULL,actualizada TEXT NOT NULL,PRIMARY KEY(ciudad,numero)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS huerfana(id INTEGER PRIMARY KEY,ciudad TEXT NOT NULL,numero TEXT NOT NULL,huella TEXT NOT NULL,cols INTEGER NOT NULL,rows INTEGER NOT NULL,datos TEXT NOT NULL,version TEXT,desde TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS huerfana_ciudad ON huerfana(ciudad,huella);`);
 const q={ciudad:db.prepare('SELECT version,paredes,actualizada FROM ciudad WHERE clave=?'),paredes:db.prepare('SELECT numero,huella,cols,rows,datos FROM pared WHERE ciudad=?'),una:db.prepare('SELECT numero,huella,cols,rows,datos FROM pared WHERE ciudad=? AND numero=?'),
  pone:db.prepare('INSERT INTO pared(ciudad,numero,huella,cols,rows,datos,pixeles,actualizada) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ciudad,numero) DO UPDATE SET huella=excluded.huella,cols=excluded.cols,rows=excluded.rows,datos=excluded.datos,pixeles=excluded.pixeles,actualizada=excluded.actualizada'),
  quita:db.prepare('DELETE FROM pared WHERE ciudad=? AND numero=?'),aparta:db.prepare('INSERT INTO huerfana(ciudad,numero,huella,cols,rows,datos,version,desde) VALUES(?,?,?,?,?,?,?,?)'),
  huerfanas:db.prepare('SELECT COUNT(*) n FROM huerfana WHERE ciudad=?'),version:db.prepare('INSERT INTO ciudad(clave,version,paredes,actualizada) VALUES(?,?,?,?) ON CONFLICT(clave) DO UPDATE SET version=excluded.version,paredes=excluded.paredes,actualizada=excluded.actualizada')};
 const pixeles=(s)=>{const g=deTexto(s.t,s.cols,s.rows);let n=0;for(let i=0;i<g.d.length;i++)if(g.d[i])n++;return n;};
 return {
  // Lo pintado de una ciudad: {version, paredes: {numero: {h, cols, rows, t}}, huerfanas: cuántas hay apartadas}.
  leer(clave){if(!ES.ciudad.test(String(clave)))return {error:'Esa ciudad no es válida.'};const c=q.ciudad.get(clave),paredes={};for(const r of q.paredes.all(clave))paredes[r.numero]={h:r.huella,cols:r.cols,rows:r.rows,t:r.datos};
   return {ciudad:clave,version:c?.version||null,total:c?.paredes||0,paredes,huerfanas:q.huerfanas.get(clave).n};},
  // Un pedido: {version?, total?, cambios: {numero: pared | null (borrar)}, mudadas: [{de, a}], huerfanas: [numero]}.
  // Todo o nada: si una pared viene mal, no se guarda ninguna.
  guardar(clave,{version=null,total=0,cambios={},mudadas=[],huerfanas=[]}={},ahora=new Date().toISOString()){
   if(!ES.ciudad.test(String(clave)))return {ok:false,razon:'Esa ciudad no es válida.'};if(version!=null&&!ES.version.test(String(version)))return {ok:false,razon:'La versión no es válida.'};
   const E=Object.entries(cambios||{});if(E.length+mudadas.length+huerfanas.length>LIMITE.cambios)return {ok:false,razon:'Demasiadas paredes en un pedido.'};
   for(const [n,s] of E)if(s!==null){const mal=revisar(n,s);if(mal)return {ok:false,razon:mal,numero:n};}else if(!ES.numero.test(n))return {ok:false,razon:'El número de pared no tiene 10 cifras.',numero:n};
   for(const m of mudadas)if(!ES.numero.test(String(m?.de))||!ES.numero.test(String(m?.a)))return {ok:false,razon:'Una mudanza no es válida.'};
   for(const n of huerfanas)if(!ES.numero.test(String(n)))return {ok:false,razon:'Una huérfana no es válida.'};
   const antes=q.ciudad.get(clave)?.version||null,r={ok:true,guardadas:0,borradas:0,mudadas:0,apartadas:0};
   db.exec('BEGIN');try{
    // (primero se apartan y se sacan las que dejan su número: una mudanza puede caer en un número que otra deja libre)
    for(const n of huerfanas){const p=q.una.get(clave,n);if(!p)continue;q.aparta.run(clave,n,p.huella,p.cols,p.rows,p.datos,antes,ahora);q.quita.run(clave,n);r.apartadas++;}
    for(const m of mudadas){if(q.una.get(clave,m.de)){q.quita.run(clave,m.de);r.mudadas++;}}
    for(const [n,s] of E){if(s===null){r.borradas+=Number(q.quita.run(clave,n).changes);}else{q.pone.run(clave,n,s.h,s.cols,s.rows,s.t,pixeles(s),ahora);r.guardadas++;}}
    if(version)q.version.run(clave,version,total|0,ahora);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');return {ok:false,razon:'No se pudo guardar: '+e.message};}
   return r;},
  cerrar(){db.close();}};}

// El pedido HTTP (lo usa el servidor de desarrollo, vite.config.js): GET /api/pintura?ciudad=1|3 · POST /api/pintura {ciudad, …}
export function atender(base){return (req,res,next)=>{const u=new URL(req.url,'http://x');if(u.pathname!=='/api/pintura')return next();
 const di=(c,o)=>{res.statusCode=c;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify(o));};
 if(req.method==='GET'){const r=base.leer(u.searchParams.get('ciudad'));return di(r.error?400:200,r);}
 if(req.method!=='POST')return di(405,{ok:false,razon:'Sólo GET y POST.'});
 let t='',pasa=false;req.on('data',d=>{t+=d;if(t.length>LIMITE.bytes){pasa=true;req.destroy();}});req.on('end',()=>{if(pasa)return;let o;try{o=JSON.parse(t);}catch{return di(400,{ok:false,razon:'El pedido no es JSON.'});}
  const r=base.guardar(o?.ciudad,o||{});di(r.ok?200:400,r);});};}

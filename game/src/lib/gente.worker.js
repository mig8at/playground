/* Armar la gente fuera del hilo principal (2026-10-14). Recibe trabajos {id, body, outfit}, viste a cada persona con el
   vestier (makeDressable + dress) y arma sus versiones de lejos; devuelve sólo los números de las geometrías (se
   transfieren, no se copian). El esqueleto y las animaciones son iguales para todos los cuerpos (medido): el hilo
   principal arma uno y cada persona es una copia con su geometría. */
import {makeDressable} from './vestier3d.js';

const pack=(g,buffers)=>{const out={attrs:{},morph:null,userData:{wardrobeParts:g.userData.wardrobeParts,jointTris:g.userData.jointTris,dressed:g.userData.dressed}};
 for(const [k,a] of Object.entries(g.attributes)){out.attrs[k]={array:a.array,itemSize:a.itemSize};buffers.push(a.array.buffer);}
 const m=g.morphAttributes.position?.[0];if(m){out.morph={array:m.array,name:m.name};buffers.push(m.array.buffer);}return out;};

self.onmessage=async e=>{
 for(const job of e.data.jobs){
  try{const p=await makeDressable(job.body),g=p.dress(job.outfit),lods=job.lods?await p.lods(job.lods):[],buffers=[];
   // (copias: dress y lods comparten arreglos con la persona que se libera abajo)
   const full=pack(g.clone(),buffers),low=lods.map(l=>pack(l.clone(),buffers));
   self.postMessage({id:job.id,full,lods:low},buffers);p.release();}
  catch(err){self.postMessage({id:job.id,error:String(err?.stack||err)});}}
 self.postMessage({done:true});};

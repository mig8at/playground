// La ropa en palabras (2026-10-17, el menú del juego): lo que dice un retrato —«sudadera con capucha roja, jean azul,
// gorra negra»—. El nombre de cada prenda es el del vestier (GARMENTS); el del color, el más parecido de una lista corta.
import {GARMENTS} from './vestier3d.js';

const COLORES=[['blanca','#f2f0ea'],['gris','#9a9c9c'],['negra','#2a2b2d'],['roja','#c4553d'],['vinotinto','#7a2e33'],['naranja','#d9793a'],['amarilla','#e0b83a'],
 ['verde','#4f8a55'],['verde oliva','#6b7340'],['turquesa','#3a9a96'],['celeste','#7fb2d6'],['azul','#3f6fa8'],['azul oscuro','#2b3d5c'],['morada','#6b4a8a'],['rosada','#d98aa0'],
 ['café','#6e4e35'],['beige','#c8b48f'],['verde limón','#c6e83a']];
const rgb=h=>{const n=parseInt(String(h).replace('#','').padEnd(6,'0').slice(0,6),16);return [(n>>16)&255,(n>>8)&255,n&255];};
export function nombreColor(hex){if(!hex)return '';const [r,g,b]=rgb(hex);let best='',bd=1e9;for(const [n,h] of COLORES){const [R,G,B]=rgb(h),d=(r-R)**2+(g-G)**2+(b-B)**2;if(d<bd){bd=d;best=n;}}return best;}
// (el color concuerda con la prenda: «jean azul», no «jean azula»: los nombres de prenda en masculino cambian -a por -o)
const MASC=new Set(['jean','pantalon','deportivo','cargo','leggings','overol','chaleco','abrigo','delantal','gorro-lana','tenis','zapatos','short','bermuda','pantaloneta']);
const conGenero=(id,c)=>MASC.has(id)?c.replace(/a$/,'o').replace(/a (\w+)$/,'o $1').replace('morado','morado'):c;
export const etiqueta=id=>GARMENTS.find(g=>g.id===id)?.label||id;
const ORDEN=['outer','top','bottom','hat','shoes'];
// la ropa a la vista (sin la interior), en el orden en que se la ve
export function describirRopa(outfit){if(!outfit)return 'sin datos';const out=[];
 for(const k of ORDEN){const p=outfit[k];if(!p?.id)continue;const c=nombreColor(p.color);out.push(`${etiqueta(p.id).toLowerCase()}${c?' '+conGenero(p.id,c):''}`);}
 return out.join(', ')||'sin datos';}

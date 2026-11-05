// El montaje de un video (videos/<video>.json): sus cortes de las tomas grabadas, con su color, los textos con sus fundidos
// y la banda sonora. Uso: node promo/montaje.mjs [video=trailer] → out/<video>.mp4 (1920×1080, H.264 + AAC).
// Necesita: las tomas (.work/tomas), los textos (textos.mjs) y la banda (audio.mjs).
import {execFileSync} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';
import {TOMAS,TEXTOS,CORTES,BANDA,VIDEOS,OUT,WORK} from './rutas.mjs';
const VIDEO=process.argv[2]||'trailer',DEF=JSON.parse(readFileSync(join(VIDEOS,VIDEO+'.json'),'utf8'));
const FPS=DEF.fps||30,DUR=DEF.duracion,TMP=join(CORTES,VIDEO);mkdirSync(TMP,{recursive:true});mkdirSync(OUT,{recursive:true});
// el color: noche (fría, contrastada, con viñeta), noche oscura (más luz) y día (algo apagado, para no desentonar)
const COLOR={NOCHE:'eq=contrast=1.08:brightness=0.01:saturation=1.08:gamma=1.05,colorbalance=bs=.06:bm=.03:rs=-.02,vignette=PI/5',
 NOCHE_OSC:'eq=contrast=1.1:brightness=0.05:saturation=1.1:gamma=1.25,colorbalance=bs=.07:bm=.03,vignette=PI/5',
 DIA:'eq=contrast=1.05:saturation=.88:gamma=.97,vignette=PI/6'};
const ff=args=>execFileSync('ffmpeg',['-v','error','-y',...args]);
// 1) cada corte, a su clip
let total=0;const lista=[],faltan=[];
// (la escena va aparte: los cortes tienen de 4 a 6 campos)
const cortes=DEF.escenas.flatMap(e=>e.cortes.map(c=>({c,escena:e.nombre})));
for(const [i,{c:[n,dir,ini,cant,dig=5,color='NOCHE'],escena}] of cortes.entries()){const k=cant||Math.round(DUR*FPS)-total,out=join(TMP,`${String(i).padStart(2,'0')}_${n}.mp4`);
 if(!dir)ff(['-f','lavfi','-i',`color=c=black:s=1920x1080:r=${FPS}`,'-frames:v',String(k),'-pix_fmt','yuv420p','-c:v','libx264','-crf','16',out]);
 else{const pat=join(TOMAS,dir,`%0${dig}d.jpg`),primero=join(TOMAS,dir,String(ini).padStart(dig,'0')+'.jpg');
  if(!existsSync(primero)){faltan.push(`${n} (${dir}, cuadro ${ini})`);continue;}
  ff(['-framerate',String(FPS),'-start_number',String(ini),'-i',pat,'-frames:v',String(k),'-vf',`${COLOR[color]||color},format=yuv420p`,'-c:v','libx264','-crf','16',out]);}
 lista.push(out);total+=k;console.log(`corte ${n.padEnd(9)} ${escena.padEnd(18)} hasta ${(total/FPS).toFixed(2)} s`);}
if(faltan.length){console.log('faltan tomas: '+faltan.join(', ')+'. Grábalas primero.');process.exit(1);}
writeFileSync(join(TMP,'lista.txt'),lista.map(f=>`file '${f}'`).join('\n'));
ff(['-f','concat','-safe','0','-i',join(TMP,'lista.txt'),'-c','copy',join(TMP,'imagen.mp4')]);
// 2) los textos encima (cada uno con su fundido) y 3) la banda sonora
const ins=['-i',join(TMP,'imagen.mp4')];let fc='',ult='0:v';
DEF.textos.forEach(({id,desde:a,hasta:b,fundido:f},i)=>{const png=join(TEXTOS,VIDEO,id+'.png');if(!existsSync(png)){console.log('falta el texto',id,'(textos.mjs)');process.exit(1);}
 ins.push('-loop','1','-t',String(DUR),'-i',png);const s=i+1;
 fc+=`[${s}:v]format=rgba,fade=t=in:st=${a}:d=${f}:alpha=1,fade=t=out:st=${Math.max(a+f,b-f).toFixed(3)}:d=${f}:alpha=1[t${s}];[${ult}][t${s}]overlay=enable='between(t,${a},${b})'[v${s}];`;ult=`v${s}`;});
fc+=`[${ult}]fade=t=in:st=${DEF.fundidoInicial??0}:d=0.8[vf]`;
const banda=DEF.banda?join(WORK,DEF.banda):null;if(banda&&!existsSync(banda)){console.log('falta la banda sonora (audio.mjs)');process.exit(1);}
const salida=join(OUT,VIDEO+'.mp4');
ff([...ins,...(banda?['-i',banda]:[]),'-filter_complex',fc,'-map','[vf]',...(banda?['-map',`${DEF.textos.length+1}:a`,'-c:a','aac','-b:a','192k']:[]),'-t',String(DUR),'-c:v','libx264','-crf','18','-preset','slow','-pix_fmt','yuv420p','-movflags','+faststart',salida]);
console.log('video listo:',salida,`(${(total/FPS).toFixed(2)} s)`);

// La banda sonora del tráiler (45 s), sintetizada —sin música con derechos—: viento, ciudad, sirenas, un dron oscuro con
// pulso que acelera, pasos, golpes en los cortes, la subida que se corta en seco a los 37,6 s y el impacto del título.
// Uso: node promo/audio.mjs → .work/banda.wav (estéreo, 48 kHz). Los tiempos son los de videos/trailer.json.
import {writeFileSync,mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {BANDA} from './rutas.mjs';
const SR=48000,DUR=45,N=SR*DUR,L=new Float32Array(N),R=new Float32Array(N);
let seed=12345;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296)*2-1;
const env=(t,a,b,fi=.5,fo=.5)=>t<a||t>b?0:Math.min(1,(t-a)/fi,(b-t)/fo);
const add=(i,v,pan=0)=>{L[i]+=v*(1-Math.max(0,pan));R[i]+=v*(1+Math.min(0,pan));};
const lp=c=>{let y=0;return x=>y+=c*(x-y);};// (filtro de un polo)
// viento: ruido filtrado con ráfagas
{const f1=lp(.02),f2=lp(.01);for(let i=0;i<N;i++){const t=i/SR,g=(.55+.45*Math.sin(t*.7)*Math.sin(t*.23+1))*(env(t,0,9,2,3)+env(t,8,38,1,2)*.25+env(t,38,45,.5,3)*.35);
 add(i,f2(f1(rnd()))*6*g*.5,Math.sin(t*.3)*.5);}}
// ciudad: rumor grave
{const f=lp(.004);for(let i=0;i<N;i++){const t=i/SR;add(i,f(rnd())*14*env(t,.3,30,2,4)*.6);}}
// sirena (wail), de lejos al principio y cerca en la persecución, con eco
const sirena=(a,b,vol,pan,lpc)=>{const f=lp(lpc);let ph=0;for(let i=Math.floor(a*SR);i<Math.min(N,b*SR);i++){const t=i/SR,fr=850+380*Math.sin(2*Math.PI*.32*(t-a));ph+=2*Math.PI*fr/SR;
  const v=f(Math.sin(ph)+.3*Math.sin(2*ph))*vol*env(t,a,b,1.2,1.2);add(i,v,pan);const j=i+Math.floor(.23*SR);if(j<N)add(j,v*.35,-pan);}};
sirena(1.5,8.5,.11,-.6,.05);sirena(9,17.5,.2,.4,.12);sirena(30.5,37.6,.22,-.3,.15);
// el dron: graves desafinados que crecen hasta el corte
for(let i=0;i<N;i++){const t=i/SR;let g=env(t,.5,37.6,4,.01)*(.35+.65*Math.min(1,t/37));if(t>=37.6)g=0;
 const s=Math.sin(2*Math.PI*55*t)+.7*Math.sin(2*Math.PI*55.6*t)+.5*Math.sin(2*Math.PI*82.4*t)+.25*Math.sin(2*Math.PI*110.3*t)*(t>18?1:.3)+.12*Math.sin(2*Math.PI*233.1*t)*(t>8?Math.min(1,(t-8)/10):0);
 add(i,s*g*.12);}
// golpe: bombo grave con su chasquido
const golpe=(t0,vol=1,dec=6,f0=58)=>{for(let k=0;k<SR*1.6;k++){const i=Math.floor(t0*SR)+k;if(i>=N)break;const t=k/SR,e=Math.exp(-t*dec),f=f0*(1+1.5*Math.exp(-t*30));
  add(i,(Math.sin(2*Math.PI*f*t)*e+rnd()*Math.exp(-t*60)*.5)*vol*.55);}};
// el pulso (latido) que acelera: 90, 118 y 140 por minuto
const pulso=(a,b,bpm,vol)=>{for(let t=a;t<b;t+=60/bpm){golpe(t,vol,9,52);golpe(t+.18,vol*.55,11,50);}};
pulso(8,18,90,.45);pulso(18,30,118,.5);pulso(30,37.4,140,.62);
for(const t of [8,18,20.5,22.5,24.5,26.5,28.5])golpe(t,1.1,4,48);// los cortes de la escena 3
for(const t of [30.4,32.2,34.0,35.8])golpe(t,1.35,3.5,46);// las palabras de la escena 4
// pasos rápidos en la persecución
const pasos=(a,b,ritmo,vol)=>{const f=lp(.25);for(let t=a;t<b;t+=1/ritmo)for(let k=0;k<SR*.05;k++){const i=Math.floor(t*SR)+k;if(i>=N)break;add(i,f(rnd())*Math.exp(-k/SR*90)*vol,(t*7%2)-1);}};
pasos(9.5,11,6,.5);pasos(13.6,15,6.5,.5);pasos(30.2,37.5,7,.45);
// la subida: ruido que abre y un tono que sube, hasta el corte seco
{let ph=0;const f=lp(.01);for(let i=Math.floor(33*SR);i<37.6*SR;i++){const t=i/SR,u=(t-33)/4.6;ph+=2*Math.PI*(120+900*u*u)/SR;const c=.01+.4*u*u;add(i,((f(rnd())*(1-c)+rnd()*c)*.35+Math.sin(ph)*.12)*u*u);}}
// el impacto del título: un golpe enorme, la caída del grave y su cola; y un tono oscuro bajo la pregunta
golpe(39.2,2.2,1.6,40);for(let i=Math.floor(39.2*SR);i<N;i++){const t=i/SR-39.2,f=62*Math.exp(-t*.25)+28;add(i,Math.sin(2*Math.PI*f*t)*Math.exp(-t*.6)*.5);}
for(let i=Math.floor(40.5*SR);i<N;i++){const t=i/SR;add(i,(Math.sin(2*Math.PI*73.4*t)+.5*Math.sin(2*Math.PI*110*t))*env(t,40.5,45,1.5,2.5)*.1);}
// reverberación (Schroeder) y la mezcla, con el silencio del corte (37,6 a 39,2: ni la cola)
const rev=x=>{const out=new Float32Array(N),combs=[1557,1617,1491,1422].map(d=>({d,b:new Float32Array(d),i:0}));for(let n=0;n<N;n++){let s=0;for(const c of combs){const y=c.b[c.i];c.b[c.i]=x[n]+y*.82;c.i=(c.i+1)%c.d;s+=y;}out[n]=s*.25;}return out;};
const RL=rev(L),RR=rev(R);let pico=0;const O=new Float32Array(N*2);
for(let n=0;n<N;n++){const t=n/SR,mute=t>=37.6&&t<39.2?0:1,l=Math.tanh((L[n]+RL[n]*.35)*1.2)*mute,r=Math.tanh((R[n]+RR[n]*.35)*1.2)*mute;O[2*n]=l;O[2*n+1]=r;pico=Math.max(pico,Math.abs(l),Math.abs(r));}
const g=.89/pico,buf=Buffer.alloc(44+N*4);
buf.write('RIFF',0);buf.writeUInt32LE(36+N*4,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(SR,24);buf.writeUInt32LE(SR*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(N*4,40);
for(let k=0;k<N*2;k++)buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,O[k]*g))*32767),44+k*2);
mkdirSync(dirname(BANDA),{recursive:true});writeFileSync(BANDA,buf);console.log('banda sonora',DUR,'s →',BANDA);

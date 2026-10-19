// ======== Caras que titilan (z-fighting) — 2026-10-16, Miguel: «mucho ruido al moverme, un parpadeo incómodo» ========
// titilan(cajas): los pares de cajas de distinto material (o color) con una cara en el MISMO plano, mirando al mismo
// lado y pisándose (más de 2 × 2 mm): la GPU no sabe cuál va delante y las alterna al mover la cámara. Cajas alineadas
// a los ejes {x0,x1,y0,y1,z0,z1, mat}; soloY: la caja sólo cuenta por sus caras de arriba y abajo (un cilindro). Puro.
const EJES=[['x','y','z'],['y','x','z'],['z','x','y']];
// suelos: alturas de pisos (las caras de abajo apoyadas en ellos no se ven: ni se comparan)
export function titilan(C,{tol=1e-4,min=.002,max=200,ocultas=true,suelo=0,suelos=[]}={}){const out=[];
 // (por planos: cada cara cae en el balde de su eje, su lado y su coordenada redondeada a tol; sólo se comparan las del
 // mismo balde y del vecino. La celda de 1 m, sólo para ver si otra caja tapa la cara)
 const baldes=new Map(),q=v=>Math.round(v/tol);
 C.forEach((b,n)=>{for(const [k] of EJES){if(k!=='y'&&b.soloY)continue;for(const l of ['0','1']){const key=k+l+q(b[k+l]);(baldes.get(key)||baldes.set(key,[]).get(key)).push(n);}}});
 let celdas=null;const key=(i,j,k)=>i+','+j+','+k;
 const cerca=P=>{if(!celdas){celdas=new Map();C.forEach((b,n)=>{for(let i=Math.floor(b.x0);i<=Math.floor(b.x1);i++)for(let j=Math.floor(b.y0);j<=Math.floor(b.y1);j++)for(let k=Math.floor(b.z0);k<=Math.floor(b.z1);k++){const c=key(i,j,k);(celdas.get(c)||celdas.set(c,[]).get(c)).push(n);}});}
  return celdas.get(key(Math.floor(P.x),Math.floor(P.y),Math.floor(P.z)))||[];};
 const vistos=new Set();
 for(const [kk,lista] of baldes){const k=kk[0],l=kk[1],c0=+kk.slice(2),[,u,v]=EJES.find(e=>e[0]===k);if(k==='y'&&l==='0'&&(c0*tol<=suelo+.003||suelos.some(y=>Math.abs(c0*tol-y)<.004)))continue;
  // (en el balde y el siguiente, por barrido a lo largo de u: sólo los pares que se cruzan en u —en el plano de un piso
  // caen miles de muebles y compararlos todos contra todos tardaba 20 s—)
  const todos=[...new Set([...lista,...(baldes.get(k+l+(c0+1))||[])])].sort((p,r)=>C[p][u+'0']-C[r][u+'0']),propios=new Set(lista),activos=[];
  for(const j of todos){const bj=C[j];for(let m=activos.length-1;m>=0;m--)if(C[activos[m]][u+'1']<=bj[u+'0']+min)activos.splice(m,1);
   for(const i of activos){if(!propios.has(i)&&!propios.has(j))continue;const par=k+l+(i<j?i+'|'+j:j+'|'+i);if(vistos.has(par))continue;vistos.add(par);
   const a=C[i],b=C[j];if(a.mat===b.mat||Math.abs(a[k+l]-b[k+l])>tol)continue;
   const ou=Math.min(a[u+'1'],b[u+'1'])-Math.max(a[u+'0'],b[u+'0']),ov=Math.min(a[v+'1'],b[v+'1'])-Math.max(a[v+'0'],b[v+'0']);
   if(!(ou>min&&ov>min))continue;
   // (si la cara no se ve —apoyada en el suelo, o tapada por otra caja justo del lado de afuera—, no titila: se mira el
   // centro de lo que se pisan, 2 mm hacia afuera)
   // (tapada: el centro y cuatro puntos cerca de las esquinas de lo que se pisan, todos dentro de otras cajas —con un
   // solo punto, el tallo de una planta «tapaba» toda la tierra de la maceta—)
   if(ocultas){const sg=l==='1'?1:-1,u0=Math.max(a[u+'0'],b[u+'0']),u1=Math.min(a[u+'1'],b[u+'1']),v0=Math.max(a[v+'0'],b[v+'0']),v1=Math.min(a[v+'1'],b[v+'1']);
    if(k==='y'&&sg<0&&a[k+l]<=suelo+.001)continue;
    const tapada=[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].every(([fu,fv])=>{const P={};P[k]=a[k+l]+sg*.002;P[u]=u0+(u1-u0)*fu;P[v]=v0+(v1-v0)*fv;
     return cerca(P).some(ix=>{const c=C[ix];return ix!==i&&ix!==j&&!c.soloY&&P.x>c.x0&&P.x<c.x1&&P.y>c.y0&&P.y<c.y1&&P.z>c.z0&&P.z<c.z1;});});if(tapada)continue;}
   out.push({a:i,b:j,cara:k+l,en:+a[k+l].toFixed(3),mats:[a.mat,b.mat],area:+(ou*ov).toFixed(4)});if(out.length>=max)return out;}
   activos.push(j);}}
 return out;}
// Una pieza del catálogo (objetos3d p(): centro x/z, y = la base, tamaños sx/sy/sz) como caja; null si está girada.
export const cajaDePieza=(q,dx=0,dy=0,dz=0)=>{if((q.ry&&Math.abs(Math.sin(2*q.ry))>1e-6)||q.rx||q.rz)return null;const t=q.ry&&Math.abs(Math.sin(q.ry))>.5;const sx=t?q.sz:q.sx,sz=t?q.sx:q.sz;
 const b={x0:dx+q.x-sx/2,x1:dx+q.x+sx/2,y0:dy+q.y,y1:dy+q.y+q.sy,z0:dz+q.z-sz/2,z1:dz+q.z+sz/2,mat:q.color||q.mat,soloY:!!q.cyl};
 // (una pieza que no es una caja —sin algún tamaño: una esfera, un modelo—, fuera)
 return [b.x0,b.x1,b.y0,b.y1,b.z0,b.z1].every(Number.isFinite)?b:null;};

// sinTitilar(cajas): corrige los pares que da titilan(): la cara de la caja más chica se retira SIN_TITILAR hacia adentro
// de sí misma (queda metida en la otra, o a 3 mm de ella), hasta que no quede ninguno (o tres pasadas). Las cajas con
// fija:true no se mueven. Cambia las cajas en el lugar y devuelve cuántas caras movió.
export const SIN_TITILAR=.003;
const vol=b=>(b.x1-b.x0)*(b.y1-b.y0)*(b.z1-b.z0);
export function sinTitilar(C,opts={}){let n=0;
 for(let pasada=0;pasada<6;pasada++){const P=titilan(C,{...opts,max:1e9});if(!P.length)break;let hechos=0;
  for(const t of P){let a=C[t.a],b=C[t.b];if(a.fija||(!b.fija&&vol(a)>vol(b)))[a,b]=[b,a];if(a.fija)continue;
   // (en una caja fina —las capas de un cuadro—, un cuarto de su espesor. Si la chica está entera dentro de la otra —un
   // vidrio en su marco, un botón en su tablero, una placa— es para verse: su cara sale hacia afuera en vez de hundirse)
   const k=t.cara[0],l=t.cara[1],e=a[k+'1']-a[k+'0'];if(Math.abs(a[k+l]-t.en)>.001||e<4e-4)continue;
   const dentro=['x','y','z'].every(q=>a[q+'0']>=b[q+'0']-1e-6&&a[q+'1']<=b[q+'1']+1e-6),d=Math.min(SIN_TITILAR,e/4);
   a[k+l]+=(l==='0'?1:-1)*(dentro?-d:d);hechos++;}
  n+=hechos;if(!hechos)break;}
 return n;}
// Lo mismo para piezas del catálogo (p(): centro x/z, y la base, tamaños): las giradas no se tocan.
export function piezasSinTitilar(ps,opts={}){const C=ps.map(q=>cajaDePieza(q)),vivas=C.map((c,i)=>c&&{...c,i}).filter(Boolean);if(!vivas.length)return ps;
 sinTitilar(vivas,opts);const por=new Map(vivas.map(v=>[v.i,v]));return ps.map((q,i)=>{const c=por.get(i);if(!c)return q;const t=q.ry&&Math.abs(Math.sin(q.ry))>.5;
  const sx=c.x1-c.x0,sz=c.z1-c.z0;return {...q,x:(c.x0+c.x1)/2,z:(c.z0+c.z1)/2,y:c.y0,sy:c.y1-c.y0,sx:t?sz:sx,sz:t?sx:sz};});}

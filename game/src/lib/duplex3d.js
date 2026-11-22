/* LOS DÚPLEX EN 3D (2026-11-22, Miguel: «sigue con el 3D del dúplex»; el plano lo arma engine/duplex.js). Para cada dúplex
   de un edificio:
   · la escalera privada entre el último piso y la mansarda —de caracol: 14 peldaños en abanico alrededor de un poste, 315°
     de vuelta; recta: 15 peldaños de 20 cm a lo largo de su muro—, sin pasamanos (como las demás desde el 2026-11-22);
   · arriba, los tabiques del baño y del vestidor con sus vanos de puerta, el cierre con lo que no es del departamento
     —el vecino, el pasillo— de piso a cubierta, y un muro bajo (DUPLEX3D.enrase) a lo largo de cada borde del edificio:
     la pendiente de la mansarda baja a 0 en el borde, y ese muro deja el espacio donde ya pasa la cabeza;
   · la física: duplexDeLote(...).surface da el piso de los peldaños y del altillo, y .hueco dice si un punto cae en el
     hueco de una escalera (ahí la losa del último piso no está). world3d floorAt lo consulta.
   Todo son cajas «de adentro» (se dibujan sólo de cerca, como los tabiques) y choques (wallAny). */
import {MANSARDA} from '../engine/medidas.js';
import {pendienteEn} from '../engine/techos.js';

export const DUPLEX3D={enrase:.7,muro:.1,poste:.1,radio:.95,peldano:.05,vuelta:Math.PI*1.75};

export function duplexDeLote(B,L,{box,wallAny,color='#ece6da',FLOOR=3}){
 if(!B?.duplex)return null;const H=MANSARDA.alto,y0=L.h,yb=(L.floors-1)*FLOOR,T=DUPLEX3D.muro,lot=B.rect,esc=[],dentro=[];
 // (¿el borde va sobre la pendiente de la mansarda? —techos.js: sólo los lados de fachada; contra un vecino alto no hay—)
 const enBorde=(h,fija,a0,a1)=>{const m=(a0+a1)/2;return pendienteEn(B.mansarda,h?m:fija,h?fija:m);};
 // un muro de (a0..a1) sobre la línea fija, de yA a yB, menos los vanos [p,q] (puertas)
 const muro=(h,fija,a0,a1,yA,yB,vanos=[],c=color)=>{let a=a0;for(const [p,q] of [...vanos].sort((x,y)=>x[0]-y[0])){if(p>a+.01)tramo(h,fija,a,p,yA,yB,c);a=Math.max(a,q);}if(a1>a+.01)tramo(h,fija,a,a1,yA,yB,c);};
 const tramo=(h,fija,a,b,yA,yB,c)=>{const m=(a+b)/2,l=b-a;if(h){box(m,yA,fija,l,yB-yA,T,c,L.floors);wallAny(a,fija-T/2,b,fija+T/2,yA,yB);}else{box(fija,yA,m,T,yB-yA,l,c,L.floors);wallAny(fija-T/2,a,fija+T/2,b,yA,yB);}};
 for(const u of B.duplex.unidades){const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),zs=u.rooms.flatMap(q=>[q.y,q.y+q.h]),U={x:Math.min(...xs),y:Math.min(...zs),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...zs)-Math.min(...zs)};dentro.push(U);
  // el borde de la unidad: en el borde del edificio, el muro bajo de enrase (corrido hacia adentro); si no, de piso a cubierta
  for(const [h,fija,a0,a1,sg] of [[true,U.y,U.x,U.x+U.w,1],[true,U.y+U.h,U.x,U.x+U.w,-1],[false,U.x,U.y,U.y+U.h,1],[false,U.x+U.w,U.y,U.y+U.h,-1]]){
   if(enBorde(h,fija,a0,a1))muro(h,fija+sg*DUPLEX3D.enrase,a0,a1,y0,y0+H*DUPLEX3D.enrase/MANSARDA.retiro*.98);else muro(h,fija,a0,a1,y0,y0+H);}
  // los tabiques de adentro (baño, vestidor) con sus vanos: el borde que cada uno comparte con el altillo
  const alt=u.rooms.find(q=>q.type==='altillo');
  for(const q of u.rooms){if(q===alt)continue;
   for(const [h,fija,a0,a1] of [[true,q.y,q.x,q.x+q.w],[true,q.y+q.h,q.x,q.x+q.w],[false,q.x,q.y,q.y+q.h],[false,q.x+q.w,q.y,q.y+q.h]]){if(enBorde(h,fija,a0,a1)||(h?Math.abs(fija-U.y)<.05||Math.abs(fija-U.y-U.h)<.05:Math.abs(fija-U.x)<.05||Math.abs(fija-U.x-U.w)<.05))continue;
    const vanos=u.doors.filter(d=>(d.a===q.id||d.b===q.id)&&(h?Math.abs(d.y0-fija)<.05&&Math.abs(d.y1-fija)<.05:Math.abs(d.x0-fija)<.05&&Math.abs(d.x1-fija)<.05)).map(d=>h?[Math.min(d.x0,d.x1),Math.max(d.x0,d.x1)]:[Math.min(d.y0,d.y1),Math.max(d.y0,d.y1)]);
    // (sin altura completa contra la pendiente: hasta la cubierta)
    muro(h,fija,a0,a1,y0,y0+H,vanos.map(([p,q])=>[p,q]),color);if(vanos.length)for(const [p,q] of vanos){const m=(p+q)/2;if(h)box(m,y0+2.1,fija,q-p,H-2.1,T,color,L.floors);else box(fija,y0+2.1,m,T,H-2.1,q-p,color,L.floors);}}}
  // LA ESCALERA, de yb (el piso de abajo) a y0 (la mansarda)
  const E=u.escalera,P=DUPLEX3D.peldano,sube=y0-yb,n=E.peldanos||(E.tipo==='caracol'?14:15),rise=sube/n,cs=[];
  if(E.tipo==='caracol'){const cx=E.x+E.w/2,cz=E.y+E.h/2,R=DUPLEX3D.radio,r0=DUPLEX3D.poste,A=DUPLEX3D.vuelta,da=A/n,len=R-r0,ml=(R+r0)/2,ancho=Math.max(.3,R*da*1.05);
   // (la llegada: el último peldaño apunta al medio del borde por donde sale —E.llegada, el motor la eligió con altura libre—;
   // el pie queda en los 45° libres, al lado)
   const lugar=Math.atan2(E.llegada[1]-cz,E.llegada[0]-cx),a0=lugar-da*(n-.5);
   box(cx,yb,cz,r0*2,sube+.1,r0*2,'#bdb5a6',L.floors-1);wallAny(cx-r0,cz-r0,cx+r0,cz+r0,yb,y0+.1);
   for(let k=0;k<n;k++){const a=a0+da*(k+.5),x=cx+Math.cos(a)*ml,z=cz+Math.sin(a)*ml;cs.push({x,y:yb+rise*(k+1)-P,z,sx:len,sy:P,sz:ancho,color:'#cfc7b8',f:L.floors-1,ry:-a});}
   esc.push({tipo:'caracol',cx,cz,R,r0,a0,da,n,rise,yb,rect:E});}
  else{const ax=E.eje==='x',sg=ax?Math.sign(E.llegada[0]-E.pie[0])||1:Math.sign(E.llegada[1]-E.pie[1])||1,l=ax?E.w:E.h,tread=l/n,o0=ax?(sg>0?E.x:E.x+E.w):(sg>0?E.y:E.y+E.h),cm=ax?E.y+E.h/2:E.x+E.w/2,ancho=ax?E.h:E.w;
   for(let k=0;k<n;k++){const t=o0+sg*tread*(k+.5),top=yb+rise*(k+1);// (macizo hasta el piso: una escalera cerrada de costado)
    cs.push(ax?{x:t,y:yb,z:cm,sx:tread+.005,sy:top-yb,sz:ancho-.02,color:'#cfc7b8',f:L.floors-1}:{x:cm,y:yb,z:t,sx:ancho-.02,sy:top-yb,sz:tread+.005,color:'#cfc7b8',f:L.floors-1});}
   esc.push({tipo:'recta',ax,sg,o0,tread,n,rise,yb,rect:E});}
  for(const c of cs)box(c.x,c.y,c.z,c.sx,c.sy,c.sz,c.color,c.f,c.ry||0);}
 const enRect=(r,x,z)=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h;
 return {nivel:y0,
  // ¿el punto está en el hueco de una escalera? (ahí no hay losa entre el último piso y la mansarda)
  hueco:(x,z)=>esc.some(e=>enRect(e.rect,x,z)),
  // ¿adentro de un dúplex, arriba? (para el piso de la mansarda)
  arriba:(x,z)=>dentro.some(U=>enRect(U,x,z)),
  // el piso de los peldaños bajo (x, z): el más alto a menos de 45 cm sobre los pies, o null (sin la planta baja levantada)
  surface(x,z,feet){for(const e of esc){if(!enRect(e.rect,x,z))continue;let h=null;
    if(e.tipo==='caracol'){const dx=x-e.cx,dz=z-e.cz,r=Math.hypot(dx,dz);if(r<e.r0||r>e.R+.05)continue;let a=Math.atan2(dz,dx)-e.a0;a=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);const k=Math.floor(a/e.da);if(k<e.n)h=e.yb+e.rise*(k+1);}
    else{const t=((e.ax?x:z)-e.o0)*e.sg,k=Math.floor(t/e.tread);if(k>=0&&k<e.n)h=e.yb+e.rise*(k+1);}
    if(h!=null&&h<=feet+.45)return h;}return null;}};}

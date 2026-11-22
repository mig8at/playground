/* LOS DÚPLEX EN 3D (2026-11-22, Miguel: «sigue con el 3D del dúplex»; el plano lo arma engine/duplex.js). Para cada dúplex
   de un edificio:
   · la escalera privada entre el último piso y la mansarda: recta, de 15 peldaños de 20 cm o 12 de 25 cm, de escalones
     flotantes empotrados en su muro y sin pasamanos. El caracol se quitó el mismo día: Miguel, «las escaleras en
     caracol son difíciles de subir»;
   · arriba, un entrepiso abierto (sin cuartos desde el mismo día); el cierre con lo que no es del departamento
     —el vecino, el pasillo— de piso a cubierta; contra la pendiente, ningún muro —la pared es la mansarda con sus
     buhardillas—, sólo un choque a DUPLEX3D.enrase del borde, donde ya no pasa la cabeza;
   · la sala a doble altura: sin losa sobre su vacío; la baranda (DUPLEX3D.baranda: barrotes y pasamanos) en cada borde
     entre el piso de arriba y un hueco —el vacío o la escalera— menos la llegada, con el canto del entrepiso debajo. Miguel:
     «usa barandas»; «que la sala sea de dos pisos y se vea desde abajo la parte de arriba con barandas»;
   · la física: duplexDeLote(...).surface da el piso de los peldaños, .hueco dice si un punto cae en el hueco de una
     escalera (ahí la losa del último piso no está) y .arriba si cae en el nivel de un dúplex. world3d floorAt los consulta.
   Todo son cajas «de adentro» (se dibujan sólo de cerca, como los tabiques) y choques (wallAny). */
import {MANSARDA} from '../engine/medidas.js';
import {pendienteEn,alturaMansarda} from '../engine/techos.js';

export const DUPLEX3D={enrase:.6,muro:.1,canto:.25,flotante:{grueso:.07,luz:.02},baranda:{alto:.95,barrote:.04,poste:1,pasamanos:.05,riel:.03}};

export function duplexDeLote(B,L,{box,wallAny,color='#ece6da',FLOOR=3}){
 if(!B?.duplex)return null;const H=MANSARDA.alto,y0=L.h,yb=(L.floors-1)*FLOOR,T=DUPLEX3D.muro,esc=[],dentro=[],cajasBaranda=[],vacios=B.duplex.unidades.flatMap(u=>u.vacios||[]);
 // (¿el borde va sobre la pendiente de la mansarda? —techos.js: sólo los lados de fachada; contra un vecino alto no hay—)
 const enBorde=(h,fija,a0,a1)=>{const m=(a0+a1)/2;return pendienteEn(B.mansarda,h?m:fija,h?fija:m);};
 // un muro de (a0..a1) sobre la línea fija, de yA a yB, menos los vanos [p,q] (puertas)
 const muro=(h,fija,a0,a1,yA,yB,vanos=[],c=color)=>{let a=a0;for(const [p,q] of [...vanos].sort((x,y)=>x[0]-y[0])){if(p>a+.01)tramo(h,fija,a,p,yA,yB,c);a=Math.max(a,q);}if(a1>a+.01)tramo(h,fija,a,a1,yA,yB,c);};
 const tramo=(h,fija,a,b,yA,yB,c)=>{const m=(a+b)/2,l=b-a;if(h){box(m,yA,fija,l,yB-yA,T,c,L.floors);wallAny(a,fija-T/2,b,fija+T/2,yA,yB);}else{box(fija,yA,m,T,yB-yA,l,c,L.floors);wallAny(fija-T/2,a,fija+T/2,b,yA,yB);}};
 for(const u of B.duplex.unidades){const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),zs=u.rooms.flatMap(q=>[q.y,q.y+q.h]),U={x:Math.min(...xs),y:Math.min(...zs),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...zs)-Math.min(...zs)};dentro.push(U);
  // el borde de la unidad: en el borde del edificio, el muro bajo de enrase (corrido hacia adentro); si no, de piso a cubierta
  for(const [h,fija,a0,a1,sg] of [[true,U.y,U.x,U.x+U.w,1],[true,U.y+U.h,U.x,U.x+U.w,-1],[false,U.x,U.y,U.y+U.h,1],[false,U.x+U.w,U.y,U.y+U.h,-1]]){
   // (sin muro bajo —Miguel, 2026-11-22: «las paredes no deberían ocultar las ventanas de la pared inclinada, deberían ser
   // parte del apartamento; así reducimos polígonos»—: la pared es la pendiente misma, con sus buhardillas. Sólo un choque,
   // sin dibujo, a DUPLEX3D.enrase del borde —donde la pendiente ya no deja pasar la cabeza—, y no sobre el vacío)
   if(enBorde(h,fija,a0,a1)){const f2=fija+sg*DUPLEX3D.enrase,sobre=(u.vacios||[]).filter(v=>h?f2>v.y&&f2<v.y+v.h:f2>v.x&&f2<v.x+v.w).map(v=>h?[v.x,v.x+v.w]:[v.y,v.y+v.h]).sort((p,q)=>p[0]-q[0]);
    let a=a0;const choque=(p,q)=>{if(q-p<.01)return;if(h)wallAny(p,f2-.05,q,f2+.05,y0,y0+H);else wallAny(f2-.05,p,f2+.05,q,y0,y0+H);};for(const [p,q] of sobre){choque(a,Math.min(p,a1));a=Math.max(a,q);}choque(a,a1);}
   else muro(h,fija,a0,a1,y0,y0+H);}
  // los tabiques de adentro (si un día vuelven cuartos arriba) con sus vanos: los bordes que no son del departamento
  for(const q of u.rooms){if(q.abierto)continue;
   for(const [h,fija,a0,a1] of [[true,q.y,q.x,q.x+q.w],[true,q.y+q.h,q.x,q.x+q.w],[false,q.x,q.y,q.y+q.h],[false,q.x+q.w,q.y,q.y+q.h]]){if(enBorde(h,fija,a0,a1)||(h?Math.abs(fija-U.y)<.05||Math.abs(fija-U.y-U.h)<.05:Math.abs(fija-U.x)<.05||Math.abs(fija-U.x-U.w)<.05))continue;
    const vanos=u.doors.filter(d=>(d.a===q.id||d.b===q.id)&&(h?Math.abs(d.y0-fija)<.05&&Math.abs(d.y1-fija)<.05:Math.abs(d.x0-fija)<.05&&Math.abs(d.x1-fija)<.05)).map(d=>h?[Math.min(d.x0,d.x1),Math.max(d.x0,d.x1)]:[Math.min(d.y0,d.y1),Math.max(d.y0,d.y1)]);
    // (sin altura completa contra la pendiente: hasta la cubierta)
    muro(h,fija,a0,a1,y0,y0+H,vanos.map(([p,q])=>[p,q]),color);if(vanos.length)for(const [p,q] of vanos){const m=(p+q)/2;if(h)box(m,y0+2.1,fija,q-p,H-2.1,T,color,L.floors);else box(fija,y0+2.1,m,T,H-2.1,q-p,color,L.floors);}}}
  // LA ESCALERA, de yb (el piso de abajo) a y0 (la mansarda): cada peldaño, macizo hasta el piso
  const E=u.escalera,n=E.peldanos||15,rise=(y0-yb)/n,cs=[],ax=E.eje==='x',sg=ax?Math.sign(E.llegada[0]-E.pie[0])||1:Math.sign(E.llegada[1]-E.pie[1])||1,l=ax?E.w:E.h,tread=l/n,o0=ax?(sg>0?E.x:E.x+E.w):(sg>0?E.y:E.y+E.h),cm=ax?E.y+E.h/2:E.x+E.w/2,ancho=ax?E.h:E.w;
  // (escalones flotantes —Miguel, 2026-11-22: «las escaleras esas que son tipo escalones flotantes»—: cada peldaño, una tabla
  // de DUPLEX3D.flotante.grueso empotrada en el muro, con DUPLEX3D.flotante.luz entre uno y otro y nada debajo. La pisada,
  // la misma: surface)
  const FL=DUPLEX3D.flotante;
  for(let k=0;k<n;k++){const t=o0+sg*tread*(k+.5),top=yb+rise*(k+1),hd=tread-FL.luz;
   cs.push(ax?{x:t,y:top-FL.grueso,z:cm,sx:hd,sy:FL.grueso,sz:ancho-.02,color:'#cfc7b8',f:L.floors-1}:{x:cm,y:top-FL.grueso,z:t,sx:ancho-.02,sy:FL.grueso,sz:hd,color:'#cfc7b8',f:L.floors-1});}
  esc.push({ax,sg,o0,tread,n,rise,yb,rect:E});
  // LA BARANDA (el motor dice dónde: u.barandas): un poste cada DUPLEX3D.baranda.poste, el pasamanos y un riel al medio
  // —Miguel: «elimina los polígonos que no aportan»: antes, un barrote cada 12 cm—; choca hasta su alto. Se corta donde la
  // pendiente de la mansarda no la deja entrar —a DUPLEX3D.enrase del borde, donde va el muro bajo—: «evita que las barandas
  // salgan al tejado»
  const BR=DUPLEX3D.baranda,cB='#3a3d40',cabe=(x,z)=>!B.mansarda||alturaMansarda(B.mansarda,x,z)>=MANSARDA.alto*DUPLEX3D.enrase/MANSARDA.retiro-1e-6;
  for(const b0 of u.barandas||[]){const h=Math.abs(b0.y0-b0.y1)<1e-6,f=h?b0.y0:b0.x0,lo=h?Math.min(b0.x0,b0.x1):Math.min(b0.y0,b0.y1),hi=h?Math.max(b0.x0,b0.x1):Math.max(b0.y0,b0.y1);
   // (los tramos que caben, de a 5 cm)
   const tramos=[];let t0=null;for(let a=lo;a<=hi+1e-6;a+=.05){const ok=h?cabe(a,f):cabe(f,a);if(ok&&t0==null)t0=a;if((!ok||a+.05>hi+1e-6)&&t0!=null){const t1=ok?hi:a-.05;if(t1-t0>.1)tramos.push([t0,t1]);t0=null;}}
   for(const [a0,a1] of tramos){const m=(a0+a1)/2,len=a1-a0,R=(y,hh)=>cs.push(h?{x:m,y,z:f,sx:len,sy:hh,sz:BR.pasamanos,color:cB,f:L.floors}:{x:f,y,z:m,sx:BR.pasamanos,sy:hh,sz:len,color:cB,f:L.floors});
   R(y0+BR.alto-BR.pasamanos,BR.pasamanos);R(y0+BR.alto/2,BR.riel);
   const k=Math.max(1,Math.round(len/BR.poste));for(let i=0;i<=k;i++){const a=a0+len*i/k;cs.push(h?{x:a,y:y0,z:f,sx:BR.barrote,sy:BR.alto-BR.pasamanos,sz:BR.barrote,color:cB,f:L.floors}:{x:f,y:y0,z:a,sx:BR.barrote,sy:BR.alto-BR.pasamanos,sz:BR.barrote,color:cB,f:L.floors});}
   if(h)wallAny(a0,f-.04,a1,f+.04,y0-.05,y0+BR.alto);else wallAny(f-.04,a0,f+.04,a1,y0-.05,y0+BR.alto);
   // (el canto del entrepiso, que se ve desde abajo: una viga de DUPLEX3D.canto bajo la baranda)
   cs.push(h?{x:m,y:y0-DUPLEX3D.canto,z:f,sx:len,sy:DUPLEX3D.canto,sz:.12,color:'#e2d6bf',f:L.floors-1}:{x:f,y:y0-DUPLEX3D.canto,z:m,sx:.12,sy:DUPLEX3D.canto,sz:len,color:'#e2d6bf',f:L.floors-1});}}
  for(const c of cs){box(c.x,c.y,c.z,c.sx,c.sy,c.sz,c.color,c.f);if(c.color===cB)cajasBaranda.push(c);}}
 const enRect=(r,x,z)=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h;
 return {nivel:y0,cajasBaranda,// (las cajas de la baranda, a nivel —sin la planta baja levantada—: para medir que no asomen por el tejado)
  // ¿el punto está en el hueco de una escalera o en el vacío de una sala a doble altura? (ahí no hay losa arriba)
  hueco:(x,z)=>esc.some(e=>enRect(e.rect,x,z))||vacios.some(v=>enRect(v,x,z)),
  // ¿adentro de un dúplex, arriba? (para el piso de la mansarda)
  arriba:(x,z)=>dentro.some(U=>enRect(U,x,z)),
  // el piso de los peldaños bajo (x, z): el más alto a menos de 45 cm sobre los pies, o null (sin la planta baja levantada)
  surface(x,z,feet){for(const e of esc){if(!enRect(e.rect,x,z))continue;const t=((e.ax?x:z)-e.o0)*e.sg,k=Math.floor(t/e.tread);
    if(k>=0&&k<e.n){const h=e.yb+e.rise*(k+1);if(h<=feet+.45)return h;}}return null;}};}

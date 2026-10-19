# Esculpe el pelo desde las vistas de referencia (frente, atrás, arriba) sobre NUESTRA cabeza, sin IA:
#  1. qué caras de la cabeza son pelo: las mira la vista que más las enfrenta (frente/atrás; y arriba si miran arriba)
#     y se fija si ahí la referencia es color pelo;
#  2. cuánto sobresale: cada vértice de pelo avanza por su normal mientras siga dentro de la silueta de la referencia
#     en el frente/atrás y arriba (un tallado por la normal: el pelo hereda las caras grandes de la cabeza);
#  3. donde el pelo termina, un escalón lo cierra contra la piel (como la capa del vestier).
# Salida: pelo-corto.obj (coordenadas de Blender) y comparacion.png (referencia | nuestra cabeza con el pelo).
# blender -b --factory-startup -P esculpir.py [-- subdiv]
import bpy, bmesh, os, sys, math, numpy as np
from mathutils import Vector
D=os.path.dirname(os.path.abspath(__file__))
ARG=sys.argv[-1];MODE='ico' if ARG.startswith('ico') else 'cabeza';ICO=int(ARG[3:4] or 2) if MODE=='ico' else 0;TOPE=float(ARG.split(':')[1]) if ':' in ARG else .12;SUB=int(ARG) if ARG.isdigit() else 1
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=os.path.join(D,'cabeza-h.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
objs={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'};head=objs['Cabeza']
V=np.array([(o.matrix_world@v.co)[:] for o in objs.values() for v in o.data.vertices]);HV=V[V[:,2]>2.3]
hx0,hx1=HV[:,0].min(),HV[:,0].max();hy0,hy1=HV[:,1].min(),HV[:,1].max();hz1=V[:,2].max();EARS=hx1-hx0
def load(n):
    img=bpy.data.images.load(os.path.join(D,'ref-'+n+'.png'));w,h=img.size;a=np.array(img.pixels[:]).reshape(h,w,4)[:,:,:3]
    fg=np.abs(a-a[2,2]).sum(2)>.12;mx=a.max(2);mn=a.min(2)
    # pelo: castaño (más oscuro que la piel y poco amarillo); los rasgos casi negros no cuentan
    hair=fg&(mx<.62)&(mx>.12)&((a[:,:,0]-a[:,:,2])>.08)&(a[:,:,1]<.42)
    ys,xs=np.nonzero(fg);return dict(a=a,fg=fg,hair=hair,box=(xs.min(),ys.min(),xs.max(),ys.max()),w=w,h=h)
F,B,T=load('frente'),load('atras'),load('arriba')
# Alineación: una sola escala (de oreja a oreja) y la altura por el centro de las orejas, que son piel en las dos
# vistas y en nuestra cabeza. (La coronilla de la referencia es la del PELO, no la del cráneo: no sirve de ancla.)
def ear_row(R):
    a=R['a'];x0,y0,x1,y1=R['box'];k=max(3,int((x1-x0)*.04));skin=R['fg']&~R['hair']&(a.max(2)>.5)
    ys=[y for y in range(y0,y1) if skin[y,x0:x0+k].any() or skin[y,x1-k:x1+1].any()];return (min(ys)+max(ys))/2
EZ=float(np.mean(HV[np.abs(HV[:,0])>EARS/2-.04][:,2]))
fb,bb,tb=F['box'],B['box'],T['box']
uf=EARS/(fb[2]-fb[0]);ub=EARS/(bb[2]-bb[0]);ut=EARS/(tb[2]-tb[0])
print('escalas',uf,ub,ut,'orejas z',EZ,'filas',ear_row(F),ear_row(B))
def mapper(su,sv,proj,anchor_world,anchor_px):
    def f(p):q=np.array(proj(p))-anchor_world;return int(round(q[0]/su+anchor_px[0])),int(round(q[1]/sv+anchor_px[1]))
    return f
mF=mapper(uf,uf,lambda p:(p[0],p[2]),np.array([(hx0+hx1)/2,EZ]),np.array([(fb[0]+fb[2])/2,ear_row(F)]))
mB=mapper(ub,ub,lambda p:(-p[0],p[2]),np.array([-(hx0+hx1)/2,EZ]),np.array([(bb[0]+bb[2])/2,ear_row(B)]))
mT=mapper(ut,ut,lambda p:(p[0],p[1]),np.array([(hx0+hx1)/2,(hy0+hy1)/2]),np.array([(tb[0]+tb[2])/2,(tb[1]+tb[3])/2]))
def at(R,m,p,key):
    x,y=m(p)
    return bool(R[key][y,x]) if 0<=x<R['w'] and 0<=y<R['h'] else False
if MODE=='ico':
    # Modo «ico»: el pelo es una Ico Sphere (las caras grandes y desparejas del estilo de la referencia), centrada en la
    # cabeza: cada vértice sale desde el centro hasta el borde de la silueta (frente o atrás según mire, y arriba); los que
    # caen donde la referencia muestra piel se esconden dentro del cráneo, y quedan las caras con al menos dos vértices de
    # pelo: el borde de la cara sale en las puntas de esos triángulos, como el flequillo de la referencia.
    from mathutils.bvhtree import BVHTree
    bm=bmesh.new();bm.from_mesh(head.data);bm.transform(head.matrix_world);bmesh.ops.remove_doubles(bm,verts=bm.verts[:],dist=1e-4);bm.normal_update()
    tree=BVHTree.FromBMesh(bm);C=Vector(((hx0+hx1)/2,(hy0+hy1)/2,EZ+.18))
    ico=bmesh.new();bmesh.ops.create_icosphere(ico,subdivisions=ICO,radius=1.0)
    hair={};pos={}
    for v in ico.verts:
        d=v.co.normalized();hit=tree.ray_cast(C,d)
        if hit[0] is None:hair[v.index]=False;pos[v.index]=C;continue
        sk=(hit[0]-C).length;p=hit[0];n=hit[1]
        R,m=(F,mF) if d.y<0 else (B,mB)
        h=at(T,mT,p,'hair') if d.z>.55 else (at(R,m,p,'hair') and (d.z<.2 or at(T,mT,p,'hair')))
        if p.z<2.3:h=False
        r=sk
        for k in range(1,51):
            q=C+d*(sk+k*.005)
            if not(at(R,m,q,'fg') and at(T,mT,q,'fg')):break
            r=sk+k*.005
        # (sin vista de perfil, la silueta de frente y la de arriba encierran una caja: el grosor sobre el cráneo se topa
        # para que la coronilla quede redonda)
        r=min(r,sk+TOPE)
        hair[v.index]=h;pos[v.index]=C+d*(max(r,sk+.03) if h else sk-.01)
    print('ICO vértices',len(ico.verts),'pelo',sum(hair.values()),'sin choque',sum(1 for v in ico.verts if pos[v.index]==C))
    out=bmesh.new();vmap={v.index:out.verts.new(pos[v.index]) for v in ico.verts}
    for f in ico.faces:
        if sum(hair[v.index] for v in f.verts)>=2:out.faces.new([vmap[v.index] for v in f.verts])
    bmesh.ops.delete(out,geom=[v for v in out.verts if not v.link_faces],context='VERTS')
    lift={0:0}
else:
    # 1. La cabeza, subdividida para que el borde del pelo tenga dónde quebrarse
    bm=bmesh.new();bm.from_mesh(head.data);bm.transform(head.matrix_world)
    # (el OBJ trae cada triángulo suelto: se sueldan, o cada cara se inflaría por su lado)
    bmesh.ops.remove_doubles(bm,verts=bm.verts[:],dist=1e-4);bm.normal_update()
    for _ in range(SUB):bmesh.ops.subdivide_edges(bm,edges=bm.edges[:],cuts=1,use_grid_fill=True)
    bmesh.ops.triangulate(bm,faces=bm.faces[:]);bm.normal_update()
    def is_hair(f):
        c=f.calc_center_median();n=f.normal
        if c.z<2.3:return False                       # (cuello y hombros)
        fr=n.y<0                                     # frente del muñeco: −Y
        side=at(F,mF,c,'hair') if fr else at(B,mB,c,'hair')
        if n.z>.55:return at(T,mT,c,'hair')
        if n.z>.2:return side and at(T,mT,c,'hair') or (at(T,mT,c,'hair') and abs(n.x)>.5)
        return side
    hairF={f.index for f in bm.faces if is_hair(f)}
    # (limpieza: una cara suelta de pelo rodeada de piel —o al revés— es ruido de la máscara)
    for _ in range(2):
        flip=set()
        for f in bm.faces:
            nb=[g for e in f.edges for g in e.link_faces if g!=f];k=sum(g.index in hairF for g in nb)
            if f.index in hairF and k<=1:flip.add(f.index)
            if f.index not in hairF and k>=len(nb)-0 and f.calc_center_median().z>2.3:flip.add(f.index)
        hairF^=flip
    # 2. Tallado por la normal: hasta dónde sigue dentro de la silueta (frente o atrás según mire, y arriba)
    lift={}
    for f in bm.faces:
        if f.index not in hairF:continue
        for v in f.verts:
            if v.index in lift:continue
            n=v.normal.copy();R,m=(F,mF) if n.y<0 else (B,mB);t=0.0
            for k in range(1,41):
                s=k*.005;p=v.co+n*s
                if not(at(R,m,p,'fg') and at(T,mT,p,'fg')):break
                t=s
            lift[v.index]=max(.025,t)
    # (suavizado del grosor entre vecinos de pelo: la silueta de una imagen tiene ruido de píxel)
    for _ in range(2):
        new={}
        for i,t in lift.items():
            v=bm.verts[i] if False else None
        bm.verts.ensure_lookup_table()
        for i,t in lift.items():
            ns=[e.other_vert(bm.verts[i]).index for e in bm.verts[i].link_edges if e.other_vert(bm.verts[i]).index in lift]
            new[i]=.5*t+.5*(sum(lift[j] for j in ns)/len(ns)) if ns else t
        lift=new
    # 3. La malla del pelo: caras de pelo infladas + escalón en el borde
    out=bmesh.new();vmap={}
    def nv(v):
        if v.index not in vmap:vmap[v.index]=out.verts.new(v.co+v.normal*lift[v.index])
        return vmap[v.index]
    bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
    for i in hairF:out.faces.new([nv(v) for v in bm.faces[i].verts])
    for e in bm.edges:
        fs=[f.index in hairF for f in e.link_faces]
        if fs.count(True)==1:
            f=[g for g in e.link_faces if g.index in hairF][0];a,b=e.verts
            # (el orden de la arista dentro de la cara de pelo decide hacia dónde mira la pared)
            vs=list(f.verts);ia=vs.index(a);a,b=(a,b) if vs[(ia+1)%len(vs)]==b else (b,a)
            lo_a=out.verts.new(a.co+a.normal*.004);lo_b=out.verts.new(b.co+b.normal*.004)
            out.faces.new([vmap[b.index],vmap[a.index],lo_a,lo_b])
me=bpy.data.meshes.new('Pelo');out.to_mesh(me);pelo=bpy.data.objects.new('Pelo',me);bpy.context.scene.collection.objects.link(pelo)
mat=bpy.data.materials.new('pelo');mat.diffuse_color=(0.36,0.2,0.11,1);me.materials.append(mat)
print('PELO',MODE,ICO or SUB,'caras',len(me.polygons))
bpy.ops.object.select_all(action='DESELECT');pelo.select_set(True);bpy.context.view_layer.objects.active=pelo
bpy.ops.wm.obj_export(filepath=os.path.join(D,'pelo-corto.obj'),export_selected_objects=True,export_materials=False)
# Renders: frente, tres cuartos, atrás, arriba (sombreado plano)
sc=bpy.context.scene;sc.render.engine='BLENDER_WORKBENCH';sc.render.resolution_x=sc.render.resolution_y=420
sc.display.shading.light='STUDIO';sc.display.shading.color_type='MATERIAL';sc.render.film_transparent=False
sc.world=bpy.data.worlds.new('w');sc.world.color=(0.55,0.58,0.62);sc.display.shading.background_type='WORLD'
skin=bpy.data.materials.new('piel');skin.diffuse_color=(0.95,0.55,0.32,1)
dark=bpy.data.materials.new('rasgos');dark.diffuse_color=(0.03,0.03,0.03,1)
for o in objs.values():
    o.data.materials.clear();o.data.materials.append(skin if o.name=='Cabeza' else dark)
    for p in o.data.polygons:p.use_smooth=False
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam'));sc.collection.objects.link(cam);sc.camera=cam
cam.data.type='ORTHO';cam.data.ortho_scale=1.66;C=Vector(((hx0+hx1)/2,(hy0+hy1)/2,hz1-.70))
shots=[]
for name,az,el in [('frente',0,0),('tres-cuartos',-55,8),('atras',180,0),('arriba',0,89.9)]:
    a=math.radians(az);e=math.radians(el);d=Vector((math.sin(a)*math.cos(e),-math.cos(a)*math.cos(e),math.sin(e)))
    cam.location=C+d*5;cam.rotation_euler=(-d).to_track_quat('-Z','Y' if el<80 else 'Y').to_euler()
    if el>80:cam.rotation_euler=(0,0,0);cam.location=C+Vector((0,0,5))
    sc.render.filepath=os.path.join(D,'_r-'+name+'.png');bpy.ops.render.render(write_still=True);shots.append(name)
# Hoja: arriba la referencia, abajo lo nuestro
def px(path,size=420):
    im=bpy.data.images.load(path);w,h=im.size;a=np.array(im.pixels[:]).reshape(h,w,4)
    yi=(np.arange(size)*h/size).astype(int);xi=(np.arange(size)*w/size).astype(int);return a[yi][:,xi]
top=np.concatenate([px(os.path.join(D,'ref-'+n+'.png')) for n in shots],1);bot=np.concatenate([px(os.path.join(D,'_r-'+n+'.png')) for n in shots],1)
A=np.concatenate([bot,top],0);o=bpy.data.images.new('h',A.shape[1],A.shape[0]);o.pixels[:]=A.ravel();o.filepath_raw=os.path.join(D,'comparacion.png');o.file_format='PNG';o.save()
for n in shots:os.remove(os.path.join(D,'_r-'+n+'.png'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D,'pelo-esculpido.blend'))

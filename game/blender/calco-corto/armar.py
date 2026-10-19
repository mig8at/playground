# Arma corto-calco.blend: nuestra cabeza calva (pose de atado) + las vistas de un corte (frente, atrás, arriba;
# el tres cuartos queda flotando, sin alinear) como referencias ortogonales, y una Ico Sphere para calcar.
# Además deja calce-*.png: nuestra cabeza dibujada encima de cada referencia, para ver si calzan.
# blender -b --factory-startup -P armar.py
import bpy, os, math, numpy as np
D=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=os.path.join(D,'cabeza-h.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
head=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in head:
    o.hide_select=True
    for p in o.data.polygons: p.use_smooth=False
def load(name):
    img=bpy.data.images.load(os.path.join(D,'ref-'+name+'.png'));w,h=img.size
    a=np.array(img.pixels[:]).reshape(h,w,4)[:,:,:3]   # (fila 0 = abajo)
    fg=np.abs(a-a[2,2]).sum(2)>.12
    return img,a,fg
def box(fg):
    ys,xs=np.nonzero(fg);return xs.min(),ys.min(),xs.max(),ys.max()
def ref(name,img,loc,rot,u,cx,cy,persp=False):
    e=bpy.data.objects.new('Ref · '+name,None);e.empty_display_type='IMAGE';e.data=img;img.pack()
    w,h=img.size;e.empty_display_size=max(w,h)*u
    e.empty_image_offset=(-.5-(cx-w/2)/w,-.5-(cy-h/2)/h)
    e.location=loc;e.rotation_euler=[math.radians(x) for x in rot]
    e.empty_image_depth='BACK';e.color[3]=.55;e.use_empty_image_alpha=True
    e.show_empty_image_perspective=persp;e.empty_image_side='FRONT'
    bpy.context.scene.collection.objects.link(e);return e
# Nuestra cabeza: medida en la propia malla (ancho de oreja a oreja, alto, fondo)
V=np.array([(o.matrix_world@v.co)[:] for o in head for v in o.data.vertices])
# (sólo la cabeza: el OBJ trae también el arranque de los hombros, más ancho que las orejas)
HV=V[V[:,2]>2.3]
hx0,hx1=HV[:,0].min(),HV[:,0].max();hy0,hy1=HV[:,1].min(),HV[:,1].max();hz0,hz1=V[:,2].min(),V[:,2].max()
EARS=hx1-hx0
F,B,T,Q=load('frente'),load('atras'),load('arriba'),load('tres-cuartos')
# frente y atrás: escala por el ancho total (orejas) y la coronilla arriba
fb=box(F[2]);uf=EARS/(fb[2]-fb[0])
ref('Frente',F[0],(0,1.5,hz1),(90,0,0),uf,(fb[0]+fb[2])/2,fb[3])
bb=box(B[2]);ub=EARS/(bb[2]-bb[0])
ref('Atrás',B[0],(0,-1.5,hz1),(90,0,180),ub,(bb[0]+bb[2])/2,bb[3])
# arriba: también por las orejas; el centro del recuadro en el centro de la cabeza
tb=box(T[2]);ut=EARS/(tb[2]-tb[0])
ref('Arriba',T[0],((hx0+hx1)/2,(hy0+hy1)/2,hz0-.3),(0,0,0),ut,(tb[0]+tb[2])/2,(tb[1]+tb[3])/2)
ref('Tres cuartos (sin alinear)',Q[0],(2.2,0,hz1-.5),(90,0,0),uf,Q[0].size[0]/2,Q[0].size[1]/2,True)
# Calce: la silueta de nuestra cabeza (proyección de sus triángulos) sobre cada referencia
def raster(pts2,tris,w,h):
    m=np.zeros((h,w),bool);yy,xx=np.mgrid[0:h,0:w]
    for t in tris:
        p=pts2[list(t)];x0,y0=np.floor(p.min(0)).astype(int);x1,y1=np.ceil(p.max(0)).astype(int)
        x0,y0=max(x0,0),max(y0,0);x1,y1=min(x1,w-1),min(y1,h-1)
        if x1<x0 or y1<y0: continue
        X=xx[y0:y1+1,x0:x1+1]+.5;Y=yy[y0:y1+1,x0:x1+1]+.5;(ax,ay),(bx,by),(cx,cy)=p
        d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(d)<1e-9: continue
        l1=((by-cy)*(X-cx)+(cx-bx)*(Y-cy))/d;l2=((cy-ay)*(X-cx)+(ax-cx)*(Y-cy))/d;l3=1-l1-l2
        m[y0:y1+1,x0:x1+1]|=(l1>=0)&(l2>=0)&(l3>=0)
    return m
tris=[];pts=[]
for o in head:
    base=len(pts);pts+= [(o.matrix_world@v.co)[:] for v in o.data.vertices]
    for p in o.data.polygons:
        vs=list(p.vertices)
        for k in range(1,len(vs)-1): tris.append((base+vs[0],base+vs[k],base+vs[k+1]))
P=np.array(pts)
def calce(name,R,proj,u,anchor):
    img,a,fg=R;h,w=fg.shape;q=proj(P)/u;q=q-anchor[0]+np.array(anchor[1])
    ours=raster(q,tris,w,h);out=a.copy()*.75+.25
    out[ours&fg]=out[ours&fg]*.5+np.array([.1,.55,.2])*.5   # verde: las dos
    out[ours&~fg]=[.85,.15,.15]                              # rojo: sólo la nuestra
    out[~ours&fg]=out[~ours&fg]*.6+np.array([.15,.3,.9])*.4  # azul: sólo la referencia
    iou=(ours&fg).sum()/max(1,(ours|fg).sum())
    o=bpy.data.images.new('c',w,h);o.pixels[:]=np.dstack([out,np.ones((h,w))]).ravel();o.filepath_raw=os.path.join(D,'calce-'+name+'.png');o.file_format='PNG';o.save()
    print('CALCE',name,'IoU %.1f%%'%(iou*100))
calce('frente',F,lambda P:np.c_[P[:,0],P[:,2]],uf,(np.array([(hx0+hx1)/2/uf,hz1/uf]),((fb[0]+fb[2])/2,fb[3])))
calce('atras',B,lambda P:np.c_[-P[:,0],P[:,2]],ub,(np.array([-(hx0+hx1)/2/ub,hz1/ub]),((bb[0]+bb[2])/2,bb[3])))
calce('arriba',T,lambda P:np.c_[P[:,0],P[:,1]],ut,(np.array([(hx0+hx1)/2/ut,(hy0+hy1)/2/ut]),((tb[0]+tb[2])/2,(tb[1]+tb[3])/2)))
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.6,location=(0,(hy0+hy1)/2,hz1-.35))
pelo=bpy.context.active_object;pelo.name='Pelo'
m=pelo.modifiers.new('Espejo X','MIRROR');m.use_axis[0]=True;m.use_bisect_axis[0]=True;m.use_clip=True
mat=bpy.data.materials.new('pelo');mat.diffuse_color=(0.30,0.16,0.08,1);pelo.data.materials.append(mat)
bpy.context.scene.unit_settings.system='NONE'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D,'corto-calco.blend'))
print('medidas cabeza',EARS,hy1-hy0,hz1-hz0,'escalas',uf,ub,ut)

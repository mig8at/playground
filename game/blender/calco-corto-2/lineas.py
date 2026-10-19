# Pelo copiando las LÍNEAS del frente de la referencia (sin IA): cada faceta de color plano del pelo en la imagen de
# frente se toma como un polígono (sus esquinas), las esquinas compartidas se sueldan, y la profundidad la pone
# nuestra cabeza (pegado al cráneo más un grosor; en el contorno, a la mitad de la cabeza). Atrás sale del mismo método
# de la Ico Sphere (esculpir.py), sólo la mitad de atrás.
# blender -b --factory-startup -P lineas.py
import bpy,bmesh,os,math,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from collections import deque
D=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=os.path.join(D,'cabeza-h.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
objs={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'};head=objs['Cabeza']
V=np.array([(o.matrix_world@v.co)[:] for o in objs.values() for v in o.data.vertices]);HV=V[V[:,2]>2.3]
hx0,hx1=HV[:,0].min(),HV[:,0].max();hy0,hy1=HV[:,1].min(),HV[:,1].max();EARS=hx1-hx0
EZ=float(np.mean(HV[np.abs(HV[:,0])>EARS/2-.04][:,2]))
def load(n):
    img=bpy.data.images.load(os.path.join(D,'ref-'+n+'.png'));w,h=img.size;a=np.array(img.pixels[:]).reshape(h,w,4)[:,:,:3]
    fg=np.abs(a-a[2,2]).sum(2)>.12;mx=a.max(2)
    hair=fg&(mx<.62)&(mx>.12)&((a[:,:,0]-a[:,:,2])>.08)&(a[:,:,1]<.42)
    ys,xs=np.nonzero(fg);return dict(a=a,fg=fg,hair=hair,box=(xs.min(),ys.min(),xs.max(),ys.max()),w=w,h=h)
def ear_row(R):
    a=R['a'];x0,y0,x1,y1=R['box'];k=max(3,int((x1-x0)*.04));skin=R['fg']&~R['hair']&(a.max(2)>.5)
    ys=[y for y in range(y0,y1) if skin[y,x0:x0+k].any() or skin[y,x1-k:x1+1].any()];return (min(ys)+max(ys))/2
F=load('frente');fb=F['box'];uf=EARS/(fb[2]-fb[0]);cxF=(fb[0]+fb[2])/2;erF=ear_row(F)
toW=lambda px,py:((px-cxF)*uf+(hx0+hx1)/2,(py-erF)*uf+EZ)          # píxel del frente → (x, z) nuestro
# 1. Facetas: el pelo partido por sus aristas (saltos de color entre caras planas); sólo el bloque de pelo más grande
# (la sombra del mentón y las cejas también son oscuras)
a=F['a'];H,W=F['hair'].shape
def comps(mask,conn4=True):
    lab=-np.ones(mask.shape,int);out=[]
    for y0,x0 in zip(*np.nonzero(mask)):
        if lab[y0,x0]>=0:continue
        q=deque([(y0,x0)]);lab[y0,x0]=len(out);pts=[]
        while q:
            y,x=q.popleft();pts.append((x,y))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                yy,xx=y+dy,x+dx
                if 0<=yy<H and 0<=xx<W and mask[yy,xx] and lab[yy,xx]<0:lab[yy,xx]=lab[y0,x0];q.append((yy,xx))
        out.append(np.array(pts,float))
    return out,lab
blobs,blab=comps(F['hair']);main=max(range(len(blobs)),key=lambda i:len(blobs[i]));hair=blab==main
# (bordes: diferencia de color con el vecino, sobre la imagen apenas suavizada)
k=np.ones(3)/3;sm=a.copy()
for ax in (0,1):sm=np.apply_along_axis(lambda m:np.convolve(m,k,'same'),ax,sm)
g=np.zeros((H,W))
g[:,1:]=np.maximum(g[:,1:],np.abs(sm[:,1:]-sm[:,:-1]).sum(2));g[1:,:]=np.maximum(g[1:,:],np.abs(sm[1:]-sm[:-1]).sum(2))
EDGE=float(os.environ.get('EDGE','0.018'))
regions,lab=comps(hair&(g<EDGE))
big=[r for r in regions if len(r)>=60]
print('FACETAS',len(big),'de',len(regions),'regiones; píxeles de pelo',int(hair.sum()),'en facetas',int(sum(len(r) for r in big)),'EDGE',EDGE)
# 2. Esquinas de cada faceta: el triángulo de mayor área dentro de la región; si lo llena mal, un cuadrilátero
def tri_area(p,q,r):return abs((q[0]-p[0])*(r[1]-p[1])-(r[0]-p[0])*(q[1]-p[1]))/2
polys=[]
for r in big:
    c=r.mean(0);p1=r[np.argmax(((r-c)**2).sum(1))];p2=r[np.argmax(((r-p1)**2).sum(1))]
    d=np.abs((p2[0]-p1[0])*(r[:,1]-p1[1])-(r[:,0]-p1[0])*(p2[1]-p1[1]));p3=r[np.argmax(d)]
    poly=[p1,p3,p2] if True else None
    if tri_area(p1,p2,p3)<len(r)*.8:
        # (cuarto punto: el más lejos del lado opuesto a p3 respecto de p1-p2)
        s=np.sign((p2[0]-p1[0])*(p3[1]-p1[1])-(p3[0]-p1[0])*(p2[1]-p1[1]))
        side=-s*((p2[0]-p1[0])*(r[:,1]-p1[1])-(r[:,0]-p1[0])*(p2[1]-p1[1]))
        if side.max()>0:p4=r[np.argmax(side)];poly=[p1,p3,p2,p4]
    polys.append(poly)
# 3. Soldar esquinas cercanas (las facetas vecinas comparten vértices; el borde entre ellas mide unos píxeles)
pts=[p for poly in polys for p in poly];P=np.array(pts);n=len(P);parent=list(range(n))
def find(i):
    while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
    return i
for i in range(n):
    for j in range(i+1,n):
        if ((P[i]-P[j])**2).sum()<11**2:parent[find(i)]=find(j)
groups={};[groups.setdefault(find(i),[]).append(i) for i in range(n)]
vid={};VP=[]
for g,ids in groups.items():
    for i in ids:vid[i]=len(VP)
    VP.append(P[ids].mean(0))
# 4. Las esquinas de las facetas + puntos del contorno del pelo, triangulados (Delaunay) y quedan los triángulos que
# caen en el pelo: así se llenan las facetas que no se separaron solas y las aristas pasan por las esquinas de la imagen
from mathutils.geometry import delaunay_2d_cdt
bd=hair&~(np.roll(hair,1,0)&np.roll(hair,-1,0)&np.roll(hair,1,1)&np.roll(hair,-1,1))
bys,bxs=np.nonzero(bd);extra=[]
for x,y in zip(bxs,bys):
    if all((x-q[0])**2+(y-q[1])**2>=26**2 for q in VP+extra):extra.append(np.array([x,y],float))
VP=VP+extra
cdt=delaunay_2d_cdt([Vector((float(p[0]),float(p[1]))) for p in VP],[],[],0,1e-6)
VP=[np.array(v[:]) for v in cdt[0]];faces=[]
for f in cdt[2]:
    c=np.mean([VP[i] for i in f],0);x,y=int(c[0]),int(c[1])
    # (dentro del pelo, con un margen: el centro de un triángulo de borde puede caer justo afuera)
    if hair[max(0,y-2):y+3,max(0,x-2):x+3].mean()>.5:faces.append(list(f))
print('VÉRTICES',len(VP),'CARAS',len(faces))
# Dibujo de control: las facetas encontradas sobre la referencia
dbg=a.copy()*.6+.4
for f in faces:
    for i in range(len(f)):
        p,q=VP[f[i]],VP[f[(i+1)%len(f)]]
        for t in np.linspace(0,1,80):
            x,y=int(p[0]+(q[0]-p[0])*t),int(p[1]+(q[1]-p[1])*t)
            if 0<=x<W and 0<=y<H:dbg[max(0,y-1):y+2,max(0,x-1):x+2]=[.9,.1,.1]
for p in VP:
    x,y=int(p[0]),int(p[1]);dbg[max(0,y-3):y+4,max(0,x-3):x+4]=[.1,.2,.9]
o=bpy.data.images.new('d',W,H);o.pixels[:]=np.dstack([dbg,np.ones((H,W))]).ravel();o.filepath_raw=os.path.join(D,'lineas-frente.png');o.file_format='PNG';o.save()
np.save(os.path.join(D,'_lineas.npy'),{'VP':np.array(VP),'faces':faces},allow_pickle=True)
# 5. Profundidad desde nuestra cabeza: cada vértice se proyecta de frente sobre el cráneo. En el borde con la piel
# (flequillo, patillas) queda pegado a la piel; en el contorno contra el fondo, a la mitad de la cabeza (es la silueta);
# adentro, el cráneo más el grosor del pelo.
bm=bmesh.new();bm.from_mesh(head.data);bm.transform(head.matrix_world);bmesh.ops.remove_doubles(bm,verts=bm.verts[:],dist=1e-4);bm.normal_update()
tree=BVHTree.FromBMesh(bm);C=Vector(((hx0+hx1)/2,(hy0+hy1)/2,EZ+.18));GROSOR=float(os.environ.get('GROSOR','.06'))
fg=F['fg'];outer=lambda x,y:not fg[max(0,y-4):y+5,max(0,x-4):x+5].all()
skinNear=lambda x,y:(fg&~hair)[max(0,y-5):y+6,max(0,x-5):x+6].any()
P3=[]
for p in VP:
    x,z=toW(p[0],p[1]);px,py=int(round(p[0])),int(round(p[1]))
    hit=tree.ray_cast(Vector((x,hy0-2,z)),Vector((0,1,0)))
    if outer(px,py) and not skinNear(px,py):P3.append(Vector((x,C.y,z)))
    elif hit[0] is None:P3.append(Vector((x,C.y,z)))
    elif skinNear(px,py):P3.append(hit[0]+Vector((0,-.012,0)))
    else:P3.append(hit[0]+Vector((0,-GROSOR,0)))
# (despeje: un triángulo largo entre la frente y la coronilla corta el cráneo, que es curvo. Cada cara se muestrea y, si
# algún punto queda detrás de la piel, sus vértices se adelantan SÓLO en profundidad: de frente las líneas no se mueven)
CLEAR=.025
for it in range(12):
    push=[0.0]*len(P3);bad=0
    for f in faces:
        A,Bv,Cv=(P3[i] for i in f[:3])
        for u in np.linspace(0,1,6):
            for w in np.linspace(0,1-u,6):
                q=A*(1-u-w)+Bv*u+Cv*w;hit=tree.ray_cast(Vector((q.x,hy0-2,q.z)),Vector((0,1,0)))
                if hit[0] is None:continue
                need=q.y-(hit[0].y-CLEAR)
                if need>0:
                    bad+=1
                    for i in f:push[i]=max(push[i],need)
    if not bad:break
    for i,dp in enumerate(push):P3[i]=P3[i]+Vector((0,-dp,0))
print('DESPEJE pasadas',it+1,'puntos adentro en la última',bad)
# 6. Atrás: la Ico Sphere de esculpir.py, sólo su mitad de atrás, con la silueta de atrás y de arriba
B=load('atras');T=load('arriba');bb,tb=B['box'],T['box'];ub=EARS/(bb[2]-bb[0]);ut=EARS/(tb[2]-tb[0])
def at(R,su,proj,aw,ap,p,key):
    q=(np.array(proj(p))-aw)/su+ap;x,y=int(round(q[0])),int(round(q[1]))
    return bool(R[key][y,x]) if 0<=x<R['w'] and 0<=y<R['h'] else False
atB=lambda p,k:at(B,ub,lambda p:(-p[0],p[2]),np.array([-(hx0+hx1)/2,EZ]),np.array([(bb[0]+bb[2])/2,ear_row(B)]),p,k)
atT=lambda p,k:at(T,ut,lambda p:(p[0],p[1]),np.array([(hx0+hx1)/2,(hy0+hy1)/2]),np.array([(tb[0]+tb[2])/2,(tb[1]+tb[3])/2]),p,k)
ico=bmesh.new();bmesh.ops.create_icosphere(ico,subdivisions=3,radius=1.0);ih={};ip={}
for v in ico.verts:
    d=v.co.normalized();hit=tree.ray_cast(C,d)
    if hit[0] is None or d.y<-.05:ih[v.index]=False;ip[v.index]=C;continue
    sk=(hit[0]-C).length;p=hit[0];h=atT(p,'hair') if d.z>.55 else (atB(p,'hair') and (d.z<.2 or atT(p,'hair')))
    if p.z<2.3:h=False
    r=sk
    for k in range(1,31):
        q=C+d*(sk+k*.005)
        if not(atB(q,'fg') and atT(q,'fg')):break
        r=sk+k*.005
    ih[v.index]=h;ip[v.index]=C+d*(max(min(r,sk+.12),sk+.03) if h else sk-.01)
out=bmesh.new();fv=[out.verts.new(p) for p in P3]
for f in faces:
    try:out.faces.new([fv[i] for i in f])
    except ValueError:pass
iv={v.index:out.verts.new(ip[v.index]) for v in ico.verts}
for f in ico.faces:
    if sum(ih[v.index] for v in f.verts)>=2 and all(v.co.y>=-.05 for v in f.verts):out.faces.new([iv[v.index] for v in f.verts])
bmesh.ops.delete(out,geom=[v for v in out.verts if not v.link_faces],context='VERTS')
bmesh.ops.recalc_face_normals(out,faces=out.faces[:])
me=bpy.data.meshes.new('Pelo');out.to_mesh(me);pelo=bpy.data.objects.new('Pelo',me);bpy.context.scene.collection.objects.link(pelo)
mat=bpy.data.materials.new('pelo');mat.diffuse_color=(0.36,0.2,0.11,1);me.materials.append(mat)
print('PELO frente',len(faces),'caras · total',len(me.polygons))
bpy.ops.object.select_all(action='DESELECT');pelo.select_set(True);bpy.context.view_layer.objects.active=pelo
bpy.ops.wm.obj_export(filepath=os.path.join(D,'pelo-lineas.obj'),export_selected_objects=True,export_materials=False)
# 7. Renders y hoja: arriba la referencia, abajo lo nuestro
sc=bpy.context.scene;sc.render.engine='BLENDER_WORKBENCH';sc.render.resolution_x=sc.render.resolution_y=420
sc.display.shading.light='STUDIO';sc.display.shading.color_type='MATERIAL'
sc.world=bpy.data.worlds.new('w');sc.world.color=(0.55,0.58,0.62);sc.display.shading.background_type='WORLD'
skin=bpy.data.materials.new('piel');skin.diffuse_color=(0.95,0.55,0.32,1);dark=bpy.data.materials.new('r');dark.diffuse_color=(0.03,0.03,0.03,1)
for o in objs.values():
    o.data.materials.clear();o.data.materials.append(skin if o.name=='Cabeza' else dark)
for o in list(objs.values())+[pelo]:
    for p in o.data.polygons:p.use_smooth=False
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam'));sc.collection.objects.link(cam);sc.camera=cam
cam.data.type='ORTHO';cam.data.ortho_scale=1.66;CC=Vector(((hx0+hx1)/2,(hy0+hy1)/2,V[:,2].max()-.70))
names=['frente','tres-cuartos','atras','arriba']
for name,az,el in [('frente',0,0),('tres-cuartos',-55,8),('atras',180,0),('arriba',0,89.9)]:
    a_=math.radians(az);e=math.radians(el);d=Vector((math.sin(a_)*math.cos(e),-math.cos(a_)*math.cos(e),math.sin(e)))
    cam.location=CC+d*5;cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler()
    if el>80:cam.rotation_euler=(0,0,0);cam.location=CC+Vector((0,0,5))
    sc.render.filepath=os.path.join(D,'_r-'+name+'.png');bpy.ops.render.render(write_still=True)
def px(path,size=420):
    im=bpy.data.images.load(path);w,h=im.size;A=np.array(im.pixels[:]).reshape(h,w,4)
    yi=(np.arange(size)*h/size).astype(int);xi=(np.arange(size)*w/size).astype(int);return A[yi][:,xi]
top=np.concatenate([px(os.path.join(D,'ref-'+n+'.png')) for n in names],1);bot=np.concatenate([px(os.path.join(D,'_r-'+n+'.png')) for n in names],1)
A=np.concatenate([bot,top],0);o=bpy.data.images.new('h',A.shape[1],A.shape[0]);o.pixels[:]=A.ravel();o.filepath_raw=os.path.join(D,'comparacion-lineas.png');o.file_format='PNG';o.save()
for n in names:os.remove(os.path.join(D,'_r-'+n+'.png'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D,'pelo-lineas.blend'))

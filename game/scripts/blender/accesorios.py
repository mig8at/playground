"""Accesorios low poly reutilizables (coordenadas locales, colores por papel).
blender -b --factory-startup -P scripts/blender/accesorios.py -- game_dir prototipos.blend
"""
import bpy,bmesh,json,os,sys,math
from mathutils import Vector
root,preview=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
assets={};current=[]
def mesh(name,verts,faces,role):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o['role']=role;current.append(o);return o

def box(name,center,size,role,bevel=.002,angle=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler.z=angle;o['role']=role
    if bevel:
        mod=o.modifiers.new('Bisel low poly','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
    current.append(o);return o

def rounded(w,h,r):
    return [(-w/2+r,-h/2),(w/2-r,-h/2),(w/2,-h/2+r),(w/2,h/2-r),(w/2-r,h/2),(-w/2+r,h/2),(-w/2,h/2-r),(-w/2,-h/2+r)]
def frame(name,w,h,border,depth,role):
    sections=[(w,h,0),(w-.005,h-.005,depth),(w-border*2,h-border*2,depth),(w-border*2-.003,h-border*2-.003,0)]
    verts=[]
    for sw,sh,z in sections:verts.extend((x,y,z) for x,y in rounded(sw,sh,min(border*.55,sw*.1,sh*.1)))
    faces=[]
    for j in range(4):
        k=(j+1)%4
        for i in range(8):n=(i+1)%8;faces.append((j*8+i,j*8+n,k*8+n,k*8+i))
    return mesh(name,verts,faces,role)
def strap(name,links=False):
    verts=[];faces=[];N=16
    for i in range(N):
        a=i*math.tau/N;b=(i+1)*math.tau/N
        if links:a+=.035;b-=.035
        base=len(verts)
        for x in [-.5,.5]:
            for radius,theta in [(1,a),(1,b),(1.075,b),(1.075,a)]:verts.append((x,radius*math.cos(theta),radius*math.sin(theta)))
        faces.extend(tuple(base+j for j in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    return mesh(name,verts,faces,'strap')
def finish(name):
    global current
    parts=[];bpy.context.view_layer.update()
    for o in current:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.verts.index_update()
        pos=[round(c,6) for v in bm.verts for c in o.matrix_world@v.co];idx=[v.index for f in bm.faces for v in f.verts];bm.free();parts.append(dict(role=o['role'],pos=pos,idx=idx))
    assets[name]={'parts':parts};current=[]

frame('Hebilla',.18,.092,.02,.022,'metal');box('Lengüeta',(-.022,0,.026),(.085,.012,.009),'metal',.001);finish('buckle')
frame('Pasador de cuero',.038,.11,.007,.014,'strap');finish('keeper')
strap('Correa de cuero');finish('watchLeather')
strap('Brazalete de eslabones',True);finish('watchMetal')
# Bisel de esfera de doce lados: perfil con cara, flanco y abertura para el dial.
N=12;verts=[];faces=[]
for radius,z in [(.061,0),(.067,.011),(.063,.026),(.051,.027)]:
    verts.extend((radius*math.cos(i*math.tau/N),radius*math.sin(i*math.tau/N),z) for i in range(N))
for j in range(3):
    for i in range(N):k=(i+1)%N;faces.append((j*N+i,j*N+k,(j+1)*N+k,(j+1)*N+i))
mesh('Caja biselada',verts,faces,'metal')
mesh('Dial',[(0,0,.027)]+[(.051*math.cos(i*math.tau/N),.051*math.sin(i*math.tau/N),.027) for i in range(N)],[(0,i+1,(i+1)%N+1) for i in range(N)],'dial')
for i in range(4):
    theta=i*math.tau/4;box('Índice',(.038*math.sin(theta),.038*math.cos(theta),.029),(.004,.011,.003),'mark',0,theta)
for x,y in [(-.014,.019),(.018,.025)]:
    length=math.hypot(x,y);box('Aguja',(x/2,y/2,.033),(.005,length,.003),'hand',0,-math.atan2(x,y))
box('Corona',(.069,0,.014),(.012,.016,.015),'metal',.002);finish('watchFace')
# Marco abierto: deja ver los ojos originales. Se escala a la cabeza del muñeco.
frame('Montura',1,1,.12,.7,'frame');finish('glassesFrame')
mesh('Nudo trapezoidal',[(-.05,.045,0),(.05,.045,0),(.03,-.045,0),(-.03,-.045,0),(-.045,.04,.032),(.045,.04,.032),(.025,-.04,.032),(-.025,-.04,.032)],[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7),(3,2,1,0)],'fabric');finish('tieKnot')
frame('Clip de tirante',.055,.072,.009,.012,'metal');finish('clip')
box('Tirador de cierre',(0,0,.011),(.02,.046,.012),'metal',.003);finish('zipPull')
# Exportación antes de ordenar el taller: las mallas conservan su sistema local.
path=os.path.join(root,'public/models/accesorios/pulidos.json');os.makedirs(os.path.dirname(path),exist_ok=True)
with open(path,'w') as f:json.dump(assets,f,separators=(',',':'))
print('ACCESORIOS:',{name:sum(len(p['idx'])//3 for p in d['parts']) for name,d in assets.items()})
for i,o in enumerate(bpy.context.scene.objects):o.location.x+=i*.22
os.makedirs(os.path.dirname(preview),exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=preview)

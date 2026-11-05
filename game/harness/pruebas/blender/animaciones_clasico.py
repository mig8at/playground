# Acciones adicionales del esqueleto clásico (FUGA, 2026-10-13).
# blender -b -P animaciones_clasico.py -- BaseCharacter.gltf acciones.glb vistas_dir
# Cada animación parte de una del paquete (Idle, Walk o el final de SitDown) y le cambia algunos huesos: cada hueso se
# APUNTA a una dirección del mundo (adelante = hacia donde mira el muñeco, arriba = +Z), en orden de padre a hijo.
# Las direcciones pueden cambiar en el tiempo (t de 0 a 1 en la vuelta). Se guardan como acciones nuevas y se exporta
# sólo las siete acciones nuevas. vistas_dir se conserva como argumento compatible; no se renderiza.
import bpy,sys,os,math
from mathutils import Vector,Matrix
src,out,VISTAS=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm=[o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0];body=[o for o in bpy.context.scene.objects if o.type=='MESH']
for pb in arm.pose.bones:pb.rotation_mode='QUATERNION'
scene=bpy.context.scene;arm.animation_data_create()
A=lambda n:bpy.data.actions.get(n)
# (correrlo de nuevo no duplica: las que ya estaban se rehacen)
for n in ('Arrest','Cuffed','Walk_Cuffed','Phone','Walk_Phone','Eat_Sitting','Typing'):
  if A(n):bpy.data.actions.remove(A(n))
# ---- hacia dónde mira: los ojos (material Face) respecto de la cabeza ----
hb=arm.data.bones['Head'];hc=arm.matrix_world@hb.head_local
fv=[]
for o in body:
  for p in o.data.polygons:
    if o.data.materials and o.data.materials[p.material_index] and o.data.materials[p.material_index].name=='Face':fv+=[o.matrix_world@o.data.vertices[i].co for i in p.vertices]
fwd=Vector((0,-1,0))
if fv:
  c=sum(fv,Vector())/len(fv);d=c-hc;d.z=0
  if d.length>1e-4:fwd=d.normalized()
side=Vector((0,0,1)).cross(fwd).normalized()  # (hacia la izquierda del muñeco: +L)
print('ADELANTE',[round(x,2) for x in fwd],'IZQUIERDA',[round(x,2) for x in side])
def W(x,y,z):  # (x: a su izquierda, y: adelante, z: arriba) → mundo
  return (side*x+fwd*y+Vector((0,0,1))*z).normalized()
def aim(n,d):
  pb=arm.pose.bones[n];bpy.context.view_layer.update()
  M=arm.matrix_world@pb.matrix;h=M.translation;t=arm.matrix_world@(pb.matrix@Vector((0,pb.length,0)))
  q=(t-h).normalized().rotation_difference(d)
  R=q.to_matrix().to_4x4()@Matrix(M.to_3x3()).to_4x4();R.translation=h
  pb.matrix=arm.matrix_world.inverted()@R
def twist(n,ax,ang):  # girar un hueso en su propio eje local
  pb=arm.pose.bones[n];from mathutils import Quaternion;pb.rotation_quaternion=pb.rotation_quaternion@Quaternion(ax,ang)
def mirror(d):return (-d[0],d[1],d[2])
def make(name,base,frames,apply,base_frame=None):
  b=A(base);f0,f1=b.frame_range;rec=[]
  for i in range(frames+1):
    t=i/frames;arm.animation_data.action=b;scene.frame_set(int(base_frame if base_frame is not None else f0+(f1-f0)*t))
    bpy.context.view_layer.update();apply(t);bpy.context.view_layer.update()
    rec.append({pb.name:(pb.location.copy(),pb.rotation_quaternion.copy()) for pb in arm.pose.bones})
  act=bpy.data.actions.new(name);arm.animation_data.action=act
  for i,r in enumerate(rec):
    for n,(l,q) in r.items():
      pb=arm.pose.bones[n];pb.location=l;pb.rotation_quaternion=q
      pb.keyframe_insert('location',frame=i*2);pb.keyframe_insert('rotation_quaternion',frame=i*2)
  act.use_fake_user=True;print('ANIMACION',name,frames*2,'cuadros')
ss=lambda x:x*x*(3-2*x)
lerp=lambda a,b,t:tuple(a[k]+(b[k]-a[k])*t for k in range(3))
S=lambda t:math.sin(t*2*math.pi)
# ---- esposar (el policía): los dos brazos hacia adelante y abajo, las manos juntas a la altura de la cadera ----
def esposar(t):
  for s,m in (('L',1),('R',-1)):
    aim('UpperArm.'+s,W(.12*m,.3,-.95));aim('LowerArm.'+s,W(-.45*m,.85,-.28+.05*S(t*2)))
make('Arrest','Idle',24,esposar)
# ---- esposado: las manos atrás (juntas en la espalda) y la cabeza un poco gacha; quieto y caminando ----
def esposado(t):
  for s,m in (('L',1),('R',-1)):
    aim('UpperArm.'+s,W(.22*m,-.45,-.85));aim('LowerArm.'+s,W(-.8*m,-.35,-.15))
  aim('Head',W(0,.32,1))
make('Cuffed','Idle',24,esposado);make('Walk_Cuffed','Walk',15,esposado)
# ---- celular: la mano derecha en la oreja, la cabeza inclinada hacia el teléfono; quieto y caminando ----
def celular(t):
  aim('UpperArm.R',W(-.55,.55,.25));aim('LowerArm.R',W(.55,.15,.85));aim('Head',W(-.04,.02,1))
make('Phone','Idle',24,celular);make('Walk_Phone','Walk',15,celular)
# ---- comer sentado: la izquierda apoyada en la mesa; la derecha va del plato a la boca y vuelve (2 s) ----
def comer(t):
  aim('UpperArm.L',W(.12,.45,-.88));aim('LowerArm.L',W(-.15,1,.08))
  k=ss(max(0,min(1,(math.sin(t*2*math.pi-math.pi/2)+1)/2*1.4-.2)))
  aim('UpperArm.R',W(*lerp((-.12,.5,-.86),(-.25,.75,-.3),k)));aim('LowerArm.R',W(*lerp((.1,1,.05),(.55,.2,.9),k)))
  aim('Head',W(0,.15+.1*(1-k),1))
sd=A('SitDown');make('Eat_Sitting','SitDown',24,comer,base_frame=int(sd.frame_range[1]))
# ---- teclear sentado: los antebrazos horizontales hacia el teclado; las manos suben y bajan a destiempo ----
def teclear(t):
  for s,m in (('L',1),('R',-1)):
    aim('UpperArm.'+s,W(.12*m,.62,-.78));aim('LowerArm.'+s,W(-.22*m,1,.02+.07*S(t*3+(0 if s=='L' else .5))))
  aim('Head',W(0,.22,1))
make('Typing','SitDown',24,teclear,base_frame=int(sd.frame_range[1]))

# Sólo las acciones nuevas: el cuerpo original no se reemplaza.
keep={'Arrest','Cuffed','Walk_Cuffed','Phone','Walk_Phone','Eat_Sitting','Typing'}
arm.animation_data.action=None
for a in list(bpy.data.actions):
  if a.name not in keep:bpy.data.actions.remove(a)
for track in list(arm.animation_data.nla_tracks):arm.animation_data.nla_tracks.remove(track)
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
for o in body:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')

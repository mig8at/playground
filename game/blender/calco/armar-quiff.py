# Arma quiff-calco.blend: nuestra cabeza calva (pose de atado) + las vistas del quiff como imágenes de referencia
# alineadas + una Ico Sphere para empezar a calcar. blender -b --factory-startup -P armar-quiff.py
import bpy, os, math
from mathutils import Vector
D=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
# 1. La cabeza (OBJ en Y arriba → Blender Z arriba; el frente del muñeco queda hacia −Y, la vista Frontal)
bpy.ops.wm.obj_import(filepath=os.path.join(D,'cabeza-h.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
head=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in head:
    o.hide_select=True
    for p in o.data.polygons: p.use_smooth=False
# 2. Referencias: el recuadro del dibujo (lo que no es fondo gris claro) se mide en cada imagen
def bbox(img):
    # (el tramo de columnas con dibujo más ancho: los recortes de la lámina traen bordes de la cabeza vecina)
    w,h=img.size; px=img.pixels[:]
    fg=lambda x,y:(lambda r,g,b:not((max(r,g,b)-min(r,g,b))/(max(r,g,b) or 1)<.1 and max(r,g,b)>.8))(*px[(y*w+x)*4:(y*w+x)*4+3])
    cols=[sum(1 for y in range(0,h,3) if fg(x,y)) for x in range(w)]
    runs=[];s=None
    for x,c in enumerate(cols+[0]):
        if c>2 and s is None: s=x
        if c<=2 and s is not None: runs.append((s,x-1)); s=None
    x0,x1=max(runs,key=lambda r:r[1]-r[0])
    ys=[h-1-y for y in range(h) for x in range(x0,x1+1,3) if fg(x,y)]
    return x0,min(ys),x1,max(ys),w,h
def brow(img,box):
    # (la primera fila, desde arriba, con varios píxeles casi negros: el borde de arriba de las cejas)
    w,h=img.size; px=img.pixels[:]; x0,y0,x1,y1=box[:4]
    for yy in range(y0,y1):
        y=h-1-yy; n=0
        for x in range(x0,x1):
            i=(y*w+x)*4
            if max(px[i],px[i+1],px[i+2])<.18: n+=1
        if n>(x1-x0)*.06: return yy
    return None
def ref(name,file,loc,rot,u,cx,cy):
    img=bpy.data.images.load(os.path.join(D,file)); img.pack()
    e=bpy.data.objects.new(name,None); e.empty_display_type='IMAGE'; e.data=img
    w,h=img.size; e.empty_display_size=max(w,h)*u
    e.empty_image_offset=(-.5-(cx-w/2)/w, -.5+(cy-h/2)/h)   # el punto (cx,cy) del dibujo cae en el centro del vacío
    e.location=loc; e.rotation_euler=[math.radians(a) for a in rot]
    e.empty_image_depth='BACK'; e.color[3]=.55; e.use_empty_image_alpha=True
    e.show_empty_image_perspective=False   # sólo en las vistas ortogonales (1, 3, Ctrl+1, 7)
    e.empty_image_side='FRONT'            # cada referencia se ve sólo desde su lado
    bpy.context.scene.collection.objects.link(e); return e
EARS=1.092; BROW=2.758
imgs={k:bpy.data.images.load(os.path.join(D,f)) for k,f in [('f','ref-frente.png'),('s','ref-perfil.png'),('b','ref-atras.png'),('t','ref-arriba.png')]}
bf=bbox(imgs['f']); uf=EARS/(bf[2]-bf[0]); brf=brow(imgs['f'],bf)
topZ=BROW+(brf-bf[1])*uf          # la altura de la coronilla, según el frente
ref('Ref · Frente','ref-frente.png',(0,1.5,BROW),(90,0,0),uf,(bf[0]+bf[2])/2,brf)
bs=bbox(imgs['s']); us=uf*(bf[3]-bf[1])/(bs[3]-bs[1])
ref('Ref · Perfil izquierdo','ref-perfil.png',(-1.5,0,topZ),(90,0,90),us,(bs[0]+bs[2])/2,bs[1])
bb=bbox(imgs['b']); ub=EARS/(bb[2]-bb[0])
ref('Ref · Atrás','ref-atras.png',(0,-1.5,topZ),(90,0,180),ub,(bb[0]+bb[2])/2,bb[1])
bt=bbox(imgs['t']); ut=EARS/(bt[2]-bt[0])
ref('Ref · Arriba','ref-arriba.png',(0,0,1.2),(0,0,0),ut,(bt[0]+bt[2])/2,(bt[1]+bt[3])/2)
e=ref('Ref · Tres cuartos (lámina, sin alinear)','ref-tres-cuartos.png',(2.2,0,2.6),(90,0,0),uf,384,384); e.show_empty_image_perspective=True
for i in imgs.values(): bpy.data.images.remove(i)
# 3. El pelo: una Ico Sphere de subdivisión 2 un poco más grande que el cráneo, con espejo en X y sombreado plano
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.6,location=(0,0,2.75))
pelo=bpy.context.active_object; pelo.name='Pelo'; pelo.scale=(1.0,1.0,.85)
m=pelo.modifiers.new('Espejo X','MIRROR'); m.use_axis[0]=True; m.use_bisect_axis[0]=True; m.use_clip=True
mat=bpy.data.materials.new('pelo'); mat.diffuse_color=(0.147,0.058,0.019,1)
pelo.data.materials.append(mat)
for o in head:
    for s in o.material_slots:
        if s.material: s.material.diffuse_color=(*s.material.diffuse_color[:3],1)
# 4. Instrucciones dentro del archivo
t=bpy.data.texts.new('LEEME'); t.write("""CALCO DEL QUIFF
- La cabeza (Cabeza, Rasgos) es la del juego en la pose de atado: no se edita (no se puede seleccionar).
- Las referencias se ven en las vistas ortogonales: 1 Frente, 3 Perfil (lado izquierdo del muñeco), Ctrl+1 Atrás, 7 Arriba.
  Si alguna no calza bien, mové su vacío (Ref · ...): la escala sale de la imagen y puede estar corrida unos milímetros.
- 'Pelo' es una Ico Sphere de subdivisión 2 con Espejo en X: editala (Tab), mové vértices con Edición proporcional (O),
  Poke Faces / Extrude para los mechones del copete. Sombreado plano: así se ve en el juego.
- Al terminar: seleccioná SÓLO 'Pelo', File > Export > glTF 2.0 (.glb), marcar 'Selected Objects' y 'Apply Modifiers',
  guardar como quiff-calco.glb en esta carpeta. El juego lo importa y lo mide contra la lámina.
- Unidades del modelo: la cabeza mide ~1 de ancho (orejas ±0,546), cejas a z 2,758.
""")
bpy.context.scene.unit_settings.system='NONE'
# (al abrir: vista frontal ortogonal, sombreado plano y X-ray suave para ver la referencia a través de la cabeza)
for scr in bpy.data.screens:
    for area in scr.areas:
        if area.type=='VIEW_3D':
            sp=area.spaces.active; sp.shading.light='FLAT'; sp.shading.show_xray=True; sp.shading.xray_alpha=.6
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D,'quiff-calco.blend'))
print('OK',{o.name:(tuple(round(v,3) for v in o.location),round(o.empty_display_size,3)) for o in bpy.data.objects if o.type=='EMPTY'})

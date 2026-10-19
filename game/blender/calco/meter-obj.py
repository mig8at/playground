# Mete quiff-pegado.obj en quiff-calco.blend, ajustado a nuestra cabeza, y renderiza frente y perfil para revisar.
import bpy, os, math
D=os.path.dirname(os.path.abspath(__file__)); bpy.ops.wm.open_mainfile(filepath=os.path.join(D,'quiff-calco.blend'))
# (el OBJ ya viene en Z arriba y frente −Y, como Blender: se importa sin girar)
bpy.ops.wm.obj_import(filepath=os.path.join(D,'quiff-pegado.obj'),forward_axis='Y',up_axis='Z')
o=bpy.context.selected_objects[0]; o.name='Pelo · OBJ pegado'; o.scale=(.56,.56,.56); o.location=(0,0,2.55)
mat=bpy.data.materials.get('pelo'); o.data.materials.clear(); o.data.materials.append(mat)
for p in o.data.polygons: p.use_smooth=False
bpy.data.objects['Pelo'].hide_set(True); bpy.data.objects['Pelo'].hide_render=True
bpy.ops.wm.save_mainfile()
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.render.resolution_x=sc.render.resolution_y=420; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='MATERIAL'
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'; cam.data.ortho_scale=1.9
for e in [x for x in sc.objects if x.type=='EMPTY']: e.hide_render=True
for n,loc,rot in [('frente',(0,-5,2.75),(90,0,0)),('perfil',(5,0,2.75),(90,0,90)),('atras',(0,5,2.75),(90,0,180)),('tres',(3.5,-3.5,3.3),(80,0,45))]:
    cam.location=loc; cam.rotation_euler=[math.radians(a) for a in rot]; cam.data.type='ORTHO' if n!='tres' else 'PERSP'
    if n=='tres': cam.data.lens=60
    sc.render.filepath=os.path.join(D,'_o-'+n+'.png'); bpy.ops.render.render(write_still=True)

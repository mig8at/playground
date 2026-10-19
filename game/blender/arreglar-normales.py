# Reorienta las caras de un OBJ (todas hacia afuera, coherentes) y lo vuelve a escribir con el mismo formato y orden.
import bpy, bmesh, sys
a=sys.argv[sys.argv.index('--')+1:]; src,dst=a
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src,forward_axis='Y',up_axis='Z'); o=bpy.context.selected_objects[0]
bm=bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(o.data); bm.free()
head=[l for l in open(src) if l.startswith('#')]; name=[l for l in open(src) if l.startswith('o ')]
with open(dst,'w') as f:
    f.writelines(head+['# (caras reorientadas hacia afuera)\n']+name)
    for v in o.data.vertices: f.write('v %.3f %.3f %.3f\n'%tuple(v.co))
    for p in o.data.polygons: f.write('f '+' '.join(str(i+1) for i in p.vertices)+'\n')
print('OK',len(o.data.vertices),len(o.data.polygons))

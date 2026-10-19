"""Perfil de tela doblada, con biseles planos y cuatro puntos.
blender -b --factory-startup -P scripts/blender/dobladillos.py -- game_dir prototipo.blend
El juego extruye este perfil sobre los bordes de cada prenda ya ajustada al cuerpo.
"""
import bpy, sys, os, json, math
root, preview=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
# (distancia hacia dentro de la tela, salida respecto de su superficie), normalizado.
profile=[(0,-.12),(.06,.8),(.76,1),(1,.04)]
segments=16;width=.045;thickness=.016;radius=.16
vertices=[]
for u,v in profile:
    for i in range(segments):
        a=i*math.tau/segments
        vertices.append(((radius+v*thickness)*math.cos(a),(radius+v*thickness)*math.sin(a),u*width))
faces=[]
for j in range(len(profile)-1):
    for i in range(segments):
        k=(i+1)%segments;faces.append((j*segments+i,j*segments+k,(j+1)*segments+k,(j+1)*segments+i))
mesh=bpy.data.meshes.new('Dobladillo biselado');mesh.from_pydata(vertices,[],faces);mesh.update()
obj=bpy.data.objects.new('Puño doblado low poly',mesh);bpy.context.collection.objects.link(obj)
for factor in [.72,.94,.86]:
    mat=bpy.data.materials.new('Tela '+str(factor));mat.diffuse_color=(.12*factor,.22*factor,.36*factor,1);obj.data.materials.append(mat)
for face in mesh.polygons:face.material_index=face.index//segments;face.use_smooth=False
os.makedirs(os.path.dirname(preview),exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=preview)
# Medido sobre el prototipo de Blender; sólo se conserva la sección, la malla la arma
# Three con los pesos y colores de la prenda. No cambia esqueletos ni animaciones.
points=[]
for j in range(len(profile)):
    p=mesh.vertices[j*segments].co;points.append([round(p.z/width,5),round((p.x-radius)/thickness,5)])
path=os.path.join(root,'public/models/dobladillos/perfil.json');os.makedirs(os.path.dirname(path),exist_ok=True)
with open(path,'w') as f:json.dump(dict(profile=points,tones=[.72,.94,.86],width=width,thickness=thickness),f,separators=(',',':'))
print('DOBLADILLO:',len(mesh.polygons)*2,'triángulos en prototipo; perfil:',points)

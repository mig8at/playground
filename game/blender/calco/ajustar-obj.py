import bpy, os
D=os.path.dirname(os.path.abspath(__file__)); bpy.ops.wm.open_mainfile(filepath=os.path.join(D,'quiff-calco.blend'))
o=bpy.data.objects['Pelo · OBJ pegado']; o.scale=(.62,.62,.58); o.location=(0,.01,2.54)
bpy.data.objects['Pelo'].hide_set(False)
bpy.ops.wm.save_mainfile(); print('OK')

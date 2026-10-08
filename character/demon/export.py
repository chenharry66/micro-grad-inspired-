"""Export the authored Blender character. Run with Blender --background --python export.py."""
import bpy
from pathlib import Path
root=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'miso.blend'))
rig=bpy.data.objects['Miso rig']
for obj in list(bpy.context.scene.objects):
    if obj.name.startswith('EyeFlame'): bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.name=='SeatContact' or obj.name.startswith('ClawContact_') or any(m.type=='ARMATURE' and m.object==rig for m in obj.modifiers):obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(root/'miso.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')

"""Bake UV AO sidecars only; original GLB rigs/animations remain byte-identical."""
import bpy, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'public/assets/creatures/ao';OUT.mkdir(exist_ok=True)
manifest={}
for kind in ['bird','cat','dragon','fish','fox','jelly','spirit']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/creatures'/f'{kind}.glb'))
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
 meshes=[o for o in scene.objects if o.type=='MESH' and o.data.uv_layers]
 bpy.ops.object.select_all(action='DESELECT')
 materials={}
 for obj in meshes:
  obj.select_set(True)
  for slot in obj.material_slots:
   mat=slot.material
   if mat is None or mat.name in materials:continue
   mat.use_nodes=True
   im=bpy.data.images.new(f'{kind}-{len(materials)}',width=256,height=256,alpha=False)
   im.generated_color=(1,1,1,1);im.colorspace_settings.name='Non-Color'
   node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;mat.node_tree.nodes.active=node
   materials[mat.name]=im
 bpy.context.view_layer.objects.active=meshes[0]
 scene.render.bake.margin=8
 bpy.ops.object.bake(type='AO')
 manifest[kind]={}
 for name,im in materials.items():
  filename=im.name+'.png';im.filepath_raw=str(OUT/filename);im.file_format='PNG';im.save();manifest[kind][name]='/assets/creatures/ao/'+filename
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))

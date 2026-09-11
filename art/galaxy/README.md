# Cinematic galaxy source

`cinematic-galaxy.blend` was generated in Blender 5.2.1. It contains the editable stellar disk, foreground star population, camera, and packed emission, dust, and deep-field images. No downloaded imagery or model replacements are used.

Regenerate from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/visual/bake-galaxy.py
node scripts/visual/compress-assets.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/visual/bake-creature-ao.py
```

The generator writes intermediate PNGs and a scene to `artifacts/galaxy/source`; the compressor writes responsive WebP assets to `public/assets/galaxy`. Copy the regenerated `.blend` here when changing the art direction. The bake uses deterministic seeds. The deep field is a separate image, avoiding a second galactic core in the reveal.

Creature AO is baked at 256² with eight-pixel UV padding into separate PNGs, keyed by original material names in `public/assets/creatures/ao/manifest.json`. All seven original GLBs, their UVs, skeletons and clips remain unchanged. Runtime AO strength is deliberately mild (0.38); it modulates indirect light, with no screen-space AO pass. Original model credits remain in the product.

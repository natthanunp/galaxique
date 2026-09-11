"use client";

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

/** Non-suspending local textures: failed loads keep a valid, disposable fallback. */
export function useBakedTexture(url: string, fallback: number = 0, srgb = true) {
  const placeholder = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([fallback, fallback, fallback, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }, [fallback]);
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture } | null>(null);
  useEffect(() => {
    let active = true;
    const texture = new THREE.TextureLoader().load(url, () => {
      if (active) setLoaded({ url, texture });
    }, undefined, () => { /* Leave the procedural/fallback layer visible. */ });
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 1;
    return () => { active = false; texture.dispose(); };
  }, [url, srgb]);
  useEffect(() => () => placeholder.dispose(), [placeholder]);
  return loaded?.url === url ? loaded.texture : placeholder;
}

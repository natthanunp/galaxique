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
  const [loaded, setLoaded] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let active = true;
    const texture = new THREE.TextureLoader().load(url, () => {
      if (active) setLoaded(texture);
      else texture.dispose();
    }, undefined, () => { texture.dispose(); /* Keep the current/fallback layer visible. */ });
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 1;
    return () => { active = false; };
  }, [url, srgb]);
  // Keep the previous texture on screen until its replacement has loaded; a
  // live quality-tier change swaps the URL and would otherwise flash the placeholder.
  useEffect(() => () => loaded?.dispose(), [loaded]);
  useEffect(() => () => placeholder.dispose(), [placeholder]);
  return loaded ?? placeholder;
}

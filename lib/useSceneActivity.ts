"use client";
import { useSyncExternalStore } from 'react';
const subscribe = (callback: () => void) => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', callback);
  motion.addEventListener('change', callback);
  return () => { document.removeEventListener('visibilitychange', callback); motion.removeEventListener('change', callback); };
};
export function useSceneActivity() {
  return useSyncExternalStore(subscribe,
    () => !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false);
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { HomeIcon, LocateFixedIcon, MinusIcon, PlusIcon, RotateCcwIcon, UsersIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getOwnedWorlds } from "@/lib/ownedWorlds";
import { GALAXY_RADIUS, hash32, loadArmField, placeOnArms, thaiDayColor, type ArmField } from "@/lib/galaxyLayout";
import { isMobileDevice, targetDpr } from "@/lib/perf";
import { humanizeCreatureKind } from "@/lib/creatureKind";
import { useSceneActivity } from "@/lib/useSceneActivity";
import { soundtrack, useSoundtrack } from "@/lib/soundtrack";
import { SpiralGalaxy } from "@/three/objects/SpiralGalaxy";
import { Meteors } from "@/three/objects/Meteors";
import type { WorldSummary } from "@/lib/worldStore";
import type { LegacyStar } from "@/lib/constellationStore";
import type { Language } from "@/types/universe";

const TILT = -0.49; // ~28° from face-on keeps both arms readable on phones.
const HOME_DISTANCE = 12.5;
const CLUSTER_DISTANCE = 9;
const CAMERA_KEY = "galaxique-galaxy-camera";
const INTRO_SECONDS = 1.6;
const PICK_RADIUS_PX = 28;

interface Planet extends WorldSummary { local: THREE.Vector3; angle: number }

const CELESTIAL_LABEL: Record<string, Record<Language, string>> = {
  galaxy: { en: "galaxy", th: "กาแล็กซี" },
  black_hole: { en: "black hole", th: "หลุมดำ" },
  neutron_star: { en: "neutron star", th: "ดาวนิวตรอน" },
};

/** Keeps each reveal's hue but ensures it is saturated enough to read against the galaxy. */
function vividColor(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.max(hsl.s, 0.75), THREE.MathUtils.clamp(hsl.l, 0.42, 0.58));
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function fetchAllWorlds(): Promise<WorldSummary[]> {
  const all: WorldSummary[] = [];
  let before: number | null = Date.now() + 1;
  while (before && all.length < 2000) {
    const res: Response = await fetch(`/api/worlds?before=${before}&limit=200`);
    const data = await res.json();
    if (!data.success) break;
    all.push(...data.worlds);
    before = data.next;
  }
  return all;
}

/** Galaxy group offset so the CTA has room: up on portrait, right on landscape. */
function useGalaxyOffset(): [number, number, number] {
  const { size } = useThree();
  return size.height > size.width ? [0, 1.6, 0] : [2.2, 0.2, 0];
}

function CameraRig({ controls, goal }: {
  controls: React.RefObject<OrbitControlsImpl | null>;
  goal: React.RefObject<{ position: THREE.Vector3; target: THREE.Vector3 } | null>;
}) {
  const { camera, invalidate } = useThree();
  useFrame((_, delta) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-delta * 4);
    camera.position.lerp(g.position, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.position) < 0.01 && c.target.distanceTo(g.target) < 0.01) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Touch: one finger scrolls the page, two fingers pan/zoom the galaxy. */
function TouchScrollGuard({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  useEffect(() => {
    // The controls reset touch-action to "none" on connect; vertical one-finger drags should scroll the page.
    const touch = () => { const el = controls.current?.domElement; if (el) el.style.touchAction = "pan-y"; };
    touch();
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", touch, { capture: true });
  }, [controls]);
  return null;
}

function ZoomWatcher({ controls, onChange }: { controls: React.RefObject<OrbitControlsImpl | null>; onChange: (zoomedOut: boolean) => void }) {
  const { camera } = useThree();
  const last = useRef<boolean | null>(null);
  useFrame(() => {
    const target = controls.current?.target ?? new THREE.Vector3();
    const zoomedOut = camera.position.distanceTo(target) > CLUSTER_DISTANCE;
    if (zoomedOut !== last.current) {
      last.current = zoomedOut;
      onChange(zoomedOut);
    }
  });
  return null;
}

interface SceneProps {
  field: ArmField;
  planets: Planet[];
  legacy: LegacyStar[];
  focusedId: string | null;
  zoomedOut: boolean;
  gather: { current: number };
  animate: boolean;
  starCount: number;
  groupRef: React.RefObject<THREE.Group | null>;
  onPick: (planet: Planet) => void;
  onCluster: (center: THREE.Vector3, only?: Planet) => void;
}

function GalaxyScene({ field, planets, legacy, focusedId, zoomedOut, gather, animate, starCount, groupRef, onPick, onCluster }: SceneProps) {
  const offset = useGalaxyOffset();
  const planetMesh = useRef<THREE.InstancedMesh>(null);
  const clusterMesh = useRef<THREE.InstancedMesh>(null);
  const dayColor = useMemo(() => thaiDayColor(), []);

  const clusters = useMemo(() => {
    const cells = new Map<string, { sum: THREE.Vector3; count: number; color: THREE.Color; first: Planet }>();
    for (const p of planets) {
      const key = `${Math.floor(p.local.x / 1.1)}:${Math.floor(p.local.y / 1.1)}`;
      const cell = cells.get(key) ?? { sum: new THREE.Vector3(), count: 0, color: vividColor(p.primary_color), first: p };
      cell.sum.add(p.local);
      cell.count++;
      cells.set(key, cell);
    }
    return [...cells.values()].map((c) => ({ center: c.sum.divideScalar(c.count), count: c.count, color: c.color, only: c.count === 1 ? c.first : undefined }));
  }, [planets]);

  useEffect(() => {
    const mesh = planetMesh.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    planets.forEach((p, i) => {
      const s = 0.08 + (hash32(p.id, 9) / 4294967296) * 0.04;
      m.compose(p.local, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, vividColor(p.primary_color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [planets]);

  useEffect(() => {
    const mesh = clusterMesh.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    clusters.forEach((c, i) => {
      const s = 0.12 + Math.sqrt(c.count) * 0.05;
      m.compose(c.center, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [clusters]);

  const legacyGeometry = useMemo(() => {
    const positions = new Float32Array(legacy.length * 3);
    const colors = new Float32Array(legacy.length * 3);
    const c = new THREE.Color();
    legacy.forEach((star, i) => {
      positions.set(placeOnArms(field, `legacy:${star.seed}`), i * 3);
      c.set(star.color).lerp(new THREE.Color("#ffffff"), 0.5);
      colors.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [legacy, field]);

  useFrame((_, delta) => {
    if (groupRef.current && animate) groupRef.current.rotation.z += delta * 0.012;
  });

  const { camera, gl } = useThree();
  // Screen-space picking: the dots are tiny at distance, so mesh raycasts miss often.
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const group = groupRef.current;
      if (!down || !group || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      group.updateWorldMatrix(true, false);
      const rect = el.getBoundingClientRect();
      const v = new THREE.Vector3();
      let best = -1;
      let bestDist = PICK_RADIUS_PX;
      const points = zoomedOut ? clusters.map((c) => c.center) : planets.map((p) => p.local);
      points.forEach((pt, i) => {
        v.copy(pt).applyMatrix4(group.matrixWorld).project(camera);
        if (v.z > 1) return;
        const x = ((v.x + 1) / 2) * rect.width + rect.left;
        const y = ((1 - v.y) / 2) * rect.height + rect.top;
        const d = Math.hypot(x - e.clientX, y - e.clientY);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best < 0) return;
      if (zoomedOut) onCluster(clusters[best].center, clusters[best].only);
      else onPick(planets[best]);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, groupRef, zoomedOut, clusters, planets, onPick, onCluster]);

  const focused = planets.find((p) => p.id === focusedId);

  return (
    <>
    <Meteors animate={animate} />
    <group position={offset} rotation={[TILT, 0, 0]}>
      <group ref={groupRef}>
        <SpiralGalaxy field={field} starCount={starCount} gather={gather} dayColor={dayColor} animate={animate} />
        {/* Legacy summaries: decorative only, never selectable. */}
        <points geometry={legacyGeometry} raycast={() => null}>
          <pointsMaterial size={0.05} vertexColors transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
        <instancedMesh
          key={`planets-${planets.length}`}
          ref={planetMesh}
          args={[undefined, undefined, Math.max(1, planets.length)]}
          visible={!zoomedOut && planets.length > 0}
          onPointerOver={() => { document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
        <instancedMesh
          key={`clusters-${clusters.length}`}
          ref={clusterMesh}
          args={[undefined, undefined, Math.max(1, clusters.length)]}
          visible={zoomedOut && clusters.length > 0}
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
        {focused && !zoomedOut && (
          <Billboard position={focused.local}>
            <mesh>
              <ringGeometry args={[0.16, 0.2, 40]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          </Billboard>
        )}
      </group>
    </group>
    </>
  );
}

export function GalaxyExplorer({ language }: { language: Language }) {
  const router = useRouter();
  const animate = useSceneActivity();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [field, setField] = useState<ArmField | null>(null);
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [legacy, setLegacy] = useState<LegacyStar[]>([]);
  const [selected, setSelected] = useState<Planet | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [zoomedOut, setZoomedOut] = useState(true);
  const [introDone, setIntroDone] = useState(false);
  const [owned, setOwned] = useState<string[]>([]);
  const [dpr, setDpr] = useState(1);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const gather = useRef(0);
  const reducedMotion = useRef(false);
  useSoundtrack("galaxy");

  useEffect(() => {
    // Browser-only capability checks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebgl(hasWebGL());
    setDpr(targetDpr());
    setOwned(Object.keys(getOwnedWorlds()));
    // The saved camera is only for returning from a world page, not for a page refresh.
    const forgetCamera = () => sessionStorage.removeItem(CAMERA_KEY);
    window.addEventListener("pagehide", forgetCamera);
    reducedMotion.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saved = sessionStorage.getItem(CAMERA_KEY);
    if (saved || reducedMotion.current) {
      gather.current = 1;
      setIntroDone(true);
    }
    void loadArmField().then(setField).catch(() => setWebgl(false));
    void fetchAllWorlds().then(setWorlds).catch(() => {});
    fetch("/api/constellation").then((r) => r.json()).then((d) => { if (d.success) setLegacy(d.stars); }).catch(() => {});
    return () => window.removeEventListener("pagehide", forgetCamera);
  }, []);

  const planets: Planet[] = useMemo(() => field ? worlds.map((w) => {
    const [x, y, z] = placeOnArms(field, w.id);
    return { ...w, local: new THREE.Vector3(x, y, z), angle: Math.atan2(y, x) };
  }).sort((a, b) => a.angle - b.angle) : [], [field, worlds]);

  const skipIntro = useCallback(() => {
    gather.current = 1;
    setIntroDone(true);
  }, []);

  useEffect(() => {
    if (introDone || !field) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      gather.current = Math.min(1, (now - start) / (INTRO_SECONDS * 1000));
      if (gather.current >= 1) setIntroDone(true);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [introDone, field]);

  const worldPosition = useCallback((local: THREE.Vector3) => {
    const group = groupRef.current;
    return group ? group.localToWorld(local.clone()) : local.clone();
  }, []);

  const flyTo = useCallback((point: THREE.Vector3, distance: number) => {
    const camera = controls.current?.object;
    if (!camera) return;
    const direction = camera.position.clone().sub(controls.current!.target).normalize();
    goal.current = { target: point.clone(), position: point.clone().add(direction.multiplyScalar(distance)) };
  }, []);

  const focusPlanet = useCallback((planet: Planet) => {
    skipIntro();
    setSelected(planet);
    setFocusIndex(planets.indexOf(planet));
    flyTo(worldPosition(planet.local), 3.2);
  }, [planets, flyTo, worldPosition, skipIntro]);

  const zoomBy = useCallback((factor: number) => {
    const c = controls.current;
    if (!c) return;
    skipIntro();
    // Build on the pending goal so rapid clicks keep compounding.
    const from = goal.current?.position ?? c.object.position;
    const target = goal.current?.target ?? c.target;
    const offset = from.clone().sub(target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, 1.2, GALAXY_RADIUS * 4);
    goal.current = { target: target.clone(), position: target.clone().add(offset.setLength(distance)) };
  }, [skipIntro]);

  const resetView = useCallback(() => {
    setSelected(null);
    goal.current = { position: new THREE.Vector3(0, 0, HOME_DISTANCE), target: new THREE.Vector3(0, 0, 0) };
  }, []);

  const land = useCallback((planet: Planet) => {
    soundtrack().unlock();
    const c = controls.current;
    if (c) {
      sessionStorage.setItem(CAMERA_KEY, JSON.stringify({ position: c.object.position.toArray(), target: c.target.toArray() }));
    }
    router.push(`/w/${planet.id}`);
  }, [router]);

  const myPlanet = useCallback(() => {
    const planet = planets.find((p) => owned.includes(p.id));
    if (planet) focusPlanet(planet);
    else if (owned[0]) {
      soundtrack().unlock();
      router.push(`/w/${owned[0]}`);
    }
  }, [planets, owned, focusPlanet, router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(0.6); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 0.6); return; }
    if (!planets.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusPlanet(planets[(focusIndex + 1) % planets.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusPlanet(planets[(focusIndex - 1 + planets.length) % planets.length]);
    } else if (e.key === "Enter" && selected) {
      land(selected);
    } else if (e.key === "Escape") {
      resetView();
    }
  };

  const t = language === "th"
    ? { label: "กาแล็กซีของโลกที่ถูกเผยแพร่ ใช้ปุ่มลูกศรเพื่อเลือกดาว กด Enter เพื่อลงจอด", reset: "มุมมองเริ่มต้น", zoomIn: "ซูมเข้า", zoomOut: "ซูมออก", mine: "ดาวของฉัน", skip: "ข้าม", land: "เยี่ยมชมโลกนี้", close: "ปิด", world: "โลก", theirs: "โลกของผู้เดินทางคนอื่น", yours: "โลกของคุณ", hint: (n: number) => `${n} โลกจากผู้เดินทางคนอื่น — แตะดาวเพื่อไปเยี่ยม`, empty: "ยังไม่มีโลกที่ถูกเผยแพร่ — เป็นคนแรกเลย!" }
    : { label: "Galaxy of published worlds. Use arrow keys to browse planets and Enter to land.", reset: "Reset view", zoomIn: "Zoom in", zoomOut: "Zoom out", mine: "My planet", skip: "Skip", land: "Visit this world", close: "Close", world: "world", theirs: "Another traveler's world", yours: "Your world", hint: (n: number) => `${n} worlds from other travelers — tap a planet to visit`, empty: "No published worlds yet — be the first!" };

  const announcement = selected
    ? `${focusIndex + 1} / ${planets.length}: ${humanizeCreatureKind(selected.creature_kind, language)} ${t.world}, ${CELESTIAL_LABEL[selected.celestial_type]?.[language] ?? ""}`
    : "";

  if (webgl === false) {
    return (
      <div className="fixed inset-0 -z-0" aria-hidden>
        <picture>
          <source media="(orientation: portrait)" srcSet="/assets/galaxy/galaxy-mobile.webp" />
          <img src="/assets/galaxy/galaxy-desktop.webp" alt="" className="h-full w-full object-cover" />
        </picture>
      </div>
    );
  }

  const savedCamera = typeof window !== "undefined" ? sessionStorage.getItem(CAMERA_KEY) : null;
  const initial = savedCamera ? JSON.parse(savedCamera) as { position: [number, number, number]; target: [number, number, number] } : null;

  return (
    <>
      <div
        className="fixed inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        tabIndex={0}
        role="application"
        aria-label={t.label}
        onKeyDown={onKeyDown}
        onPointerDown={() => { if (!introDone) skipIntro(); }}
      >
        {field && (
          <Canvas
            dpr={dpr}
            frameloop={animate || !introDone ? "always" : "demand"}
            camera={{ position: initial?.position ?? [0, 0, HOME_DISTANCE], fov: 45, near: 0.05, far: 200 }}
            gl={{ antialias: false, powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#03030a"]} />
            <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(targetDpr())} />
            <GalaxyScene
              field={field}
              planets={planets}
              legacy={legacy}
              focusedId={selected?.id ?? null}
              zoomedOut={zoomedOut}
              gather={gather}
              animate={animate}
              starCount={isMobileDevice() ? 9000 : 18000}
              groupRef={groupRef}
              onPick={focusPlanet}
              onCluster={(center, only) => (only ? focusPlanet(only) : flyTo(worldPosition(center), 5))}
            />
            <OrbitControls
              ref={controls}
              target={initial?.target ?? [0, 0, 0]}
              enableRotate={false}
              screenSpacePanning
              enableDamping
              minDistance={1.2}
              maxDistance={GALAXY_RADIUS * 4}
              mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
              touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
              onStart={() => { goal.current = null; }}
            />
            <CameraRig controls={controls} goal={goal} />
            <TouchScrollGuard controls={controls} />
            <ZoomWatcher controls={controls} onChange={setZoomedOut} />
          </Canvas>
        )}
      </div>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {!introDone && field && (
        <button type="button" onClick={skipIntro}
          className="fixed left-1/2 top-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] z-30 -translate-x-1/2 rounded-full bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          {t.skip}
        </button>
      )}

      <div className="fixed right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
        <Button size="icon" variant="ghost" className="rounded-full bg-card/60 backdrop-blur" onClick={() => zoomBy(0.6)} aria-label={t.zoomIn} title={`${t.zoomIn} (+)`}>
          <PlusIcon className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full bg-card/60 backdrop-blur" onClick={() => zoomBy(1 / 0.6)} aria-label={t.zoomOut} title={`${t.zoomOut} (-)`}>
          <MinusIcon className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full bg-card/60 backdrop-blur" onClick={resetView} aria-label={t.reset} title={t.reset}>
          <RotateCcwIcon className="size-4" />
        </Button>
        {owned.length > 0 && (
          <Button size="icon" variant="ghost" className="rounded-full bg-card/60 backdrop-blur" onClick={myPlanet} aria-label={t.mine} title={t.mine}>
            <HomeIcon className="size-4" />
          </Button>
        )}
      </div>

      {introDone && !selected && planets.length > 0 && (
        <p className="pointer-events-none fixed left-1/2 top-[max(6.5rem,calc(env(safe-area-inset-top)+6rem))] z-20 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:translate-x-0">
          <UsersIcon className="size-3.5 shrink-0 text-primary" />
          {t.hint(planets.length)}
        </p>
      )}

      {introDone && planets.length === 0 && worlds.length === 0 && (
        <p className="pointer-events-none fixed left-1/2 top-[38%] z-10 -translate-x-1/2 text-xs text-muted-foreground/70">{t.empty}</p>
      )}

      {selected && (
        <div className="fixed left-1/2 top-[max(5rem,calc(env(safe-area-inset-top)+4.5rem))] z-30 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-card/85 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="size-9 shrink-0 rounded-full" style={{ background: `radial-gradient(circle at 35% 35%, ${selected.secondary_color}, ${selected.primary_color})` }} />
              <div className="text-left">
                <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary">
                  {owned.includes(selected.id) ? <HomeIcon className="size-3" /> : <UsersIcon className="size-3" />}
                  {owned.includes(selected.id) ? t.yours : t.theirs}
                </p>
                <p className="text-sm font-semibold capitalize">{humanizeCreatureKind(selected.creature_kind, language)} {t.world}</p>
                <p className="text-xs text-muted-foreground">{CELESTIAL_LABEL[selected.celestial_type]?.[language]}</p>
              </div>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label={t.close} className="rounded p-1 hover:bg-muted"><XIcon className="size-4" /></button>
          </div>
          <Button className="mt-3 w-full gap-2" onClick={() => land(selected)}>
            <LocateFixedIcon className="size-4" /> {t.land}
          </Button>
        </div>
      )}
    </>
  );
}

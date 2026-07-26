"use client";

import { Suspense, useMemo } from "react";
import { Float } from "@react-three/drei";

import { CosmicBackground } from "./CosmicBackground";
import { ParticleField } from "./ParticleField";
import { CentralSymbolObject } from "@/three/objects/CentralSymbolObject";
import { CreatureModel, hasCreatureModel } from "@/three/objects/CreatureModel";
import { RealisticGalaxy } from "@/three/objects/RealisticGalaxy";
import { BlackHole } from "@/three/objects/BlackHole";
import { NeutronStar } from "@/three/objects/NeutronStar";
import type { UniverseReveal } from "@/types/universe";

interface UniverseSceneProps {
  reveal: UniverseReveal;
}

function celestialSeed(reveal: UniverseReveal): number | undefined {
  const config = reveal.celestial_config;
  if (!config) return undefined;
  switch (config.celestial_type) {
    case "galaxy":
      return config.galaxy.seed;
    case "black_hole":
      return config.black_hole.seed;
    case "neutron_star":
      return config.neutron_star.seed;
  }
}

/**
 * Composes the full 3D universe from the reveal payload:
 *  - CosmicBackground (layered animated stars + nebula)
 *  - ParticleField (ambient dust at the API density)
 *  - The central cosmic object, switched by celestial_type
 *  - The optional central "soul" symbol (star / heart) overlaid inside it
 *  - The optional LLM-generated creature companion orbiting near it
 *
 * The central object is wrapped in <Float> for gentle drift. The creature
 * animates on its own useFrame loop (not wrapped in Float) so its motion
 * path isn't dampened.
 */
export function UniverseScene({ reveal }: UniverseSceneProps) {
  const ambientSeed = celestialSeed(reveal);
  const usesAssetCompanion = reveal.creature && hasCreatureModel(reveal.creature.kind);
  const central = useMemo(() => {
    const symbolOverlay =
      reveal.central_symbol !== "none" ? (
        <CentralSymbolObject
          symbol={reveal.central_symbol}
          primaryColor={reveal.primary_color}
          secondaryColor={reveal.secondary_color}
          rotationSpeed={reveal.rotation_speed}
          scale={0.78}
        />
      ) : null;

    switch (reveal.celestial_type) {
      case "galaxy":
        return (
          <RealisticGalaxy
            primaryColor={reveal.primary_color}
            secondaryColor={reveal.secondary_color}
            rotationSpeed={reveal.rotation_speed}
            particleDensity={reveal.particle_density}
            config={
              reveal.celestial_config?.celestial_type === "galaxy"
                ? reveal.celestial_config.galaxy
                : undefined
            }
          >
            {symbolOverlay}
          </RealisticGalaxy>
        );
      case "black_hole":
        return (
          <BlackHole
            primaryColor={reveal.primary_color}
            secondaryColor={reveal.secondary_color}
            rotationSpeed={reveal.rotation_speed}
            config={
              reveal.celestial_config?.celestial_type === "black_hole"
                ? reveal.celestial_config.black_hole
                : undefined
            }
          >
            {symbolOverlay}
          </BlackHole>
        );
      case "neutron_star":
        return (
          <NeutronStar
            primaryColor={reveal.primary_color}
            secondaryColor={reveal.secondary_color}
            rotationSpeed={reveal.rotation_speed}
          >
            {symbolOverlay}
          </NeutronStar>
        );
    }
  }, [reveal]);

  return (
    <>
      <CosmicBackground
        primaryColor={reveal.primary_color}
        secondaryColor={reveal.secondary_color}
      />
      <ParticleField
        primaryColor={reveal.primary_color}
        secondaryColor={reveal.secondary_color}
        density={reveal.particle_density}
        seed={ambientSeed}
      />
      <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.6}>
        {central}
      </Float>
      {reveal.creature && (usesAssetCompanion ? (
        <Suspense fallback={null}>
          <CreatureModel
            spec={reveal.creature}
            primaryColor={reveal.primary_color}
            secondaryColor={reveal.secondary_color}
            rotationSpeed={reveal.rotation_speed}
          />
        </Suspense>
      ) : null)}
    </>
  );
}

import type { Metadata } from "next";

import { FLAGS } from "@/config/flags";
import { PlanetLandingClient } from "@/components/landing/PlanetLandingClient";
import { getWorld } from "@/lib/worldStore";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const world = await getWorld(id).catch(() => null);
  if (!world) return { title: "Galaxique" };
  // Only the creature's name: readings are never put into link previews.
  const title = `${world.creature.name}'s world — Galaxique`;
  return { title, openGraph: { title, description: "Land on this planet and say hi." } };
}

export default async function WorldPage({ params }: { params: Promise<{ id: string }> }) {
  if (!FLAGS.planetLanding) notFound();
  const { id } = await params;
  const world = await getWorld(id).catch(() => null);
  return <PlanetLandingClient worldId={id} world={world} />;
}

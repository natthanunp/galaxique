import type { CentralSymbol } from "@/types/universe";

import { diamondPoints } from "./diamondPoints";
import { flamePoints } from "./flamePoints";
import { heartPoints } from "./heartPoints";
import { infinityPoints } from "./infinityPoints";
import { starPoints } from "./starPoints";

/**
 * Registry mapping a Gemini-returned `central_symbol` string to its
 * constellation point data (Float32Array of x,y,z triples).
 *
 * This is the bridge between the API output and the 3D render: the
 * CentralSymbolObject component looks up points here by central_symbol.
 *
 * "none" maps to null (no central symbol rendered — used for cosmic objects
 * like black holes / neutron stars that shine on their own).
 */
export const constellationRegistry: Record<
  Exclude<CentralSymbol, "none">,
  Float32Array
> = {
  star: starPoints,
  heart: heartPoints,
  diamond: diamondPoints,
  infinity: infinityPoints,
  flame: flamePoints,
};

/** Returns the constellation points for a symbol, or null for "none". */
export function getConstellationPoints(
  symbol: CentralSymbol,
): Float32Array | null {
  if (symbol === "none") return null;
  return constellationRegistry[symbol] ?? null;
}

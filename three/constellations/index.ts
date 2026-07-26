import type { CentralSymbol } from "@/types/universe";

import { heartPoints } from "./heartPoints";
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
  heart: heartPoints,
  star: starPoints,
};

/** Returns the constellation points for a symbol, or null for "none". */
export function getConstellationPoints(
  symbol: CentralSymbol,
): Float32Array | null {
  if (symbol === "none") return null;
  return constellationRegistry[symbol] ?? null;
}

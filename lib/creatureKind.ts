import type { CreatureKind, Language } from "@/types/universe";

/** Thai nouns for each creature kind, used wherever the kind is user-facing. */
const CREATURE_KIND_TH: Record<CreatureKind, string> = {
  fish: "ปลา",
  bird: "นก",
  fox: "จิ้งจอก",
  cat: "แมว",
  dragon: "มังกร",
  jelly: "แมงกะพรุน",
  spirit: "วิญญาณ",
};

/** User-facing label for a creature kind, translated to Thai when needed. */
export function humanizeCreatureKind(kind: CreatureKind, language: Language): string {
  return language === "th" ? CREATURE_KIND_TH[kind] : kind;
}

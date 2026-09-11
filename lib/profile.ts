import type { CelestialType, Language, Vibe } from "@/types/universe";

export const THEMES = ["affectionate", "grounded", "reflective", "driven", "imaginative", "questioning"] as const;
export type ProfileTheme = (typeof THEMES)[number];
export const CELESTIAL_TYPES = ["galaxy", "black_hole", "neutron_star"] as const;
export const THEME_VIBE: Record<ProfileTheme, Vibe> = {
  affectionate: "cute", grounded: "cozy", reflective: "mysterious",
  driven: "intense", imaginative: "whimsical", questioning: "cynical",
};
export const THEME_LABELS: Record<ProfileTheme, Record<Language, string>> = {
  affectionate: { en: "Affectionate", th: "ใส่ใจผู้อื่น" },
  grounded: { en: "Grounded", th: "มั่นคง" },
  reflective: { en: "Reflective", th: "ช่างคิด" },
  driven: { en: "Driven", th: "มุ่งมั่น" },
  imaginative: { en: "Imaginative", th: "มีจินตนาการ" },
  questioning: { en: "Questioning", th: "ช่างตั้งคำถาม" },
};
const LEGACY_LABELS: Record<string, Record<Language, string>> = {
  cute: { en: "Cute", th: "น่ารัก" }, cozy: { en: "Cozy", th: "อบอุ่น" },
  mysterious: { en: "Mysterious", th: "ลึกลับ" }, intense: { en: "Intense", th: "เข้มข้น" },
  whimsical: { en: "Whimsical", th: "เพ้อฝัน" }, cynical: { en: "Cynical", th: "เย็นชา" },
};
export interface ProfileMetadata {
  profile_version?: 2;
  theme?: ProfileTheme;
  reveal_id?: string;
}
export function profileLabel(profile: ProfileMetadata & { vibe: string }, language: Language): string {
  if (profile.theme && THEME_LABELS[profile.theme]) {
    return THEME_LABELS[profile.theme][language];
  }
  return LEGACY_LABELS[profile.vibe]?.[language] ?? profile.vibe;
}

/** Rendering-key totals returned by the public statistics endpoint. */
export type ProfileDisplayStats = Record<Vibe, number> & { total: number };
export const SIGNAL_DEFINITIONS: Record<ProfileTheme | CelestialType, string> = {
  affectionate: "Expressed care, closeness, and connection; not general politeness.",
  grounded: "Stability, practical routines, familiar anchors; not all kindness or warmth.",
  reflective: "Deliberation, observation, examining meaning; rest alone is insufficient.",
  driven: "Commitment, perseverance, purposeful action; not distress or anger.",
  imaginative: "Inventiveness, exploration, unusual possibilities; not only optimism.",
  questioning: "Independent judgment and testing assumptions; not rudeness or coldness.",
  galaxy: "Expansive exploration, connecting people or ideas, keeping possibilities open.",
  black_hole: "Inward depth, sustained private reflection, examining beneath the surface; not just relaxing alone.",
  neutron_star: "Concentrated action, decisive commitment, persistence under pressure; kindness can coexist.",
};

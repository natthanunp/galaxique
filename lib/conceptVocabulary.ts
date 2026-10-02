/**
 * Shared Thai/English concept vocabulary. Assessment briefs and song
 * descriptors are both mapped onto these IDs so a brief saying "yearning"
 * can match a song described as "longing" or "คิดถึง".
 */
export const CONCEPTS: Record<string, { en: string[]; th: string[] }> = {
  longing: { en: ["longing", "yearning", "missing", "pining", "wistful"], th: ["คิดถึง", "โหยหา", "อาลัย"] },
  nostalgia: { en: ["nostalgia", "nostalgic", "memory", "memories", "past", "reminiscing", "childhood"], th: ["ความทรงจำ", "อดีต", "วันวาน", "วัยเด็ก"] },
  intimacy: { en: ["intimacy", "intimate", "closeness", "tender", "tenderness", "affection", "affectionate"], th: ["ใกล้ชิด", "อ่อนโยน", "อบอุ่นใจ"] },
  love: { en: ["love", "romance", "romantic", "crush", "devotion", "adoration"], th: ["ความรัก", "รัก", "โรแมนติก", "แอบชอบ"] },
  heartbreak: { en: ["heartbreak", "breakup", "loss", "grief", "parting", "goodbye"], th: ["อกหัก", "เลิกรา", "สูญเสีย", "จากลา"] },
  loneliness: { en: ["loneliness", "lonely", "isolation", "alone", "solitary"], th: ["เหงา", "โดดเดี่ยว", "ลำพัง"] },
  solitude: { en: ["solitude", "quiet", "stillness", "retreat", "recharge", "recharging"], th: ["ความสงบ", "เงียบ", "พักใจ"] },
  connection: { en: ["connection", "belonging", "togetherness", "friendship", "community", "social", "shared"], th: ["มิตรภาพ", "เพื่อน", "ความผูกพัน", "ด้วยกัน"] },
  care: { en: ["care", "caring", "support", "kindness", "comfort", "comforting", "warmth"], th: ["ห่วงใย", "ดูแล", "ปลอบ", "ใจดี"] },
  selfworth: { en: ["self-love", "self-worth", "confidence", "empowerment", "acceptance"], th: ["รักตัวเอง", "มั่นใจ", "ยอมรับตัวเอง"] },
  insecurity: { en: ["insecurity", "self-doubt", "doubt", "anxiety", "anxious", "uncertainty"], th: ["ไม่มั่นใจ", "กังวล", "สงสัยในตัวเอง"] },
  freedom: { en: ["freedom", "independence", "independent", "escape", "liberation", "autonomy"], th: ["อิสระ", "เป็นตัวของตัวเอง", "หลีกหนี"] },
  adventure: { en: ["adventure", "exploration", "explore", "journey", "travel", "discovery", "curiosity", "curious"], th: ["ผจญภัย", "สำรวจ", "เดินทาง", "อยากรู้"] },
  wonder: { en: ["wonder", "awe", "dreamy", "dream", "dreams", "magic", "magical", "cosmic"], th: ["มหัศจรรย์", "ความฝัน", "ฝัน", "เวทมนตร์"] },
  imagination: { en: ["imagination", "imaginative", "creativity", "creative", "playful", "whimsical", "invention"], th: ["จินตนาการ", "สร้างสรรค์", "ขี้เล่น"] },
  joy: { en: ["joy", "joyful", "happiness", "happy", "celebration", "fun", "euphoria", "euphoric", "uplifting"], th: ["ความสุข", "สนุก", "เฉลิมฉลอง", "สดใส"] },
  hope: { en: ["hope", "hopeful", "optimism", "optimistic", "renewal", "new beginnings"], th: ["ความหวัง", "เริ่มใหม่"] },
  growth: { en: ["growth", "change", "transformation", "becoming", "self-discovery", "maturity"], th: ["เติบโต", "เปลี่ยนแปลง", "ค้นพบตัวเอง"] },
  determination: { en: ["determination", "determined", "perseverance", "persistence", "ambition", "drive", "driven", "commitment", "resilience"], th: ["มุ่งมั่น", "ไม่ยอมแพ้", "ความพยายาม", "ทะเยอทะยาน"] },
  courage: { en: ["courage", "brave", "bravery", "defiance", "strength", "power"], th: ["กล้าหาญ", "เข้มแข็ง", "ต่อสู้"] },
  rebellion: { en: ["rebellion", "rebellious", "anger", "frustration", "confrontation", "protest"], th: ["ขบถ", "โกรธ", "หงุดหงิด"] },
  questioning: { en: ["questioning", "skepticism", "skeptical", "irony", "ironic", "cynical", "critique"], th: ["ตั้งคำถาม", "เคลือบแคลง", "ประชด"] },
  reflection: { en: ["reflection", "reflective", "introspection", "introspective", "contemplation", "thoughtful", "meaning"], th: ["ทบทวน", "ใคร่ครวญ", "คิดถึงตัวเอง"] },
  melancholy: { en: ["melancholy", "melancholic", "sad", "sadness", "sorrow", "bittersweet"], th: ["เศร้า", "หม่น", "ขมขื่น"] },
  mystery: { en: ["mystery", "mysterious", "enigmatic", "eerie", "haunting", "ambiguous", "surreal"], th: ["ลึกลับ", "หลอน", "เหนือจริง"] },
  darkness: { en: ["darkness", "dark", "brooding", "tense", "despair", "anguish"], th: ["มืด", "สิ้นหวัง", "ทุกข์"] },
  calm: { en: ["calm", "peaceful", "serene", "gentle", "soft", "mellow", "relaxed", "cozy"], th: ["สงบ", "นุ่มนวล", "ผ่อนคลาย", "สบาย"] },
  routine: { en: ["routine", "everyday", "familiar", "home", "stability", "steady", "grounded", "practical"], th: ["กิจวัตร", "ธรรมดา", "บ้าน", "มั่นคง"] },
  energy_still: { en: ["still", "ambient", "slow", "hushed", "minimal", "restrained"], th: ["ช้า", "เบา"] },
  energy_mid: { en: ["mid-tempo", "groovy", "steady beat", "swaying", "laid-back"], th: ["จังหวะกลาง"] },
  energy_high: { en: ["driving", "energetic", "upbeat", "anthemic", "explosive", "fast", "intense", "danceable"], th: ["มันส์", "เร็ว", "พลังเยอะ"] },
  night: { en: ["night", "late-night", "midnight", "nocturnal", "moonlit"], th: ["กลางคืน", "ดึก", "เที่ยงคืน"] },
  daylight: { en: ["sunlit", "sunny", "daytime", "morning", "summer", "sunshine"], th: ["แดด", "กลางวัน", "เช้า", "ฤดูร้อน"] },
  rain: { en: ["rain", "rainy", "storm", "weather"], th: ["ฝน", "พายุ"] },
  city: { en: ["city", "urban", "street", "streets", "neon"], th: ["เมือง", "ถนน"] },
  nature: { en: ["nature", "ocean", "sea", "forest", "sky", "stars", "outdoors"], th: ["ธรรมชาติ", "ทะเล", "ป่า", "ท้องฟ้า", "ดาว"] },
  party: { en: ["party", "dancing", "dance", "club", "crowd"], th: ["ปาร์ตี้", "เต้น"] },
  drive: { en: ["driving at night", "road", "road trip", "car"], th: ["ขับรถ", "ถนนยาว"] },
};

const EN_INDEX = new Map<string, string>();
const TH_TERMS: [string, string][] = [];
for (const [id, terms] of Object.entries(CONCEPTS)) {
  for (const term of terms.en) EN_INDEX.set(term.toLowerCase(), id);
  for (const term of terms.th) TH_TERMS.push([term, id]);
}

/** Concept IDs found in free text, matching whole English words/phrases and Thai substrings. */
export function conceptsIn(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    for (let n = 3; n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const id = EN_INDEX.get(phrase);
      if (id) found.add(id);
    }
  }
  for (const [term, id] of TH_TERMS) if (text.includes(term)) found.add(id);
  return found;
}

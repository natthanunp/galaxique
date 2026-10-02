/** Contact details and identifiers that must never appear in a published reading. */
const PATTERNS: [string, RegExp][] = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["url", /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:com|net|org|co|io|me|th|app|link)\b/i],
  ["phone", /(?:\+?66|0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}\b|\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/],
  ["long_number", /\d[\d\s-]{8,}\d/],
  ["handle", /(?:^|\s)@[\w.]{3,}/],
  ["messaging_id", /\b(?:line|ig|instagram|facebook|fb|tiktok|twitter|discord|telegram)\s*(?:id)?\s*[:：]/i],
  ["thai_contact", /แอดไลน์|ไลน์\s*[:：]|ไอดีไลน์|ไลน์ไอดี|ไอจี|เบอร์โทร|อีเมล|บ้านเลขที่/],
  ["address", /\b\d{1,5}\s+\w+\s+(?:street|st\.|road|rd\.|avenue|ave\.|soi|lane)\b|(?:ซอย|ถนน)\S*\s*\d/i],
];

/** Returns the kinds of personal information found; empty means none detected. */
export function findPersonalInfo(text: string): string[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

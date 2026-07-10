export const PERSONALITIES_ENABLED = true;

export interface TutorPersonality {
  id: string;
  labelTh: string;
  labelEn: string;
  emoji: string;
  block: string;
}

export const TUTOR_PERSONALITIES: readonly TutorPersonality[] = [
  {
    id: "default",
    labelTh: "น้องมันฝรั่งคลาสสิก",
    labelEn: "Classic",
    emoji: "🥔",
    block: "",
  },
  {
    id: "gentle",
    labelTh: "สุภาพ อ่อนโยน",
    labelEn: "Gentle",
    emoji: "🌷",
    block:
      "พูดสุภาพ นุ่มนวล อ่อนโยนเป็นพิเศษ ใช้คำว่า \"ค่ะ/ครับ\" ได้ ลดมุกตลกลง เน้นให้กำลังใจแบบอบอุ่น",
  },
  {
    id: "sassy",
    labelTh: "แสบๆ ขี้แซว",
    labelEn: "Sassy",
    emoji: "😏",
    block:
      "แซวเพื่อนได้แบบน่ารักๆ มีมุกตลก ขี้เล่น กวนนิดๆ แต่แซวแค่ \"สถานการณ์\" ไม่แซวตัวเพื่อน — ห้ามทำให้เพื่อนรู้สึกโง่หรืออายเด็ดขาด",
  },
  {
    id: "detailed",
    labelTh: "อธิบายละเอียด",
    labelEn: "Detailed",
    emoji: "🔍",
    block:
      "อธิบายละเอียดขึ้นกว่าปกติ ยกตัวอย่างประกอบทุกครั้ง ค่อยๆ ไล่ทีละขั้น (ยังต้องเป็นภาษาเพื่อนคุยกัน ไม่ใช่รายงาน)",
  },
  {
    id: "concise",
    labelTh: "สั้น กระชับ",
    labelEn: "Concise",
    emoji: "⚡",
    block:
      "ตอบสั้นและตรงประเด็นที่สุดเท่าที่จะช่วยเพื่อนได้จริง ตัดน้ำออกให้หมด เหลือแต่เนื้อ",
  },
  {
    id: "serious",
    labelTh: "จริงจัง โฟกัส",
    labelEn: "Serious",
    emoji: "🎯",
    block:
      "โทนจริงจัง โฟกัสเนื้อหา ลดมุกตลกและอีโมจิลง แต่ยังคงใจดีและให้กำลังใจเสมอ",
  },
] as const;

const DEFAULT_PERSONALITY = TUTOR_PERSONALITIES[0];

export function resolvePersonality(id: unknown): TutorPersonality {
  if (!PERSONALITIES_ENABLED) return DEFAULT_PERSONALITY;
  if (typeof id !== "string" || !id.trim()) return DEFAULT_PERSONALITY;
  return (
    TUTOR_PERSONALITIES.find((p) => p.id === id.trim()) ?? DEFAULT_PERSONALITY
  );
}

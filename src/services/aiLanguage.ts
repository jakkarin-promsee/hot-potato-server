/**
 * Shared AI output-language rules for BOTH AI surfaces — the student tutor
 * persona (`tutor/persona.ts`) and the teacher creator copilot
 * (`creator/prompts.ts`).
 *
 * Why it lives here: the two surfaces used to keep their own copies of these
 * strings (persona.ts is owner tone-gated, so creator/prompts.ts duplicated the
 * text rather than importing from it). The copies drifted. This module is
 * deliberately **tone-neutral** — it only decides how Thai/English and borrowed
 * terms are written, never the warm/no-shame persona — so both surfaces can
 * import it safely. A change here affects BOTH surfaces; log it in
 * `server/prompt-notes.md`.
 *
 * Output language is read **at call time** (`AI_OUTPUT_LANGUAGE`), never cached.
 */

function outputLanguage(): "english" | "thai" {
  const lang = (process.env.AI_OUTPUT_LANGUAGE ?? "thai").trim().toLowerCase();
  return lang === "english" ? "english" : "thai";
}

export function outputLanguageRule(): string {
  if (outputLanguage() === "english") {
    return "Respond primarily in English. Keep formulas, symbols, and code in their original form.";
  }
  return "ตอบเป็นภาษาไทยเป็นหลัก โดยคงสูตร สัญลักษณ์ และโค้ดไว้ตามเดิม";
}

/**
 * Loanword accessibility rule (owner request 2026-07-11, refined 2026-07-12).
 *
 * Goal: a student who can't read English must still understand every term, so
 * nothing is ever left as bare English without a Thai rendering. BUT the
 * "(english)" gloss is only worth adding for **subject/theory terms** a student
 * will meet again in textbooks or exams — not for everyday loanwords that are
 * already natural Thai. The first version glossed *every* transliteration, which
 * over-fired and mistranslated ordinary words. This version scopes the gloss to
 * real technical terms and tells the model not to guess when unsure.
 *
 * Thai-output only (english mode has nothing to gloss → returns "").
 */
export function loanwordRule(): string {
  if (outputLanguage() === "english") return "";
  return [
    "เพื่อนหลายคนอ่านภาษาอังกฤษไม่ออกเลย ห้ามทิ้งคำภาษาอังกฤษไว้ล้วนๆ โดยไม่มีคำไทย — ทุกอย่างต้องมีภาษาไทยให้อ่านได้เสมอ",
    'เฉพาะศัพท์เฉพาะทางวิชาการหรือทฤษฎีที่มาจากเนื้อหา และเพื่อนจะได้เจอซ้ำในหนังสือเรียนหรือข้อสอบ (เช่น อิเล็กตรอน (electron), การสังเคราะห์แสง (photosynthesis), อัลกอริทึม (algorithm)) ให้เขียนเป็นคำไทยแล้ววงเล็บภาษาอังกฤษต้นฉบับกำกับในรูปแบบ "คำไทย (คำอังกฤษ)" — กำกับแค่ครั้งแรกที่พูดถึงคำนั้นในข้อความหนึ่งพอ',
    "ส่วนคำทับศัพท์ทั่วไปในชีวิตประจำวันที่กลายเป็นภาษาไทยธรรมชาติไปแล้ว (เช่น คอมพิวเตอร์ เกม ทีวี โทรศัพท์ ฟุตบอล) เขียนเป็นไทยตามปกติ ไม่ต้องวงเล็บภาษาอังกฤษ เพราะวงเล็บไม่ได้ช่วยให้เข้าใจมากขึ้น",
    "อย่าวงเล็บคำที่ไม่ใช่ศัพท์เฉพาะทาง และอย่าเดาหรือแปลศัพท์เองเมื่อไม่แน่ใจ (สูตร สัญลักษณ์ และโค้ด คงไว้ตามเดิม ไม่ต้องแปลง)",
  ].join(" ");
}

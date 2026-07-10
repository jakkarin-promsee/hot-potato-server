/**
 * Probe available Gemini Flash models and print a latency table.
 * Requires GEMINI_API_KEY — costs a few tokens; never wired into npm test.
 *
 * Usage: npx ts-node scripts/check-models.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenAI } from "@google/genai";

const CANDIDATES = [
  "gemini-3-flash",
  "gemini-3-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const PROMPT = "ตอบคำเดียว: สวัสดี";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log("\n=== Flash / Lite models from API list ===\n");
  try {
    const pager = await ai.models.list();
    for await (const model of pager) {
      const name = model.name ?? "";
      if (/flash|lite/i.test(name)) {
        console.log(name);
      }
    }
  } catch (err) {
    console.warn("models.list() failed:", err);
  }

  console.log("\n=== Candidate probe ===\n");
  console.log("slug · result · latency ms");
  console.log("---");

  for (const slug of CANDIDATES) {
    const start = Date.now();
    try {
      await ai.models.generateContent({
        model: slug,
        contents: PROMPT,
      });
      console.log(`${slug} · ok · ${Date.now() - start}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const label = /404|not found/i.test(msg) ? "404" : "error";
      console.log(`${slug} · ${label} · ${Date.now() - start}`);
    }
  }

  console.log("\nDone (exit 0 regardless of individual failures).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

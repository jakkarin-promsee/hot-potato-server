import { GoogleGenAI } from "@google/genai";
import { generateWithRetry } from "./retry";

export interface TutorTurn {
  role: "user" | "model";
  text: string;
}

export async function callTutorModel(opts: {
  model: string;
  systemInstruction: string;
  history: TutorTurn[];
  message: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...opts.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user" as const, parts: [{ text: opts.message }] },
  ];
  const result = await generateWithRetry(() =>
    ai.models.generateContent({
      model: opts.model,
      contents,
      config: { systemInstruction: opts.systemInstruction },
    }),
  );
  return (result.text ?? "").trim();
}

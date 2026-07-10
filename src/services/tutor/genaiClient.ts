import { GoogleGenAI } from "@google/genai";
import { recordAiFailure, recordAiSuccess } from "../observability.service";
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
  if (!apiKey) {
    recordAiFailure();
    throw new Error("MISSING_GEMINI_API_KEY");
  }
  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...opts.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user" as const, parts: [{ text: opts.message }] },
  ];
  try {
    const result = await generateWithRetry(() =>
      ai.models.generateContent({
        model: opts.model,
        contents,
        config: { systemInstruction: opts.systemInstruction },
      }),
    );
    recordAiSuccess();
    return (result.text ?? "").trim();
  } catch (error) {
    recordAiFailure();
    throw error;
  }
}

export async function* callTutorModelStream(opts: {
  model: string;
  systemInstruction: string;
  history: TutorTurn[];
  message: string;
}): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    recordAiFailure();
    throw new Error("MISSING_GEMINI_API_KEY");
  }
  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...opts.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user" as const, parts: [{ text: opts.message }] },
  ];
  try {
    const stream = await generateWithRetry(() =>
      ai.models.generateContentStream({
        model: opts.model,
        contents,
        config: { systemInstruction: opts.systemInstruction },
      }),
    );
    for await (const chunk of stream) {
      const text = chunk.text ?? "";
      if (text) yield text;
    }
    recordAiSuccess();
  } catch (error) {
    recordAiFailure();
    throw error;
  }
}

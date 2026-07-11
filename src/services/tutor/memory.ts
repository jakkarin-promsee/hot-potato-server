import { GoogleGenAI, Type } from "@google/genai";
import { Types } from "mongoose";
import {
  IStudentMemory,
  MEMORY_ITEM_MAX,
  MEMORY_LIST_CAP,
  MEMORY_TOPICS_CAP,
  StudentMemory,
} from "../../models/student_memory.model";
import { generateWithRetry } from "./retry";
import { getFastModel } from "./models";

const MEMORY_DIGEST_MAX = 600;
const TOPIC_SUMMARY_MAX = 200;

function clampStringList(items: unknown, cap: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MEMORY_ITEM_MAX))
    .filter(Boolean)
    .slice(0, cap);
}

/** Keep existing list when the model omits a field; only replace when present. */
function mergeMemoryList(parsed: unknown, existing: string[]): string[] {
  if (parsed === undefined) return existing;
  return clampStringList(parsed, MEMORY_LIST_CAP);
}

function memoryToJson(mem: IStudentMemory | null): Record<string, unknown> {
  if (!mem) {
    return {
      interests: [],
      strengths: [],
      growth_areas: [],
      preferences: [],
      recent_topics: [],
    };
  }
  return {
    interests: mem.interests,
    strengths: mem.strengths,
    growth_areas: mem.growth_areas,
    preferences: mem.preferences,
    recent_topics: mem.recent_topics.map((t) => ({
      content_id: t.content_id.toString(),
      summary: t.summary,
      updatedAt: t.updatedAt,
    })),
  };
}

function isMemoryEmpty(mem: IStudentMemory | null): boolean {
  if (!mem) return true;
  const hasLists =
    mem.interests.length > 0 ||
    mem.strengths.length > 0 ||
    mem.growth_areas.length > 0 ||
    mem.preferences.length > 0;
  const hasTopics = mem.recent_topics.some((t) => t.summary.trim());
  return !hasLists && !hasTopics;
}

export function buildMemoryDigest(mem: IStudentMemory | null): string {
  if (isMemoryEmpty(mem)) return "";

  const lines: string[] = [];
  if (mem!.interests.length) {
    lines.push(`ความสนใจ: ${mem!.interests.join(", ")}`);
  }
  if (mem!.strengths.length) {
    lines.push(`จุดแข็งที่เคยเห็น: ${mem!.strengths.join(", ")}`);
  }
  if (mem!.growth_areas.length) {
    lines.push(`กำลังฝึก: ${mem!.growth_areas.join(", ")}`);
  }
  if (mem!.preferences.length) {
    lines.push(`สไตล์ที่ชอบ: ${mem!.preferences.join(", ")}`);
  }

  const topicSummaries = mem!.recent_topics
    .filter((t) => t.summary.trim())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 2)
    .map((t) => t.summary.trim());
  if (topicSummaries.length) {
    lines.push(`เพิ่งเรียน: ${topicSummaries.join("; ")}`);
  }

  const digest = lines.join("\n");
  return digest.length > MEMORY_DIGEST_MAX
    ? digest.slice(0, MEMORY_DIGEST_MAX)
    : digest;
}

function buildMemoryPrompt(opts: {
  current: Record<string, unknown>;
  lessonTitle: string;
  recentTurns: { role: string; text: string }[];
}): string {
  const turns = opts.recentTurns
    .map((t) => `${t.role}: ${t.text}`)
    .join("\n");
  return [
    "You maintain a tiny memory sketch about one student, used only to make a tutor warmer.",
    `Current memory (JSON): ${JSON.stringify(opts.current)}`,
    `New conversation turns (lesson: "${opts.lessonTitle}"):`,
    turns,
    "",
    "Update the memory. Rules:",
    '- Only durable facts: interests ("ชอบฟุตบอล"), strengths ("เชื่อมโยงเหตุผลเก่ง"), growth areas ("ยังสับสนเรื่องเศษส่วน"), preferences ("ชอบคำอธิบายสั้นๆ").',
    `- Each entry ≤ ${MEMORY_ITEM_MAX} chars, Thai preferred. Max ${MEMORY_LIST_CAP} per list — drop the least useful when full.`,
    `- topic_summary: ≤ ${TOPIC_SUMMARY_MAX} chars, what the student worked on in this lesson just now.`,
    'If nothing durable was revealed, return {"changed": false}.',
    "Never store anything sensitive, embarrassing, or judgmental. This is a friend's sketch, not surveillance.",
  ].join("\n");
}

function upsertRecentTopic(
  existing: IStudentMemory["recent_topics"],
  contentId: Types.ObjectId,
  summary: string,
): IStudentMemory["recent_topics"] {
  const trimmed = summary.trim().slice(0, TOPIC_SUMMARY_MAX);
  if (!trimmed) return existing;

  const now = new Date();
  const without = existing.filter(
    (t) => !t.content_id.equals(contentId),
  );
  return [{ content_id: contentId, summary: trimmed, updatedAt: now }, ...without].slice(
    0,
    MEMORY_TOPICS_CAP,
  );
}

export async function runMemoryUpdate(opts: {
  userId: Types.ObjectId;
  contentId: Types.ObjectId;
  lessonTitle: string;
  recentTurns: { role: string; text: string }[];
}): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("memory update skipped: missing GEMINI_API_KEY");
    return;
  }

  try {
    const current = await StudentMemory.findOne({ user_id: opts.userId });
    const prompt = buildMemoryPrompt({
      current: memoryToJson(current),
      lessonTitle: opts.lessonTitle,
      recentTurns: opts.recentTurns,
    });

    const ai = new GoogleGenAI({ apiKey });
    const result = await generateWithRetry(() =>
      ai.models.generateContent({
        model: getFastModel(),
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              changed: { type: Type.BOOLEAN },
              interests: { type: Type.ARRAY, items: { type: Type.STRING } },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              growth_areas: { type: Type.ARRAY, items: { type: Type.STRING } },
              preferences: { type: Type.ARRAY, items: { type: Type.STRING } },
              topic_summary: { type: Type.STRING },
            },
            required: ["changed"],
          },
        },
      }),
    );

    const raw = (result.text ?? "").trim();
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      changed?: unknown;
      interests?: unknown;
      strengths?: unknown;
      growth_areas?: unknown;
      preferences?: unknown;
      topic_summary?: unknown;
    };

    if (parsed.changed !== true) return;

    const interests = mergeMemoryList(parsed.interests, current?.interests ?? []);
    const strengths = mergeMemoryList(parsed.strengths, current?.strengths ?? []);
    const growthAreas = mergeMemoryList(
      parsed.growth_areas,
      current?.growth_areas ?? [],
    );
    const preferences = mergeMemoryList(
      parsed.preferences,
      current?.preferences ?? [],
    );
    const topicSummary =
      typeof parsed.topic_summary === "string"
        ? parsed.topic_summary.trim().slice(0, TOPIC_SUMMARY_MAX)
        : "";

    const recentTopics = upsertRecentTopic(
      current?.recent_topics ?? [],
      opts.contentId,
      topicSummary,
    );

    await StudentMemory.findOneAndUpdate(
      { user_id: opts.userId },
      {
        user_id: opts.userId,
        interests,
        strengths,
        growth_areas: growthAreas,
        preferences,
        recent_topics: recentTopics,
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    console.warn("memory update failed:", error);
  }
}

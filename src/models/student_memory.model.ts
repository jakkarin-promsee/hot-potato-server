import { Schema, model, Document, Types } from "mongoose";

export const MEMORY_LIST_CAP = 10;
export const MEMORY_ITEM_MAX = 120;
export const MEMORY_TOPICS_CAP = 15;

export interface IRecentTopic {
  content_id: Types.ObjectId;
  summary: string;
  updatedAt: Date;
}

export interface IStudentMemory extends Document {
  user_id: Types.ObjectId;
  interests: string[];
  strengths: string[];
  growth_areas: string[];
  preferences: string[];
  recent_topics: IRecentTopic[];
  updatedAt: Date;
  createdAt: Date;
}

const studentMemorySchema = new Schema<IStudentMemory>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    interests: { type: [String], default: [] },
    strengths: { type: [String], default: [] },
    growth_areas: { type: [String], default: [] },
    preferences: { type: [String], default: [] },
    recent_topics: [
      {
        content_id: { type: Schema.Types.ObjectId, ref: "Content" },
        summary: { type: String, default: "" },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export const StudentMemory = model<IStudentMemory>(
  "StudentMemory",
  studentMemorySchema,
);

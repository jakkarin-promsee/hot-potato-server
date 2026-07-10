import { Schema, model, Document, Types } from "mongoose";

export interface IAgentSettings {
  persona_note: string;
  allow_direct_answers: boolean;
  scope: "lesson_only" | "lesson_plus_general";
  custom_guidelines: string;
}

export interface IContent extends Document {
  owner_id: Types.ObjectId;
  collaborators: Types.ObjectId[];
  /** Denormalized owner display name (recomputed on create / collaborator changes). */
  author_name: string;
  /** Denormalized names, same order as `collaborators`. */
  collaborator_names: string[];
  title: string;
  title_image: string;
  tiptap_json: string;
  access_type: "public" | "link-only" | "private";
  topics: string[];
  description: string;
  agent_settings: IAgentSettings;
  createdAt: Date;
  updatedAt: Date;
}

const agentSettingsSchema = new Schema<IAgentSettings>(
  {
    persona_note: { type: String, default: "" },
    allow_direct_answers: { type: Boolean, default: false },
    scope: {
      type: String,
      enum: ["lesson_only", "lesson_plus_general"],
      default: "lesson_plus_general",
    },
    custom_guidelines: { type: String, default: "" },
  },
  { _id: false },
);

const contentSchema = new Schema<IContent>(
  {
    owner_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    collaborators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    author_name: { type: String, default: "", trim: true },
    collaborator_names: {
      type: [String],
      default: [],
    },
    title: { type: String, default: "Untitled", trim: true },
    title_image: { type: String, default: "" },
    tiptap_json: { type: String, default: "{}" },
    access_type: {
      type: String,
      enum: ["public", "link-only", "private"],
      default: "private",
    },
    topics: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      default: "",
    },
    agent_settings: {
      type: agentSettingsSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

export const Content = model<IContent>("Content", contentSchema);

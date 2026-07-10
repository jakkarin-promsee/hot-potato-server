import { Schema, model, Document, Types } from "mongoose";

export const MAX_SESSION_MESSAGES = 50;

export interface IChatMessage {
  role: "student" | "tutor";
  text: string;
  mode: string;
  createdAt: Date;
}

export interface IChatSession extends Document {
  user_id: Types.ObjectId;
  content_id: Types.ObjectId;
  block_id: string;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const chatSessionSchema = new Schema<IChatSession>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content_id: { type: Schema.Types.ObjectId, ref: "Content", required: true },
    block_id: { type: String, default: "" },
    messages: [
      {
        role: { type: String, enum: ["student", "tutor"], required: true },
        text: { type: String, required: true },
        mode: { type: String, default: "free_chat" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

chatSessionSchema.index(
  { user_id: 1, content_id: 1, block_id: 1 },
  { unique: true },
);
chatSessionSchema.pre("save", function () {
  if (this.messages.length > MAX_SESSION_MESSAGES) {
    this.messages = this.messages.slice(-MAX_SESSION_MESSAGES);
  }
});

export const ChatSession = model<IChatSession>("ChatSession", chatSessionSchema);

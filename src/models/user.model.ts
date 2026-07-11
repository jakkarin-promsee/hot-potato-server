import { Schema, model, Document, Model } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  name: string;
  email: string;
  password?: string;
  googleId?: string;
  role: "admin" | "creator" | "learner";
  status: "active" | "blocked" | "suspended";
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    // Optional for Google-only accounts (they have googleId instead).
    password: {
      type: String,
      required: function (this: IUser) {
        return !this.googleId;
      },
    },
    googleId: { type: String, unique: true, sparse: true },
    role: {
      type: String,
      enum: ["admin", "creator", "learner"],
      default: "learner",
    },
    status: {
      type: String,
      enum: ["active", "blocked", "suspended"],
      default: "active",
    },
  },
  { timestamps: true },
);

// Auto-hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return; // only hash if changed
  this.password = await bcrypt.hash(this.password, 12);
  return;
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (
  candidate: string,
): Promise<boolean> {
  if (!this.password) return false; // Google-only account — no password to match
  return bcrypt.compare(candidate, this.password);
};

export const User = model<IUser>("User", userSchema);

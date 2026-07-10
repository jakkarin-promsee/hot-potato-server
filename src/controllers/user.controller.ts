import { Request, Response } from "express";
import { User } from "../models/user.model";
import { UserData } from "../models/user_data.model";
import { AuthRequest } from "../types";
import { refreshAuthorSnapshotsForUser } from "../services/contentAuthorSnapshot.service";

const CLOUDINARY_AVATAR_PREFIX = "https://res.cloudinary.com/";

function formatProfileResponse(user: {
  _id: unknown;
  name: string;
  email: string;
  role: string;
}, userData: { avatar?: string; bio?: string; metadata?: Record<string, unknown> } | null) {
  const metadata = userData?.metadata ?? {};
  const nickname =
    typeof metadata.nickname === "string" ? metadata.nickname : "";

  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    },
    profile: {
      avatar: userData?.avatar ?? "",
      bio: userData?.bio ?? "",
      nickname,
    },
  };
}

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  const users = await User.find().select("-password");
  res.json(users);
};

export const getMyProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const user = req.user!;
  const userData = await UserData.findOne({ user_id: user._id }).lean();

  res.json(formatProfileResponse(user, userData));
};

export const updateMyProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const user = req.user!;
  const { name, avatar, bio, nickname } = req.body ?? {};

  const hasName = name !== undefined;
  const hasAvatar = avatar !== undefined;
  const hasBio = bio !== undefined;
  const hasNickname = nickname !== undefined;

  if (!hasName && !hasAvatar && !hasBio && !hasNickname) {
    res.status(400).json({ message: "At least one field is required" });
    return;
  }

  if (hasName) {
    if (typeof name !== "string") {
      res.status(400).json({ message: "name must be a string" });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      res.status(400).json({ message: "name must be 1–100 characters" });
      return;
    }
  }

  if (hasAvatar) {
    if (typeof avatar !== "string") {
      res.status(400).json({ message: "avatar must be a string" });
      return;
    }
    if (
      avatar !== "" &&
      (!avatar.startsWith(CLOUDINARY_AVATAR_PREFIX) || avatar.length > 500)
    ) {
      res.status(400).json({
        message: "avatar must be empty or a valid Cloudinary URL",
      });
      return;
    }
  }

  if (hasBio) {
    if (typeof bio !== "string") {
      res.status(400).json({ message: "bio must be a string" });
      return;
    }
    if (bio.trim().length > 500) {
      res.status(400).json({ message: "bio must be at most 500 characters" });
      return;
    }
  }

  if (hasNickname) {
    if (typeof nickname !== "string") {
      res.status(400).json({ message: "nickname must be a string" });
      return;
    }
    if (nickname.trim().length > 50) {
      res.status(400).json({ message: "nickname must be at most 50 characters" });
      return;
    }
  }

  let nameChanged = false;

  if (hasName) {
    const trimmed = (name as string).trim();
    if (trimmed !== user.name) {
      user.name = trimmed;
      await user.save();
      nameChanged = true;
    }
  }

  const userDataUpdate: Record<string, unknown> = {};
  if (hasAvatar) userDataUpdate.avatar = avatar;
  if (hasBio) userDataUpdate.bio = (bio as string).trim();
  if (hasNickname) {
    userDataUpdate["metadata.nickname"] = (nickname as string).trim();
  }

  let userData = null;
  if (Object.keys(userDataUpdate).length > 0) {
    userData = await UserData.findOneAndUpdate(
      { user_id: user._id },
      { $set: userDataUpdate },
      { upsert: true, new: true },
    ).lean();
  } else {
    userData = await UserData.findOne({ user_id: user._id }).lean();
  }

  if (nameChanged) {
    await refreshAuthorSnapshotsForUser(user._id);
  }

  res.json(formatProfileResponse(user, userData));
};

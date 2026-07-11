import { Response } from "express";
import { Types } from "mongoose";
import { UserContent } from "../models/user_content.model";
import { touchLearningHistory } from "../services/learningHistory.service";
import { AuthRequest } from "../types";

function isValidContentId(id: unknown): id is string {
  return typeof id === "string" && Types.ObjectId.isValid(id);
}

// GET /api/answer/:contentId
export const getAnswers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = req.params.contentId;
  if (!isValidContentId(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const userContent = await UserContent.findOne({
    user_id: req.user!._id,
    content_id: contentId,
  });

  // Return empty answers if first visit — not an error
  res.json(userContent?.answers ?? {});
};

// PUT /api/answer/:contentId
export const saveAnswer = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = req.params.contentId;
  if (!isValidContentId(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const { blockId, answer } = req.body;

  if (!blockId) {
    res.status(400).json({ message: "blockId is required" });
    return;
  }

  await UserContent.findOneAndUpdate(
    {
      user_id: req.user!._id,
      content_id: contentId,
    },
    {
      $set: {
        [`answers.${blockId}`]: answer,
        last_visited: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  await touchLearningHistory(
    req.user!._id,
    new Types.ObjectId(contentId),
  );

  res.json({ success: true });
};

// PUT /api/answer/:contentId/bulk
export const bulkSaveAnswers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = req.params.contentId;
  if (!isValidContentId(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const { answers } = req.body;

  await UserContent.findOneAndUpdate(
    { user_id: req.user!._id, content_id: contentId },
    { $set: { answers, last_visited: new Date() } },
    { upsert: true, returnDocument: "after" },
  );

  await touchLearningHistory(
    req.user!._id,
    new Types.ObjectId(contentId),
  );

  res.json({ success: true });
};

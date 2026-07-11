import { Response } from "express";
import { Types } from "mongoose";
import { Content } from "../models/content.model";
import { LearningHistory } from "../models/learning_history.model";
import { touchLearningHistory } from "../services/learningHistory.service";
import { AuthRequest } from "../types";

// GET /api/history?limit=50
export const getHistory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const rawLimit = req.query.limit;
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(rawLimit ?? "50"), 10) || 50),
  );

  const rows = await LearningHistory.find({ user_id: req.user!._id })
    .sort({ last_accessed: -1 })
    .limit(limit)
    .populate({
      path: "content_id",
      select:
        "_id title title_image topics description access_type updatedAt author_name collaborator_names",
    })
    .lean();

  const items = rows
    .map((row) => {
      const content = row.content_id as unknown as
        | {
            _id: Types.ObjectId;
            title: string;
            title_image?: string;
            topics?: string[];
            description?: string;
            access_type?: string;
            updatedAt?: Date;
            author_name?: string;
            collaborator_names?: string[];
          }
        | null;

      if (!content || !content._id) return null;

      const author_name = content.author_name?.trim() || "";
      const collaborator_names = Array.isArray(content.collaborator_names)
        ? content.collaborator_names
        : [];

      return {
        _id: String(row._id),
        last_accessed: row.last_accessed,
        content: {
          _id: String(content._id),
          title: content.title,
          title_image: content.title_image ?? "",
          topics: content.topics ?? [],
          description: content.description ?? "",
          access_type: content.access_type,
          updatedAt: content.updatedAt,
          author_name,
          collaborator_names,
        },
      };
    })
    .filter(Boolean);

  res.json(items);
};

// POST /api/history/visit/:contentId
export const recordVisit = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = String(req.params.contentId);

  if (!Types.ObjectId.isValid(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const content = await Content.findById(contentId);
  if (!content) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  const uid = req.user!._id.toString();
  const isOwner = content.owner_id.toString() === uid;
  const isCollaborator = content.collaborators
    .map((c) => c.toString())
    .includes(uid);
  const isPublic = content.access_type === "public";
  const isLinkOnly = content.access_type === "link-only";

  if (!isPublic && !isLinkOnly && !isOwner && !isCollaborator) {
    res.status(403).json({ message: "No permission to view this content" });
    return;
  }

  await touchLearningHistory(req.user!._id, content._id);

  res.json({ success: true });
};

import { Response } from "express";
import { Types } from "mongoose";
import { Content, IAgentSettings } from "../models/content.model";
import { buildAuthorSnapshot } from "../services/contentAuthorSnapshot.service";
import { AuthRequest } from "../types";

function isValidContentId(id: unknown): id is string {
  return typeof id === "string" && Types.ObjectId.isValid(id);
}

function sanitizeAgentSettings(raw: unknown): IAgentSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    persona_note:
      typeof r.persona_note === "string"
        ? r.persona_note.trim().slice(0, 500)
        : "",
    allow_direct_answers: r.allow_direct_answers === true,
    scope: r.scope === "lesson_only" ? "lesson_only" : "lesson_plus_general",
    custom_guidelines:
      typeof r.custom_guidelines === "string"
        ? r.custom_guidelines.trim().slice(0, 1000)
        : "",
  };
}

// GET /api/content/load?id=xx (optional auth: anonymous may load public / link-only)
export const loadContent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const id = req.query.id;
  if (!isValidContentId(id)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const content = await Content.findById(id);

  if (!content) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  const uid = req.user?._id?.toString();
  const isOwner = uid ? content.owner_id.toString() === uid : false;
  const isCollaborator = uid
    ? content.collaborators.map((c) => c.toString()).includes(uid)
    : false;
  const isPublic = content.access_type === "public";
  const isLinkOnly = content.access_type === "link-only";

  if (!uid) {
    if (!isPublic && !isLinkOnly) {
      res.status(401).json({ message: "Login required to view this content" });
      return;
    }
    res.json(content);
    return;
  }

  if (!isPublic && !isLinkOnly && !isOwner && !isCollaborator) {
    res.status(403).json({ message: "No permission to view this content" });
    return;
  }

  res.json(content);
};

// POST /api/content/create
export const createBlankContent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const snap = await buildAuthorSnapshot(req.user!._id, []);

  const content = await Content.create({
    owner_id: req.user!._id,
    author_name: snap.author_name,
    collaborator_names: snap.collaborator_names,
  });

  res.status(201).json({ content_id: content._id });
};

// PUT /api/content/:id
// if {clientUpdatedAt:""} -> skip version check (force save)
// if clientUpdatedAt present -> 409 when server copy is newer
export const updateContent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = req.params.id;
  if (!isValidContentId(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const {
    clientUpdatedAt,
    author_name: _dropAuthor,
    collaborator_names: _dropCollabNames,
    owner_id: _dropOwner,
    createdAt: _dropCreated,
    updatedAt: _dropUpdated,
    _id: _dropId,
    agent_settings,
    ...rest
  } = req.body;
  const updateData: Record<string, unknown> = { ...rest };

  if (Object.prototype.hasOwnProperty.call(req.body, "agent_settings")) {
    const sanitized = sanitizeAgentSettings(agent_settings);
    if (sanitized) {
      updateData["agent_settings"] = sanitized;
    }
  }

  const content = await Content.findById(contentId);

  if (!content) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  const isOwner = content.owner_id.toString() === req.user!._id.toString();
  const isCollaborator = content.collaborators
    .map((c) => c.toString())
    .includes(req.user!._id.toString());

  if (!isOwner && !isCollaborator) {
    res.status(403).json({ message: "No permission to edit this content" });
    return;
  }

  // ── Version check (authorized editors only) ────────────────────
  if (clientUpdatedAt) {
    const serverTime = new Date(content.updatedAt).getTime();
    const clientTime = new Date(clientUpdatedAt).getTime();

    if (clientTime < serverTime) {
      res.status(409).json({
        message: "Conflict: a newer version exists on the server.",
        serverUpdatedAt: content.updatedAt,
      });
      return;
    }
  }

  // Recompute denormalized author fields when collaborators[] changes
  if (Object.prototype.hasOwnProperty.call(updateData, "collaborators")) {
    const raw = updateData["collaborators"];
    if (!Array.isArray(raw)) {
      res.status(400).json({ message: "collaborators must be an array" });
      return;
    }
    const collabIds: Types.ObjectId[] = [];
    for (const id of raw) {
      const s = String(id);
      if (!Types.ObjectId.isValid(s)) {
        res.status(400).json({ message: "Invalid collaborator id" });
        return;
      }
      collabIds.push(new Types.ObjectId(s));
    }
    const snap = await buildAuthorSnapshot(content.owner_id, collabIds);
    updateData["author_name"] = snap.author_name;
    updateData["collaborator_names"] = snap.collaborator_names;
  }

  const updated = await Content.findByIdAndUpdate(contentId, updateData, {
    returnDocument: "after",
  });

  res.json(updated);
};

// DELETE /api/content/:id
export const deleteContent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const contentId = req.params.id;
  if (!isValidContentId(contentId)) {
    res.status(400).json({ message: "Invalid content id" });
    return;
  }

  const content = await Content.findById(contentId);

  if (!content) {
    res.status(404).json({ message: "Content not found" });
    return;
  }

  // Only owner can delete
  const isOwner = content.owner_id.toString() === req.user!._id.toString();
  if (!isOwner) {
    res.status(403).json({ message: "Only owner can delete this content" });
    return;
  }

  await Content.findByIdAndDelete(contentId);
  res.json({ message: "Content deleted" });
};

// GET /api/content/search?q=title&mine=true | explore=true
export const searchContent = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { q, mine, explore } = req.query;

  if (mine === "true" && !req.user) {
    res.status(401).json({ message: "Login required" });
    return;
  }

  const filter: Record<string, any> = {};

  if (mine === "true") {
    filter["$or"] = [
      { owner_id: req.user!._id },
      { collaborators: req.user!._id },
    ];
  } else {
    // Non-mine searches are public catalog only (explore or title search)
    filter["access_type"] = "public";
  }

  // Filter by title text
  if (q) {
    const titleFilter = { title: { $regex: q, $options: "i" } }; // case insensitive

    // Combine with mine / explore filter if both provided
    if (filter["$or"]) {
      filter["$and"] = [{ $or: filter["$or"] }, titleFilter];
      delete filter["$or"];
    } else if (filter["access_type"] !== undefined) {
      filter["$and"] = [{ access_type: filter["access_type"] }, titleFilter];
      delete filter["access_type"];
    } else {
      filter["title"] = titleFilter.title;
    }
  }

  const contents = await Content.find(filter)
    .select(
      "_id title title_image updatedAt topics description access_type author_name collaborator_names owner_id",
    )
    .populate({ path: "owner_id", select: "name" })
    .sort({ updatedAt: -1 })
    .lean();

  const payload = contents.map((doc) => {
    const ownerDoc = doc.owner_id as
      | { name?: string }
      | Types.ObjectId
      | null
      | undefined;
    const ownerName =
      ownerDoc &&
      typeof ownerDoc === "object" &&
      "name" in ownerDoc &&
      ownerDoc.name
        ? String(ownerDoc.name).trim()
        : "";
    const stored =
      typeof doc.author_name === "string" ? doc.author_name.trim() : "";

    return {
      _id: doc._id,
      title: doc.title,
      title_image: doc.title_image,
      updatedAt: doc.updatedAt,
      topics: doc.topics,
      description: doc.description,
      access_type: doc.access_type,
      author_name: stored || ownerName,
      collaborator_names: Array.isArray(doc.collaborator_names)
        ? doc.collaborator_names
        : [],
    };
  });

  res.json(payload);
};

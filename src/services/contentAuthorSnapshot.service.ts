import { Types } from "mongoose";
import { User } from "../models/user.model";
import { Content } from "../models/content.model";

export type AuthorSnapshot = {
  author_name: string;
  collaborator_names: string[];
};

/**
 * Denormalized display names: owner + collaborators in collaborator[] order.
 * Call on content create and whenever collaborators[] changes.
 */
export async function buildAuthorSnapshot(
  ownerId: Types.ObjectId,
  collaboratorIds: Types.ObjectId[],
): Promise<AuthorSnapshot> {
  const owner = await User.findById(ownerId).select("name").lean();
  const author_name = owner?.name?.trim() || "Unknown";

  if (!collaboratorIds?.length) {
    return { author_name, collaborator_names: [] };
  }

  const collabDocs = await User.find({ _id: { $in: collaboratorIds } })
    .select("name")
    .lean();

  const byId = new Map(
    collabDocs.map((u) => [String(u._id), u.name?.trim() || "Unknown"]),
  );

  const collaborator_names = collaboratorIds.map(
    (id) => byId.get(String(id)) ?? "Unknown",
  );

  return { author_name, collaborator_names };
}

/**
 * Refresh denormalized author fields when a user renames themselves.
 */
export async function refreshAuthorSnapshotsForUser(
  userId: Types.ObjectId,
): Promise<void> {
  const user = await User.findById(userId).select("name").lean();
  if (!user) return;

  const newName = user.name?.trim() || "Unknown";

  await Content.updateMany(
    { owner_id: userId },
    { author_name: newName },
  );

  const collabLessons = await Content.find({ collaborators: userId })
    .select("owner_id collaborators")
    .lean();

  for (const lesson of collabLessons) {
    const snapshot = await buildAuthorSnapshot(
      lesson.owner_id as Types.ObjectId,
      (lesson.collaborators ?? []) as Types.ObjectId[],
    );
    await Content.updateOne(
      { _id: lesson._id },
      {
        author_name: snapshot.author_name,
        collaborator_names: snapshot.collaborator_names,
      },
    );
  }
}

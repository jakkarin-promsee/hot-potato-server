import { Response } from "express";
import mongoose from "mongoose";
import axios from "axios";
import { Category } from "../models/category.model";
import { Image } from "../models/image.model";
import { AuthRequest } from "../types";

/** Resolve category_id for writes — null clears; invalid or foreign → error. */
async function resolveOwnedCategoryId(
  userId: mongoose.Types.ObjectId,
  categoryId: unknown,
): Promise<{ ok: true; id: mongoose.Types.ObjectId | null } | { ok: false }> {
  if (categoryId === undefined || categoryId === null) {
    return { ok: true, id: null };
  }
  if (typeof categoryId !== "string" || !mongoose.isValidObjectId(categoryId)) {
    return { ok: false };
  }
  const category = await Category.findOne({ _id: categoryId, user_id: userId });
  if (!category) return { ok: false };
  return { ok: true, id: category._id };
}

// GET /images — all images for the logged-in user (latest first)
export const getImages = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const images = await Image.find({ user_id: req.user!._id })
      .sort({ created_at: -1 })
      .lean();

    res.json(images);
  } catch {
    res.status(500).json({ message: "Failed to fetch images" });
  }
};

// POST /images — save a Cloudinary upload result
export const saveImage = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const {
      public_id,
      secure_url,
      original_filename,
      format,
      bytes,
      width,
      height,
      category_id,
    } = req.body;

    if (!public_id || !secure_url) {
      res.status(400).json({ message: "public_id and secure_url are required" });
      return;
    }

    const category = await resolveOwnedCategoryId(req.user!._id, category_id);
    if (!category.ok) {
      res.status(400).json({ message: "Invalid category id" });
      return;
    }

    const existing = await Image.findOne({ public_id });
    if (existing) {
      res.status(409).json({ message: "Image already saved" });
      return;
    }

    const image = await Image.create({
      user_id: req.user!._id,
      public_id,
      secure_url,
      original_filename,
      format,
      bytes,
      width,
      height,
      category_id: category.id,
    });

    res.status(201).json(image);
  } catch {
    res.status(500).json({ message: "Failed to save image" });
  }
};

// POST /images/url — save an image from a remote URL
export const saveImageFromUrl = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { url, category_id } = req.body;

    if (!url?.trim()) {
      res.status(400).json({ message: "url is required" });
      return;
    }

    const category = await resolveOwnedCategoryId(req.user!._id, category_id);
    if (!category.ok) {
      res.status(400).json({ message: "Invalid category id" });
      return;
    }

    // 1. Fetch the remote image to validate it's actually an image
    const head = await axios.head(url).catch(() => null);
    const contentType = head?.headers?.["content-type"] ?? "";
    if (!contentType.startsWith("image/")) {
      res.status(422).json({ message: "URL does not point to a valid image" });
      return;
    }

    // 2. Upload to Cloudinary via URL (no file transfer needed)
    const formData = new URLSearchParams();
    formData.append("file", url);
    formData.append("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET!);

    const { data: cloudinary } = await axios.post(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      formData,
    );

    // 3. Check duplicate
    const existing = await Image.findOne({ public_id: cloudinary.public_id });
    if (existing) {
      res.status(409).json({ message: "Image already saved" });
      return;
    }

    // 4. Persist
    const image = await Image.create({
      user_id: req.user!._id,
      public_id: cloudinary.public_id,
      secure_url: cloudinary.secure_url,
      original_filename: cloudinary.original_filename,
      format: cloudinary.format,
      bytes: cloudinary.bytes,
      width: cloudinary.width,
      height: cloudinary.height,
      category_id: category.id,
    });

    res.status(201).json(image);
  } catch {
    res.status(500).json({ message: "Failed to save image from URL" });
  }
};

// DELETE /images/:public_id — delete one image (owner only)
export const deleteImage = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    // public_id may contain slashes (e.g. "folder/name") — decode it
    const public_id = decodeURIComponent(req.params.public_id as string);

    const image = await Image.findOneAndDelete({
      public_id,
      user_id: req.user!._id, // scoped to owner — can't delete others' images
    });

    if (!image) {
      res.status(404).json({ message: "Image not found" });
      return;
    }

    res.json({ message: "Deleted", public_id });
  } catch {
    res.status(500).json({ message: "Failed to delete image" });
  }
};

// DELETE /images — clear all images for the logged-in user
export const clearImages = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    await Image.deleteMany({ user_id: req.user!._id });
    res.json({ message: "All images cleared" });
  } catch {
    res.status(500).json({ message: "Failed to clear images" });
  }
};

export const assignCategory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const public_id = decodeURIComponent(req.params.public_id as string);
    const { category_id } = req.body; // null = remove from category

    const category = await resolveOwnedCategoryId(req.user!._id, category_id);
    if (!category.ok) {
      res.status(400).json({ message: "Invalid category id" });
      return;
    }

    const image = await Image.findOneAndUpdate(
      { public_id, user_id: req.user!._id },
      { $set: { category_id: category.id } },
      { new: true },
    );
    if (!image) {
      res.status(404).json({ message: "Image not found" });
      return;
    }
    res.json(image);
  } catch {
    res.status(500).json({ message: "Failed to assign category" });
  }
};

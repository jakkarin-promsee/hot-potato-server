import { Response } from "express";
import { StudentMemory } from "../models/student_memory.model";
import { AuthRequest } from "../types";

export const getMemory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  const memory = await StudentMemory.findOne({ user_id: userId }).lean();
  if (!memory) {
    res.status(200).json({});
    return;
  }

  const { __v, ...rest } = memory as typeof memory & { __v?: number };
  void __v;
  res.status(200).json(rest);
};

export const clearMemory = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  await StudentMemory.deleteOne({ user_id: userId });
  res.status(200).json({ message: "Memory cleared" });
};

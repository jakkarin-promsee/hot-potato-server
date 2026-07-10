import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model";
import { AuthRequest } from "../types";

const generateToken = (id: string) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET as string,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    } as any,
  );
};

// POST /api/auth/register
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    res
      .status(400)
      .json({ message: "Name, email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters" });
    return;
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400).json({ message: "Email already in use" });
    return;
  }

  const user = await User.create({ name, email, password });
  const token = generateToken(user._id.toString());

  res.status(201).json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
};

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  // 1. Check user exists
  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  // 2. Check status
  if (user.status !== "active") {
    res
      .status(403)
      .json({ message: "Your account has been suspended or blocked" });
    return;
  }

  // 3. Compare password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  // 4. Generate token
  const token = generateToken(user._id.toString());

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
};

// GET /api/auth/recheck
export const recheckToken = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      message: "Authentication failed, please login again",
      code: "TOKEN_INVALID",
      forceRelogin: true,
      clearToken: true,
    });
    return;
  }

  // Sliding session: issue a fresh token whenever client rechecks on app entry.
  const token = generateToken(req.user._id.toString());

  res.status(200).json({
    message: "Token valid",
    token,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
};

// PUT /api/auth/change-password
export const changePassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { currentPassword, newPassword } = req.body;

  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: "Current password and new password are required" });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ message: "New password must be at least 8 characters" });
    return;
  }

  if (currentPassword === newPassword) {
    res
      .status(400)
      .json({ message: "New password must be different from current password" });
    return;
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    res.status(401).json({ message: "Current password is incorrect" });
    return;
  }

  user.password = newPassword;
  await user.save();

  res.status(200).json({ message: "Password changed successfully" });
};

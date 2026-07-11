import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client, TokenPayload } from "google-auth-library";
import { User } from "../models/user.model";
import { AuthRequest } from "../types";

const generateToken = (id: string) => {
  const options: jwt.SignOptions = {
    // jwt types want a ms-style StringValue; the env var is a plain string.
    expiresIn: (process.env.JWT_EXPIRES_IN ||
      "7d") as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  return jwt.sign({ id }, process.env.JWT_SECRET as string, options);
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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

  const normalizedEmail = normalizeEmail(email);
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    res.status(400).json({ message: "Email already in use" });
    return;
  }

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password,
  });
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

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  // 1. Check user exists
  const user = await User.findOne({ email: normalizeEmail(email) });
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

  // 3. Compare password (Google-only accounts have none — point them at the button)
  if (!user.password) {
    res
      .status(401)
      .json({ message: "This account uses Google sign-in — use the Google button" });
    return;
  }
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

// POST /api/auth/google — GIS ID-token flow: the client's "Sign in with Google"
// button hands us a credential (Google-signed JWT); we verify it against our
// client id, find-or-create the user, and mint the app's own JWT. Response
// shape is identical to /login, so nothing downstream changes.
let googleClient: OAuth2Client | undefined;

export const googleLogin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { credential } = req.body;

  if (typeof credential !== "string" || !credential) {
    res.status(400).json({ message: "Google credential is required" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ message: "Google sign-in is not configured" });
    return;
  }

  let payload: TokenPayload | undefined;
  try {
    googleClient ??= new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ message: "Invalid Google credential" });
    return;
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    res.status(401).json({ message: "Invalid Google credential" });
    return;
  }

  const email = normalizeEmail(payload.email);
  let user = await User.findOne({ googleId: payload.sub });
  if (!user) {
    // Auto-link an existing password account with the same email (safe:
    // Google verified it above); otherwise create a passwordless account.
    user = await User.findOne({ email });
    if (user) {
      user.googleId = payload.sub;
      await user.save();
    } else {
      user = await User.create({
        name: (payload.name || email.split("@")[0]).trim(),
        email,
        googleId: payload.sub,
      });
    }
  }

  if (user.status !== "active") {
    res
      .status(403)
      .json({ message: "Your account has been suspended or blocked" });
    return;
  }

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
  // Sliding session: issue a fresh token whenever client rechecks on app entry.
  const token = generateToken(req.user!._id.toString());

  res.status(200).json({
    message: "Token valid",
    token,
    user: {
      id: req.user!._id,
      name: req.user!.name,
      email: req.user!.email,
      role: req.user!.role,
    },
  });
};

// PUT /api/auth/change-password
export const changePassword = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { currentPassword, newPassword } = req.body;

  if (
    typeof currentPassword !== "string" ||
    !currentPassword ||
    typeof newPassword !== "string" ||
    !newPassword
  ) {
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

  const user = await User.findById(req.user!._id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  if (!user.password) {
    res.status(400).json({
      message: "This account signs in with Google and has no password",
    });
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

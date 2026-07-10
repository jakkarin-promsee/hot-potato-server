import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model";
import { AuthRequest } from "../types";

type TokenErrorCode =
  | "TOKEN_MISSING"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "USER_NOT_FOUND"
  | "ACCOUNT_INACTIVE";

function sendReloginResponse(
  res: Response,
  status: number,
  message: string,
  code: TokenErrorCode,
): void {
  res.status(status).json({
    message,
    code,
    forceRelogin: true,
    clearToken: true,
  });
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // 1. Check token exists
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      sendReloginResponse(
        res,
        401,
        "No token, authorization denied",
        "TOKEN_MISSING",
      );
      return;
    }

    const token = authHeader.split(" ")[1];

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      id: string;
    };

    // 3. Find user
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      sendReloginResponse(res, 401, "User no longer exists", "USER_NOT_FOUND");
      return;
    }

    if (user.status !== "active") {
      sendReloginResponse(
        res,
        401,
        "Your account has been suspended or blocked",
        "ACCOUNT_INACTIVE",
      );
      return;
    }

    // 4. Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      sendReloginResponse(res, 401, "Token expired, please login again", "TOKEN_EXPIRED");
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      sendReloginResponse(res, 401, "Invalid token, please login again", "TOKEN_INVALID");
      return;
    }

    sendReloginResponse(
      res,
      401,
      "Authentication failed, please login again",
      "TOKEN_INVALID",
    );
  }
};

/** Sets `req.user` when a valid Bearer token is present; otherwise continues without user. */
export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      id: string;
    };
    const user = await User.findById(decoded.id).select("-password");
    if (user && user.status === "active") req.user = user;
  } catch {
    // Invalid/expired token — treat as anonymous for public endpoints
  }
  next();
};

// Role guard — use after protect
export const restrictTo = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "You don't have permission" });
      return;
    }
    next();
  };
};

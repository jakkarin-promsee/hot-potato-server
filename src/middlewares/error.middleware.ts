import { Request, Response, NextFunction } from "express";
import { recordServerError } from "../services/observability.service";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  console.error(err.stack ?? err);
  recordServerError({
    method: req?.method ?? "UNKNOWN",
    route: req?.originalUrl ?? req?.url ?? "",
    status: 500,
    name: err?.name || "Error",
  });
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error";
  res.status(500).json({ message });
};

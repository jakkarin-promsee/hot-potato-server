import { Router } from "express";
import {
  getUsers,
  createUser,
  getMyProfile,
  updateMyProfile,
} from "../controllers/user.controller";
import { protect, restrictTo } from "../middlewares/auth.middleware";

const router = Router();

router.get("/me/profile", protect, getMyProfile);
router.put("/me/profile", protect, updateMyProfile);

router.get("/", protect, getUsers);
router.post("/", createUser);

export default router;

import { Router } from "express";
import {
  getUsers,
  getMyProfile,
  updateMyProfile,
} from "../controllers/user.controller";
import { protect, restrictTo } from "../middlewares/auth.middleware";

const router = Router();

router.get("/me/profile", protect, getMyProfile);
router.put("/me/profile", protect, updateMyProfile);

router.get("/", protect, restrictTo("admin"), getUsers);

export default router;

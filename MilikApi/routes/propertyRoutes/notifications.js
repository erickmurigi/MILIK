// routes/notification.js
import express from "express"
import { 
  createNotification, 
  getNotification, 
  getNotifications, 
  markAsRead, 
  deleteNotification,
  markAllAsRead,
  getNotificationStats 
} from "../../controllers/propertyController/notifications.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create notification
router.post("/", verifyUser, createNotification)

// Get all notifications
router.get("/", verifyUser, getNotifications)

// Get notification stats
router.get("/get/stats", verifyUser, getNotificationStats)

// Get single notification
router.get("/:id", verifyUser, getNotification)

// Mark as read
router.put("/read/:id", verifyUser, markAsRead)

// Mark all as read
router.put("/read-all", verifyUser, markAllAsRead)

// Delete notification
router.delete("/:id", verifyUser, deleteNotification)

export default router
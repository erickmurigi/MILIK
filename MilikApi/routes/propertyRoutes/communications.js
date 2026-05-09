import express from 'express';
import { verifyUser } from '../../controllers/verifyToken.js';
import {
  getCommunicationTemplates,
  getSmsLogsController,
  previewCommunicationController,
  sendCommunicationController,
  sendTestSmsController,
} from '../../controllers/propertyController/communications.js';

const router = express.Router();

router.get('/templates', verifyUser, getCommunicationTemplates);
router.post('/preview', verifyUser, previewCommunicationController);
router.post('/send', verifyUser, sendCommunicationController);
router.get('/sms-logs', verifyUser, getSmsLogsController);
router.post('/test-sms', verifyUser, sendTestSmsController);

export default router;

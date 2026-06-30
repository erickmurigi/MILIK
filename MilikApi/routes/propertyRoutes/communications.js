import express from 'express';
import { verifyUser } from '../../controllers/verifyToken.js';
import {
  getCommunicationTemplates,
  deleteSmsLogController,
  getSmsLogsController,
  getEmailLogsController,
  previewCommunicationController,
  sendCommunicationController,
  sendTestSmsController,
  sendTestEmailController,
} from '../../controllers/propertyController/communications.js';

const router = express.Router();

router.get('/templates', verifyUser, getCommunicationTemplates);
router.post('/preview', verifyUser, previewCommunicationController);
router.post('/send', verifyUser, sendCommunicationController);
router.get('/sms-logs', verifyUser, getSmsLogsController);
router.delete('/sms-logs/:id', verifyUser, deleteSmsLogController);
router.post('/test-sms', verifyUser, sendTestSmsController);
router.get('/email-logs', verifyUser, getEmailLogsController);
router.post('/test-email', verifyUser, sendTestEmailController);

export default router;

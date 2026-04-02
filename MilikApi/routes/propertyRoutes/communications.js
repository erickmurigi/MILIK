import express from 'express';
import { verifyUser } from '../../controllers/verifyToken.js';
import {
  getCommunicationTemplates,
  previewCommunicationController,
  sendCommunicationController,
} from '../../controllers/propertyController/communications.js';

const router = express.Router();

router.get('/templates', verifyUser, getCommunicationTemplates);
router.post('/preview', verifyUser, previewCommunicationController);
router.post('/send', verifyUser, sendCommunicationController);

export default router;

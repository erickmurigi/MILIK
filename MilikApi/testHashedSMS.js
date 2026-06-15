#!/usr/bin/env node
/**
 * testHashedSMS.js
 * Test Africa's Talking masked/hashed number SMS via your running server.
 * No DB connection needed — credentials are read from the server's existing profile.
 *
 * Usage (server must be running):
 *   node testHashedSMS.js [maskedNumber] [message]
 *
 * Examples:
 *   node testHashedSMS.js
 *   node testHashedSMS.js c191198995c47386340414ed25bd108e1dee68d5805548afbd88529b64166e64
 *   node testHashedSMS.js <hash> "Custom message here"
 */

import axios from 'axios';

const PORT          = process.env.PORT || 8800;
const MASKED_NUMBER = process.argv[2] || 'c191198995c47386340414ed25bd108e1dee68d5805548afbd88529b64166e64';
const MESSAGE       = process.argv[3] || 'Your M-Pesa payment was received. Thank you!';

const url = `http://localhost:${PORT}/api/carwash/mpesa/dev/test-hashed-sms`;

console.log("\n=== Africa's Talking Hashed Number SMS Test ===");
console.log('Server      :', url);
console.log('maskedNumber:', MASKED_NUMBER);
console.log('Message     :', MESSAGE);
console.log('================================================\n');
console.log('NOTE: Full raw AT response will appear in your server console logs.\n');

try {
  const response = await axios.post(url, { maskedNumber: MASKED_NUMBER, message: MESSAGE }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 35000,
  });

  console.log('[Result] HTTP status :', response.status);
  console.log('[Result] Response    :\n', JSON.stringify(response.data, null, 2));
} catch (err) {
  if (err?.response) {
    console.error('[Error] HTTP status :', err.response.status);
    console.error('[Error] Body        :', JSON.stringify(err.response.data, null, 2));
  } else if (err?.code === 'ECONNREFUSED') {
    console.error('[Error] Could not reach the server. Make sure your API server is running on port', PORT);
  } else {
    console.error('[Error]', err?.message || err);
  }
  process.exit(1);
}

import crypto from 'crypto';

export const generateAccessKeys = () => {
  const adminKey = crypto.randomBytes(16).toString('hex');
  const normalKey = crypto.randomBytes(16).toString('hex');
  return { adminKey, normalKey };
};
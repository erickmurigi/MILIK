// middleware/ipWhitelist.js

// Co-op Bank C2B callback IPs — configure via COOP_BANK_IPS env var (comma-separated) in production
const coopBankIPs = process.env.COOP_BANK_IPS
  ? process.env.COOP_BANK_IPS.split(',').map((ip) => ip.trim()).filter(Boolean)
  : [];

export const coopBankIPWhitelist = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') return next();
  if (!coopBankIPs.length) {
    console.warn('[Co-op B2B] COOP_BANK_IPS env var not set — all IPs allowed. Set it in production.');
    return next();
  }
  const clientIP = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!coopBankIPs.includes(clientIP)) {
    console.error(`[Co-op B2B] Blocked IP: ${clientIP}`);
    return res.status(403).json({ success: false, message: 'Forbidden: Unauthorized IP address' });
  }
  next();
};

const safaricomIPs = [
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69'
];

export const safaricomIPWhitelist = (req, res, next) => {
  const clientIP = req.ip || req.socket.remoteAddress;
  const realIP = clientIP.replace(/^::ffff:/, '');
  
  // Allow localhost in development
  if (process.env.NODE_ENV === 'development' && 
      (realIP === '::1' || realIP === '127.0.0.1' || realIP.startsWith('::ffff:127.0.0.1'))) {
    return next();
  }

  if (!safaricomIPs.includes(realIP)) {
    console.error(`Blocked IP: ${realIP}`);
    return res.status(403).json({ 
      success: false,
      message: 'Forbidden: Unauthorized IP address' 
    });
  }
  
  next();
};
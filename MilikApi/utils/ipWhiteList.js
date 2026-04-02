// middleware/ipWhitelist.js
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
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Extract first IP if comma-separated list
  const realIP = clientIP.split(',')[0].trim();
  
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
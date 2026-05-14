import Redis from "ioredis";

let client = null;
let connectionFailed = false;

/**
 * Returns a shared ioredis client if REDIS_URL is configured, otherwise null.
 * The caller is responsible for graceful fallback when null is returned.
 */
const getRedisClient = () => {
  if (connectionFailed || !process.env.REDIS_URL) return null;
  if (client) return client;

  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 5000,
  });

  client.on("error", (err) => {
    if (!connectionFailed) {
      console.warn("[Redis] Connection error — rate limiters will use in-memory store:", err.message);
      connectionFailed = true;
      client = null;
    }
  });

  client.on("connect", () => {
    connectionFailed = false;
    console.info("[Redis] Connected — distributed rate limiting active");
  });

  return client;
};

export default getRedisClient;

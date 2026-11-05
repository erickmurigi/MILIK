// The request being served, reachable from deep service code without threading `req` through every
// call. Used by the ledger's period check to know who is posting (a posting window on a closed
// period lets only the user it was opened for post into it). Outside a request (crons, scripts)
// there is no scope and no user.
import { AsyncLocalStorage } from "async_hooks";

const storage = new AsyncLocalStorage();

export const requestScopeMiddleware = (req, _res, next) => storage.run({ req }, next);

export const currentRequest = () => storage.getStore()?.req || null;

// The signed-in user's id as a string ("milik-admin" for the built-in admin), or "".
export const currentUserKey = () => {
  const user = currentRequest()?.user;
  return String(user?.id || user?._id || "");
};

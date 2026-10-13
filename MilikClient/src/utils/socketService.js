import { useEffect, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';

const resolveSocketUrl = () => {
  const configuredApiUrl = String(import.meta.env.VITE_API_URL || '/api').trim();
  const normalizedApiUrl = configuredApiUrl.endsWith('/') ? configuredApiUrl.slice(0, -1) : configuredApiUrl;

  if (normalizedApiUrl === '/api') {
    return window.location.origin;
  }

  return normalizedApiUrl.endsWith('/api')
    ? normalizedApiUrl.slice(0, -4)
    : normalizedApiUrl;
};

let socketInstance = null;

// The socket is a module-level singleton living outside React, shared by every component
// that calls useSocket() — useSyncExternalStore is React's own API for exactly this shape
// (subscribe to an external store, read a consistent snapshot). It replaces an earlier
// ref-read-during-render (the value never updated a mounted component once the socket
// connected) and, after that, a setState-inside-an-effect (flagged for the same reason
// ModuleTabManager's tab state is — see the note there); useSyncExternalStore's own
// re-render mechanism isn't a local setState call, so neither pitfall applies here.
const listeners = new Set();
const notifyListeners = () => { listeners.forEach((cb) => cb()); };
const subscribe = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
const getSnapshot = () => socketInstance;

const ensureSocketConnected = () => {
  if (socketInstance) return;

  const token = localStorage.getItem('milik_token');
  const socketUrl = resolveSocketUrl();

  socketInstance = io(socketUrl, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    auth: token ? { token } : undefined,
  });

  socketInstance.on('connect', () => {
    console.log('Socket connected:', socketInstance.id);
  });

  socketInstance.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socketInstance.on('error', (error) => {
    console.error('Socket error:', error);
  });

  notifyListeners();
};

export const disconnectSocket = () => {
  if (!socketInstance) return;

  try {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
  } catch (error) {
    console.warn("Failed to disconnect socket cleanly", error);
  } finally {
    socketInstance = null;
    notifyListeners();
  }
};

const useSocket = () => {
  useEffect(() => {
    ensureSocketConnected();

    // Cleanup on unmount - disconnect if this is the last component
    return () => {
      // Only disconnect if we're truly unmounting the app
      // Individual components should keep the socket alive
    };
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot);
};

export default useSocket;

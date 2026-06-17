import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearAuth } from '../redux/authSlice';
import { clearClientSessionStorage } from '../utils/sessionCleanup';
import {
  INACTIVITY_TIMEOUT_MS,
  hasSessionTimedOut,
  markSessionActivity,
} from '../utils/sessionTimeout';

const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

// Prevents mousemove/scroll from running clearTimeout+setTimeout+localStorage at 60 fps.
// At most one reset per 10 s — fine for a 60-minute window.
const ACTIVITY_THROTTLE_MS = 10_000;

const useInactivityLogout = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(state => state.auth?.currentUser);
  const timeoutRef      = useRef(null);
  const logoutStartedRef = useRef(false);
  const lastResetRef    = useRef(0); // timestamp of last successful timer reset

  const clearInactivityTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const notifyServerLogout = () => {
    const token = localStorage.getItem('milik_token');
    if (!token) return;
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
  };

  const forceLogout = () => {
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    clearInactivityTimer();
    console.warn(`[Session] Inactive for ${INACTIVITY_TIMEOUT_MS / 60_000} minutes. Logging out.`);
    notifyServerLogout();
    clearClientSessionStorage();
    dispatch(clearAuth());
    window.location.replace('/login');
  };

  const scheduleInactivityTimer = () => {
    clearInactivityTimer();
    timeoutRef.current = setTimeout(forceLogout, INACTIVITY_TIMEOUT_MS);
  };

  const resetInactivityTimer = () => {
    const now = Date.now();
    // Throttle: skip if we already reset within the last ACTIVITY_THROTTLE_MS
    if (now - lastResetRef.current < ACTIVITY_THROTTLE_MS) return;

    if (hasSessionTimedOut(now)) {
      forceLogout();
      return;
    }

    lastResetRef.current = now;
    markSessionActivity(now);
    scheduleInactivityTimer();
  };

  const validateExistingSession = () => {
    if (hasSessionTimedOut()) {
      forceLogout();
      return;
    }
    scheduleInactivityTimer();
  };

  useEffect(() => {
    if (!currentUser) {
      clearInactivityTimer();
      logoutStartedRef.current = false;
      lastResetRef.current = 0; // clear throttle so the next login fires immediately
      return undefined;
    }

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove'];

    activityEvents.forEach(event => {
      document.addEventListener(event, resetInactivityTimer, true);
    });
    window.addEventListener('focus', validateExistingSession);
    window.addEventListener('pageshow', validateExistingSession);
    document.addEventListener('visibilitychange', validateExistingSession);

    validateExistingSession();

    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, resetInactivityTimer, true);
      });
      window.removeEventListener('focus', validateExistingSession);
      window.removeEventListener('pageshow', validateExistingSession);
      document.removeEventListener('visibilitychange', validateExistingSession);
      clearInactivityTimer();
    };
  }, [currentUser, dispatch]);
};

export default useInactivityLogout;

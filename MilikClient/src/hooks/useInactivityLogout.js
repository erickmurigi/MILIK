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

const useInactivityLogout = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(state => state.auth?.currentUser);
  const timeoutRef = useRef(null);
  const logoutStartedRef = useRef(false);

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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      keepalive: true,
    }).catch(() => {
      // Local cleanup still protects this browser if the network is unavailable.
    });
  };

  const forceLogout = () => {
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    clearInactivityTimer();
    console.warn('User inactive for 15 minutes. Logging out...');
    notifyServerLogout();
    clearClientSessionStorage();
    dispatch(clearAuth());
    window.location.replace('/login');
  };

  const scheduleInactivityTimer = () => {
    clearInactivityTimer();

    timeoutRef.current = setTimeout(() => {
      forceLogout();
    }, INACTIVITY_TIMEOUT_MS);
  };

  const resetInactivityTimer = () => {
    if (hasSessionTimedOut()) {
      forceLogout();
      return;
    }

    markSessionActivity();
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
      return undefined;
    }

    const activityEvents = [
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'mousemove',
    ];

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

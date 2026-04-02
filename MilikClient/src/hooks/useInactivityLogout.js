import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearAuth } from '../redux/authSlice';
import { clearClientSessionStorage } from '../utils/sessionCleanup';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

const useInactivityLogout = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(state => state.auth?.currentUser);
  const timeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const resetInactivityTimer = () => {
    // Clear existing timer
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Update last activity time
    lastActivityRef.current = Date.now();

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      if (currentUser) {
        console.warn('User inactive for 15 minutes. Logging out...');
        clearClientSessionStorage();
        dispatch(clearAuth());
        window.location.replace('/login');
      }
    }, INACTIVITY_TIMEOUT);
  };

  useEffect(() => {
    if (!currentUser) return;

    // Activity events to track
    const activityEvents = [
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'mousemove'
    ];

    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, resetInactivityTimer, true);
    });

    // Initialize the timer
    resetInactivityTimer();

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, resetInactivityTimer, true);
      });
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentUser, dispatch]);
};

export default useInactivityLogout;

/* eslint-disable react/prop-types */
import { createContext, useEffect, useReducer } from "react";

const INITIAL_STATE = {
    user: null,
    loading: false,
    error: null,
};

export const AuthContext = createContext(INITIAL_STATE);

const AuthReducer = (state, action) => {
    switch (action.type) {
        case "LOGIN_START":
            return {
                user: null,
                loading: true,
                error: null,
            };
        case "LOGIN_SUCCESS":
            return {
                user: action.payload,
                loading: false,
                error: null,
            };
        case "LOGIN_FAILURE":
            return {
                user: null,
                loading: false,
                error: action.payload,
            };
        case "LOGOUT":
            return {
                user: null,
                loading: false,
                error: null,
            };
        case "SYNC_FROM_STORAGE":
            return {
                user: action.payload,
                loading: false,
                error: null,
            };
        default:
            return state;
    }
};

export const AuthContextProvider = ({ children }) => {
    const [state, dispatch] = useReducer(AuthReducer, INITIAL_STATE, (initial) => {
        // Sync from Redux-persisted localStorage on mount
        const user = localStorage.getItem('milik_user');
        if (user) {
            try {
                return { ...initial, user: JSON.parse(user) };
            } catch (error) {
                console.error('Failed to parse user from localStorage:', error);
                return initial;
            }
        }
        return initial;
    });

    // Keep in sync with localStorage whenever Redux updates it
    useEffect(() => {
        const handleStorageChange = () => {
            const user = localStorage.getItem('milik_user');
            if (user) {
                try {
                    dispatch({ type: 'SYNC_FROM_STORAGE', payload: JSON.parse(user) });
                } catch (error) {
                    console.error('Failed to sync user from storage:', error);
                }
            } else {
                dispatch({ type: 'LOGOUT' });
            }
        };

        // Listen for storage changes (from other tabs/contexts)
        window.addEventListener('storage', handleStorageChange);
        
        // Also check localStorage changes periodically (within same tab)
        const interval = setInterval(handleStorageChange, 500);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(interval);
        };
    }, []);

    return (
        <AuthContext.Provider value={{ user: state.user, loading: state.loading, error: state.error, dispatch }}>
            {children}
        </AuthContext.Provider>
    );
};
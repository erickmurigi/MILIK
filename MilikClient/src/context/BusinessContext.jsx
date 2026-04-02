/* eslint-disable react/prop-types */
import {createContext,useEffect,useReducer} from "react"

// Initial state for the BusinessContext
const INITIAL_BUSINESS_STATE = {
  businessData: null,
  loading: false,
  error: null,
};

export const BusinessContext = createContext(INITIAL_BUSINESS_STATE);

// Reducer function for the BusinessContext
const BusinessReducer = (state, action) => {
  switch (action.type) {
    case "BUSINESS_DATA_START":
      return {
        ...state,
        loading: true,
        error: null,
      };
    case "BUSINESS_DATA_SUCCESS":
      return {
        businessData: action.payload,
        loading: false,
        error: null,
      };
    case "BUSINESS_DATA_FAILURE":
      return {
        ...state,
        loading: false,
        error: action.payload,
      };
    case "BUSINESS_UPDATE_START":
      return {
        ...state,
        isFetching: true
      };
    case "BUSINESS_UPDATE_SUCCESS":
      return {
        businessData: action.payload,
        isFetching: false,
        error: false,
      };
    case "BUSINESS_UPDATE_FAILURE":
      return {
        businessData: state.businessData,
        isFetching: false,
        error: true,
      };
    case "RESET_BUSINESS_DATA":
      return {
        businessData: null,
        isFetching: false,
        error: false,
      };
    default:
      return state;
  }
};

const STORAGE_KEY = 'businessData';

export const BusinessProvider = ({ children }) => {
  const [state, dispatch] = useReducer(BusinessReducer, INITIAL_BUSINESS_STATE, (initial) => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return {
          ...initial,
          businessData: JSON.parse(data),
        };
      }
    } catch (error) {
      console.error('Failed to parse businessData from storage:', error);
    }
    return initial;
  });

  // Sync to localStorage whenever business data changes
  useEffect(() => {
    if (state.businessData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.businessData));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [state.businessData]);

  return (
    <BusinessContext.Provider value={{ ...state, dispatch }}>
      {children}
    </BusinessContext.Provider>
  );
};
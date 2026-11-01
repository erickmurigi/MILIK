import { createContext, useContext, useReducer, useCallback } from 'react';

const TOKEN_KEY    = 'landlord_portal_token';
const LANDLORD_KEY = 'landlord_portal_landlord';
const COMPANY_KEY  = 'landlord_portal_company';

const INITIAL_STATE = {
  landlord: null,
  company:  null,
  token:    null,
};

const initState = () => {
  try {
    const token    = localStorage.getItem(TOKEN_KEY);
    const landlord = JSON.parse(localStorage.getItem(LANDLORD_KEY) || 'null');
    const company  = JSON.parse(localStorage.getItem(COMPANY_KEY)  || 'null');
    if (token && landlord) return { token, landlord, company };
  } catch {}
  return INITIAL_STATE;
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN':
      return { token: action.token, landlord: action.landlord, company: action.company };
    case 'LOGOUT':
      return INITIAL_STATE;
    default:
      return state;
  }
};

export const LandlordPortalContext = createContext(INITIAL_STATE);

export function LandlordPortalContextProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  const login = useCallback(({ token, landlord, company }) => {
    localStorage.setItem(TOKEN_KEY,    token);
    localStorage.setItem(LANDLORD_KEY, JSON.stringify(landlord));
    localStorage.setItem(COMPANY_KEY,  JSON.stringify(company));
    dispatch({ type: 'LOGIN', token, landlord, company });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LANDLORD_KEY);
    localStorage.removeItem(COMPANY_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <LandlordPortalContext.Provider value={{ ...state, login, logout }}>
      {children}
    </LandlordPortalContext.Provider>
  );
}

export const useLandlordPortal = () => useContext(LandlordPortalContext);

import { createContext, useContext, useReducer, useCallback } from 'react';

const ESS_TOKEN_KEY    = 'ess_token';
const ESS_EMPLOYEE_KEY = 'ess_employee';
const ESS_COMPANY_KEY  = 'ess_company';

const INITIAL_STATE = {
  employee: null,
  company:  null,
  token:    null,
};

const initState = () => {
  try {
    const token    = localStorage.getItem(ESS_TOKEN_KEY);
    const employee = JSON.parse(localStorage.getItem(ESS_EMPLOYEE_KEY) || 'null');
    const company  = JSON.parse(localStorage.getItem(ESS_COMPANY_KEY)  || 'null');
    if (token && employee) return { token, employee, company };
  } catch {}
  return INITIAL_STATE;
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN':
      return { token: action.token, employee: action.employee, company: action.company };
    case 'LOGOUT':
      return INITIAL_STATE;
    case 'UPDATE_EMPLOYEE':
      return { ...state, employee: { ...state.employee, ...action.payload } };
    default:
      return state;
  }
};

export const ESSContext = createContext(INITIAL_STATE);

export function ESSContextProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  const login = useCallback(({ token, employee, company }) => {
    localStorage.setItem(ESS_TOKEN_KEY,    token);
    localStorage.setItem(ESS_EMPLOYEE_KEY, JSON.stringify(employee));
    localStorage.setItem(ESS_COMPANY_KEY,  JSON.stringify(company));
    dispatch({ type: 'LOGIN', token, employee, company });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ESS_TOKEN_KEY);
    localStorage.removeItem(ESS_EMPLOYEE_KEY);
    localStorage.removeItem(ESS_COMPANY_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

  const updateEmployee = useCallback((payload) => {
    dispatch({ type: 'UPDATE_EMPLOYEE', payload });
  }, []);

  return (
    <ESSContext.Provider value={{ ...state, login, logout, updateEmployee }}>
      {children}
    </ESSContext.Provider>
  );
}

export const useESS = () => useContext(ESSContext);

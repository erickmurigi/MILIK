import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import MilikConfirmDialog from "../components/Modals/MilikConfirmDialog";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState({ isOpen: false });
  const resolveRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ isOpen: true, ...options });
    });
  }, []);

  const handleConfirm = () => {
    setState({ isOpen: false });
    resolveRef.current?.(true);
  };

  const handleCancel = () => {
    setState({ isOpen: false });
    resolveRef.current?.(false);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <MilikConfirmDialog
        isOpen={state.isOpen}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        isDangerous={state.isDangerous}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
};

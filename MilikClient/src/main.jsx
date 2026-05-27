import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client';
import './index.css'
import App from './App.jsx'
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from './redux/store';

const StoreLoader = () => (
  <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "#f8faf9" }}>
    <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #d1e8dc", borderTopColor: "#0B3B2E", animation: "spin 0.7s linear infinite" }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// Render the app
ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={<StoreLoader />} persistor={persistor}>
        <App />
      </PersistGate>
    </Provider>
  </StrictMode>
);

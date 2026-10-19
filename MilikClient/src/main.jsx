import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client';
import './index.css'
import './styles/scrollbar.css'
import App from './App.jsx'
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from './redux/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Longer than the longest per-query staleTime in the app (10 min) — otherwise a query's cache
      // entry gets garbage-collected from disuse before its own staleTime would've required a refetch
      // anyway, silently defeating the point of setting a long staleTime at all.
      gcTime: 15 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <App />
        </PersistGate>
      </Provider>
    </QueryClientProvider>
  </StrictMode>
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProviders } from './context.jsx';
import './theme.js';
import './supabase.js';
import { registerSW } from './components/Push.jsx';
import './styles.css';
import './styles2.css';
import './styles3.css';

registerSW();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);

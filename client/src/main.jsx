import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { initHotjar } from './analytics/hotjar.js';
import './styles.css';

// No-ops when no Hotjar site ID is configured, which is the default for local dev.
// Called before render so window.hj exists for any identify() during the first paint.
initHotjar();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

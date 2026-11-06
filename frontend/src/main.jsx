import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './auth.jsx';
import App from './App.jsx';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

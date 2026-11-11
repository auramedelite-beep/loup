import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import i18n from './i18n';
import './index.css';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { SocketProvider } from '@/contexts/SocketContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { App } from './pages/App';

const container = document.getElementById('root');
if (!container) throw new Error('No root element found');

createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <AuthProvider>
            <SettingsProvider>
              <SocketProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
              </SocketProvider>
            </SettingsProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nextProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthGate} from './components/AuthGate.tsx';
import {ApiKeyGate} from './components/ApiKeyGate.tsx';
import {OnboardingGate} from './components/OnboardingGate.tsx';
import {installFetchAuth} from './lib/authStore.ts';
import './index.css';

// Attach the auth token to every /api/* request before the app boots.
installFetchAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <ApiKeyGate>
        <OnboardingGate>
          <App />
        </OnboardingGate>
      </ApiKeyGate>
    </AuthGate>
  </StrictMode>,
);

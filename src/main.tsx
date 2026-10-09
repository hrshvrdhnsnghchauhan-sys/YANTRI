import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ApiKeyGate} from './components/ApiKeyGate.tsx';
import {OnboardingGate} from './components/OnboardingGate.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiKeyGate>
      <OnboardingGate>
        <App />
      </OnboardingGate>
    </ApiKeyGate>
  </StrictMode>,
);

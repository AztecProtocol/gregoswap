import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { NetworkProvider } from './contexts/NetworkContext.tsx';
import { WalletProvider } from './contexts/WalletContext.tsx';
import { ContractsProvider } from './contexts/ContractsContext.tsx';
import { SwapProvider } from './contexts/SwapContext.tsx';
import { OnboardingProvider } from './contexts/OnboardingContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <ContractsProvider>
          <OnboardingProvider>
            <SwapProvider>
              <App />
            </SwapProvider>
          </OnboardingProvider>
        </ContractsProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);

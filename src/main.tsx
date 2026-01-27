import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { NetworkProvider } from './contexts/NetworkContext.tsx';
import { WalletProvider } from './contexts/WalletContext.tsx';
import { ContractsProvider } from './contexts/ContractsContext.tsx';
import { BalancesProvider } from './contexts/BalancesContext.tsx';
import { SwapProvider } from './contexts/SwapContext.tsx';
import { DripProvider } from './contexts/DripContext.tsx';
import { OnboardingProvider } from './contexts/OnboardingContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <ContractsProvider>
          <OnboardingProvider>
            <BalancesProvider>
              <SwapProvider>
                <DripProvider>
                  <App />
                </DripProvider>
              </SwapProvider>
            </BalancesProvider>
          </OnboardingProvider>
        </ContractsProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);

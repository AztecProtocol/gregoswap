import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { WalletProvider } from './contexts/WalletContext.tsx';
import { ContractsProvider } from './contexts/ContractsContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <ContractsProvider>
        <App />
      </ContractsProvider>
    </WalletProvider>
  </StrictMode>,
);

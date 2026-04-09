/**
 * Send Context
 * Manages offchain transfer flow and link generation
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useSendReducer, type SendState, type SendPhase } from './reducer';

interface SendContextType extends SendState {
  setToken: (token: 'gc' | 'gcp') => void;
  setRecipientAddress: (address: string) => void;
  setAmount: (amount: string) => void;
  startSend: () => void;
  generatingLink: () => void;
  linkReady: (link: string) => void;
  sendError: (error: string) => void;
  dismissError: () => void;
  reset: () => void;
}

const SendContext = createContext<SendContextType | undefined>(undefined);

export function useSend() {
  const context = useContext(SendContext);
  if (context === undefined) {
    throw new Error('useSend must be used within a SendProvider');
  }
  return context;
}

interface SendProviderProps {
  children: ReactNode;
}

export function SendProvider({ children }: SendProviderProps) {
  const [state, actions] = useSendReducer();

  const value: SendContextType = {
    ...state,
    setToken: actions.setToken,
    setRecipientAddress: actions.setRecipientAddress,
    setAmount: actions.setAmount,
    startSend: actions.startSend,
    generatingLink: actions.generatingLink,
    linkReady: actions.linkReady,
    sendError: actions.sendError,
    dismissError: actions.dismissError,
    reset: actions.reset,
  };

  return <SendContext.Provider value={value}>{children}</SendContext.Provider>;
}

export type { SendPhase };

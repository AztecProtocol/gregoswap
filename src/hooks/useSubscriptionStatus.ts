import { useState, useEffect, useRef } from 'react';
import type { SubscriptionStatus } from '../services/contractService';
import { querySubscriptionStatus } from '../services/contractService';
import { useWallet } from '../contexts/wallet';
import { useContracts } from '../contexts/contracts';
import { useNetwork } from '../contexts/network';
import { useOnboarding } from '../contexts/onboarding';
import { EXCHANGE_RATE_POLL_INTERVAL_MS } from '../types';

export function useSubscriptionStatus(isSwapping: boolean): SubscriptionStatus {
  const { wallet, currentAddress } = useWallet();
  const { getAmm } = useContracts();
  const { activeNetwork } = useNetwork();
  const { status: onboardingStatus } = useOnboarding();
  const [status, setStatus] = useState<SubscriptionStatus>({ kind: 'no_fpc' });
  const isFetchingRef = useRef(false);

  const isOnboarded = onboardingStatus === 'completed';

  // Hide when not onboarded or no address; reset to loading when ready
  useEffect(() => {
    if (!isOnboarded || !currentAddress) {
      setStatus({ kind: 'no_fpc' });
    } else {
      setStatus({ kind: 'loading' });
    }
  }, [isOnboarded, currentAddress, activeNetwork]);

  useEffect(() => {
    const amm = getAmm();

    if (!wallet || !currentAddress || !amm || isSwapping || !isOnboarded) {
      return;
    }

    if (!activeNetwork.subscriptionFPC) {
      setStatus({ kind: 'no_fpc' });
      return;
    }

    let cancelled = false;

    async function fetch() {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        const result = await querySubscriptionStatus(wallet!, activeNetwork, getAmm()!, currentAddress!);
        if (!cancelled) setStatus(result);
      } catch {
        // Leave previous status on transient error to avoid flicker
      } finally {
        isFetchingRef.current = false;
      }
    }

    fetch();
    const id = setInterval(fetch, EXCHANGE_RATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      isFetchingRef.current = false;
    };
  }, [wallet, currentAddress, activeNetwork, getAmm, isSwapping, isOnboarded]);

  return status;
}

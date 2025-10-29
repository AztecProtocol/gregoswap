import { useState, useRef, useEffect } from 'react';
import { Paper, Box, IconButton } from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { SwapBox } from './SwapBox';
import { SwapProgress } from './SwapProgress';
import { ExchangeRateDisplay } from './ExchangeRateDisplay';
import { SwapButton } from './SwapButton';
import { SwapErrorAlert } from './SwapErrorAlert';
import { useContracts } from '../../contexts/ContractsContext';
import { useWallet } from '../../contexts/WalletContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useSwap } from '../../hooks/useSwap';
import { useBalances } from '../../hooks/useBalances';

export function SwapContainer() {
  const { isLoadingContracts } = useContracts();
  const { isUsingEmbeddedWallet, currentAddress } = useWallet();
  const { status: onboardingStatus, isSwapPending, clearSwapPending, startOnboardingFlow } = useOnboarding();

  const swapErrorRef = useRef<HTMLDivElement | null>(null);

  // Get balances using the hook
  const { balances, refetch: refetchBalances } = useBalances();

  // State for amounts
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');

  // Use swap hook for calculations, validation, swap logic, and exchange rate
  const {
    exchangeRate,
    isLoadingRate,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    swapPhase,
    swapError,
    executeSwap,
    dismissError,
  } = useSwap({
    fromAmount,
    toAmount,
  });

  // Recalculate amounts when exchange rate becomes available
  const prevExchangeRateRef = useRef(exchangeRate);
  useEffect(() => {
    const wasUnavailable = prevExchangeRateRef.current === undefined;
    const isNowAvailable = exchangeRate !== undefined;

    // If rate just became available, recalculate the empty field
    if (wasUnavailable && isNowAvailable) {
      if (fromAmount !== '' && toAmount === '') {
        // Recalculate To amount from From amount
        const numValue = parseFloat(fromAmount);
        if (!isNaN(numValue)) {
          setToAmount((numValue * exchangeRate).toFixed(6));
        }
      } else if (toAmount !== '' && fromAmount === '') {
        // Recalculate From amount from To amount
        const numValue = parseFloat(toAmount);
        if (!isNaN(numValue)) {
          setFromAmount((numValue / exchangeRate).toFixed(6));
        }
      }
    }

    prevExchangeRateRef.current = exchangeRate;
  }, [exchangeRate, fromAmount, toAmount]);

  // Track previous isSwapping state to detect completion and refresh balances
  const prevIsSwappingRef = useRef(isSwapping);
  useEffect(() => {
    // If swap just completed successfully (was swapping, now not swapping, no error)
    if (prevIsSwappingRef.current && !isSwapping && !swapError) {
      setFromAmount('');
      setToAmount('');
      // Refresh balances after successful swap
      refetchBalances();
    }
    prevIsSwappingRef.current = isSwapping;
  }, [isSwapping, swapError, refetchBalances]);

  // Handle amount changes with recalculation
  const handleFromChange = (value: string) => {
    setFromAmount(value);
    if (value === '' || exchangeRate === undefined) {
      setToAmount('');
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setToAmount((numValue * exchangeRate).toFixed(6));
      }
    }
  };

  const handleToChange = (value: string) => {
    setToAmount(value);
    if (value === '' || exchangeRate === undefined) {
      setFromAmount('');
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setFromAmount((numValue / exchangeRate).toFixed(6));
      }
    }
  };

  const handleSwapDirection = () => {
    const tempFrom = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempFrom);
  };

  const handleSwapClick = () => {
    // Check if user needs onboarding
    if (isUsingEmbeddedWallet || onboardingStatus === 'not_started') {
      // Start onboarding flow with swap pending
      startOnboardingFlow();
    } else if (onboardingStatus === 'completed') {
      // Already onboarded, execute swap directly
      executeSwap();
    }
  };

  // Execute swap after onboarding completes with pending swap
  // Wait 2 seconds for the transition animation in the modal to complete
  useEffect(() => {
    if (onboardingStatus === 'completed' && isSwapPending) {
      executeSwap();
      const timer = setTimeout(async () => {
        // Close modal first while transition is still showing
        clearSwapPending();
      }, 2000); // Match the transition duration in OnboardingModal

      return () => clearTimeout(timer);
    }
  }, [onboardingStatus, isSwapPending, executeSwap, clearSwapPending]);

  // Scroll to error when it appears
  useEffect(() => {
    if (swapError) {
      setTimeout(() => {
        swapErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [swapError]);

  const handleMaxFromClick = () => {
    if (balances.gregoCoin !== null) {
      handleFromChange(balances.gregoCoin.toString());
    }
  };

  const handleMaxToClick = () => {
    if (balances.gregoCoinPremium !== null) {
      handleToChange(balances.gregoCoinPremium.toString());
    }
  };

  const showBalance = !isUsingEmbeddedWallet && currentAddress !== null;

  // Disable the opposite input when:
  // 1. Swap is in progress
  // 2. Exchange rate is loading/undefined and the other input has a value
  const isRateUnavailable = isLoadingRate || exchangeRate === undefined;
  const disableFromBox = isSwapping || (isRateUnavailable && toAmount !== '');
  const disableToBox = isSwapping || (isRateUnavailable && fromAmount !== '');

  // Show "..." placeholder in the disabled box when rate is unavailable
  const fromPlaceholder = disableFromBox && isRateUnavailable ? '...' : '0.0';
  const toPlaceholder = disableToBox && isRateUnavailable ? '...' : '0.0';

  return (
    <Paper
      elevation={3}
      sx={{
        p: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'rgba(212, 255, 40, 0.2)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* From Token */}
      <SwapBox
        label="From"
        tokenName="GRG"
        value={fromAmount}
        onChange={handleFromChange}
        disabled={disableFromBox}
        usdValue={fromAmountUSD}
        balance={balances.gregoCoin}
        showBalance={showBalance}
        onMaxClick={handleMaxFromClick}
        placeholder={fromPlaceholder}
      />

      {/* Swap Direction Button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', my: -2, position: 'relative', zIndex: 1 }}>
        <IconButton
          onClick={handleSwapDirection}
          disabled={isSwapping || isLoadingContracts || isLoadingRate || exchangeRate === undefined}
          sx={{
            backgroundColor: 'rgba(18, 18, 28, 1)',
            border: '2px solid',
            borderColor: 'rgba(212, 255, 40, 0.3)',
            color: 'primary.main',
            boxShadow: '0 0 0 4px rgba(18, 18, 28, 1)',
            '&:hover': {
              backgroundColor: 'primary.main',
              borderColor: 'primary.main',
              color: '#00122E',
              transform: 'rotate(180deg)',
              boxShadow: '0 0 0 4px rgba(18, 18, 28, 1)',
            },
            '&:disabled': {
              opacity: 0.5,
              color: 'text.secondary',
              backgroundColor: 'rgba(18, 18, 28, 1)',
              boxShadow: '0 0 0 4px rgba(18, 18, 28, 1)',
            },
            transition: 'all 0.3s ease-in-out',
          }}
        >
          <SwapVertIcon />
        </IconButton>
      </Box>

      {/* To Token */}
      <SwapBox
        label="To"
        tokenName="GRGP"
        value={toAmount}
        onChange={handleToChange}
        disabled={disableToBox}
        usdValue={toAmountUSD * 5}
        balance={balances.gregoCoinPremium}
        showBalance={showBalance}
        onMaxClick={handleMaxToClick}
        placeholder={toPlaceholder}
      />

      {/* Exchange Rate Info */}
      <ExchangeRateDisplay exchangeRate={exchangeRate} isLoadingRate={isLoadingRate} />

      {/* Swap Button or Progress */}
      {isSwapping ? (
        <SwapProgress phase={swapPhase} />
      ) : (
        <SwapButton
          onClick={handleSwapClick}
          disabled={!canSwap}
          loading={isSwapping}
          contractsLoading={isLoadingContracts}
          hasAmount={!!fromAmount && parseFloat(fromAmount) > 0}
        />
      )}

      {/* Error Display */}
      <SwapErrorAlert error={swapError} onDismiss={dismissError} errorRef={swapErrorRef} />
    </Paper>
  );
}

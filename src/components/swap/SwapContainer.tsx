import { useState, useRef, useEffect } from 'react';
import { Paper, Box, Button, Typography } from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import { SwapBox } from './SwapBox';
import { SwapProgress } from './SwapProgress';
import { DripProgress } from './DripProgress';
import { ExchangeRateDisplay } from './ExchangeRateDisplay';
import { SwapButton } from './SwapButton';
import { SwapErrorAlert } from './SwapErrorAlert';
import { DripModal } from '../DripModal';
import { useContracts } from '../../contexts/ContractsContext';
import { useWallet } from '../../contexts/WalletContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useSwap } from '../../hooks/useSwap';
import { useBalances } from '../../hooks/useBalances';
import { waitForTxWithPhases } from '../../utils/txUtils';

export function SwapContainer() {
  const { isLoadingContracts, drip } = useContracts();
  const { isUsingEmbeddedWallet, currentAddress } = useWallet();
  const {
    status: onboardingStatus,
    isSwapPending,
    isDripPending,
    dripPassword,
    clearSwapPending,
    clearDripPassword,
    completeDripExecution,
    startOnboardingFlow,
  } = useOnboarding();

  const swapErrorRef = useRef<HTMLDivElement | null>(null);

  // Get balances using the hook
  const { balances, isLoading: isLoadingBalances, refetch: refetchBalances } = useBalances();

  // State for amounts
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');

  // State for drip modal (for users already onboarded)
  const [isDripModalOpen, setIsDripModalOpen] = useState(false);

  // State for drip execution (after onboarding)
  const [isDripping, setIsDripping] = useState(false);
  const [dripPhase, setDripPhase] = useState<'sending' | 'mining' | null>(null);
  const [dripError, setDripError] = useState<string | null>(null);

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
    isDripping,
    fromTokenBalance: balances.gregoCoin,
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

  // Track if a swap was actually in progress (to distinguish from initial mount)
  const wasSwappingRef = useRef(false);
  useEffect(() => {
    if (isSwapping) {
      wasSwappingRef.current = true;
    }
  }, [isSwapping]);

  useEffect(() => {
    // If swap just completed successfully (was swapping, now not swapping, no error)
    if (wasSwappingRef.current && !isSwapping && !swapError) {
      wasSwappingRef.current = false;
      setFromAmount('');
      setToAmount('');
      // Refresh balances after successful swap
      refetchBalances();
    }
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

  const handleSwapClick = () => {
    // Check if user needs onboarding
    if (isUsingEmbeddedWallet || onboardingStatus === 'not_started') {
      // Start onboarding flow with swap type - user initiated a swap transaction
      startOnboardingFlow('swap', true);
    } else if (onboardingStatus === 'completed') {
      // Already onboarded, execute swap directly
      executeSwap();
    }
  };

  // Track if swap was triggered after onboarding
  const swapTriggeredAfterOnboardingRef = useRef(false);

  useEffect(() => {
    if (onboardingStatus === 'completed' && isSwapPending) {
      executeSwap();
      swapTriggeredAfterOnboardingRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingStatus, isSwapPending]);

  // Clear swap pending flag only after swap actually completes
  // (not just when onboarding completes but before swap starts)
  useEffect(() => {
    if (swapTriggeredAfterOnboardingRef.current && isSwapPending && !isSwapping) {
      swapTriggeredAfterOnboardingRef.current = false;
      clearSwapPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSwapPending, isSwapping]);

  // Execute drip after onboarding completes with password
  useEffect(() => {
    async function executeDrip() {
      if (!isDripPending || !dripPassword || !currentAddress || isDripping) return;

      console.log('Starting drip execution');
      setIsDripping(true);
      setDripPhase('sending');
      setDripError(null);

      // Complete onboarding immediately to show transition animation
      // Transaction will continue in background
      completeDripExecution();
      clearDripPassword();

      try {
        const sentTx = await drip(dripPassword, currentAddress);
        await waitForTxWithPhases(sentTx, setDripPhase);

        // Success - refresh balances and clear state
        refetchBalances();
        setIsDripping(false);
        setDripPhase(null);
      } catch (error) {
        console.error('Drip error:', error);
        // Extract meaningful error message
        let errorMessage = 'Failed to claim GregoCoin. Please try again.';

        if (error instanceof Error) {
          // Check for common error patterns
          if (error.message.includes('Simulation failed')) {
            errorMessage = error.message;
          } else if (error.message.includes('User denied') || error.message.includes('rejected')) {
            errorMessage = 'Transaction was rejected in wallet';
          } else if (error.message.includes('password') || error.message.includes('Password')) {
            errorMessage = 'Invalid password. Please try again.';
          } else if (error.message.includes('already claimed') || error.message.includes('Already claimed')) {
            errorMessage = 'You have already claimed your GregoCoin tokens.';
          } else {
            errorMessage = error.message;
          }
        }

        setDripError(errorMessage);
        setDripPhase(null);
        setIsDripping(false);
      }
    }

    executeDrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDripPending, dripPassword, currentAddress, completeDripExecution]);

  // Scroll to error when it appears
  useEffect(() => {
    if (swapError || dripError) {
      setTimeout(() => {
        swapErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [swapError, dripError]);

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

  // Only disable inputs when swap is in progress
  const disableFromBox = isSwapping;
  const disableToBox = isSwapping;

  // Show "..." placeholder when rate is unavailable and opposite box has value
  const isRateUnavailable = isLoadingRate || exchangeRate === undefined;
  const fromPlaceholder = isRateUnavailable && toAmount !== '' ? '...' : '0.0';
  const toPlaceholder = isRateUnavailable && fromAmount !== '' ? '...' : '0.0';

  // Calculate if FROM amount exceeds balance
  const fromHasError =
    showBalance &&
    balances.gregoCoin !== null &&
    fromAmount !== '' &&
    parseFloat(fromAmount) > Number(balances.gregoCoin);

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
        isLoadingBalance={isLoadingBalances}
        onMaxClick={handleMaxFromClick}
        placeholder={fromPlaceholder}
        hasError={fromHasError}
      />

      {/* Swap Direction Icon (visual only) */}
      <Box sx={{ display: 'flex', justifyContent: 'center', my: -2, position: 'relative', zIndex: 1 }}>
        <Box
          sx={{
            backgroundColor: 'rgba(18, 18, 28, 1)',
            border: '2px solid',
            borderColor: 'rgba(212, 255, 40, 0.3)',
            color: 'primary.main',
            boxShadow: '0 0 0 4px rgba(18, 18, 28, 1)',
            borderRadius: '50%',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SwapVertIcon />
        </Box>
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
        isLoadingBalance={isLoadingBalances}
        onMaxClick={handleMaxToClick}
        placeholder={toPlaceholder}
      />

      {/* Exchange Rate Info */}
      <ExchangeRateDisplay exchangeRate={exchangeRate} isLoadingRate={isLoadingRate} />

      {/* Don't have GregoCoin? Button */}
      <Box sx={{ mt: 2, mb: 1, textAlign: 'center' }}>
        <Button
          size="small"
          startIcon={<WaterDropIcon />}
          variant="text"
          onClick={() => {
            // Check if user needs to onboard first (using embedded wallet or not yet started)
            if (isUsingEmbeddedWallet || onboardingStatus === 'not_started') {
              startOnboardingFlow('drip');
            } else if (onboardingStatus === 'completed') {
              setIsDripModalOpen(true);
            }
          }}
          sx={{
            textTransform: 'none',
            color: 'text.secondary',
            fontSize: '0.8125rem',
            fontWeight: 400,
            '&:hover': {
              color: 'primary.main',
              backgroundColor: 'rgba(212, 255, 40, 0.05)',
            },
          }}
        >
          Don't have GregoCoin?
        </Button>
      </Box>

      {/* Swap Button or Progress */}
      {isDripping ? (
        <DripProgress phase={dripPhase} />
      ) : isSwapping ? (
        <SwapProgress phase={swapPhase} />
      ) : (
        <SwapButton
          onClick={handleSwapClick}
          disabled={!canSwap || isDripping}
          loading={isSwapping}
          contractsLoading={isLoadingContracts}
          hasAmount={!!fromAmount && parseFloat(fromAmount) > 0}
        />
      )}

      {/* Error Display */}
      <SwapErrorAlert
        error={swapError || dripError}
        onDismiss={() => {
          if (dripError) setDripError(null);
          if (swapError) dismissError();
        }}
        errorRef={swapErrorRef}
      />

      {/* Drip Modal */}
      <DripModal open={isDripModalOpen} onClose={() => setIsDripModalOpen(false)} onSuccess={() => refetchBalances()} />
    </Paper>
  );
}

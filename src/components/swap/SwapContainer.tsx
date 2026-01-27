/**
 * SwapContainer Component
 * Main swap interface using contexts
 */

import { useEffect, useRef } from 'react';
import { Paper, Box } from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { SwapBox } from './SwapBox';
import { SwapProgress } from './SwapProgress';
import { DripProgress } from './DripProgress';
import { ExchangeRateDisplay } from './ExchangeRateDisplay';
import { SwapButton } from './SwapButton';
import { SwapErrorAlert } from './SwapErrorAlert';
import { useContracts } from '../../contexts/ContractsContext';
import { useWallet } from '../../contexts/WalletContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useSwap } from '../../contexts/SwapContext';
import { useBalances } from '../../contexts/BalancesContext';
import { useDrip } from '../../contexts/DripContext';

export function SwapContainer() {
  const { isLoadingContracts } = useContracts();
  const { isUsingEmbeddedWallet, currentAddress } = useWallet();
  const { status: onboardingStatus, startOnboarding } = useOnboarding();

  const {
    fromAmount,
    toAmount,
    exchangeRate,
    isLoadingRate,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    phase: swapPhase,
    error: swapError,
    setFromAmount,
    setToAmount,
    executeSwap,
    dismissError: dismissSwapError,
  } = useSwap();

  const { balances, isLoading: isLoadingBalances } = useBalances();
  const { isDripping, phase: dripPhase, error: dripError, dismissError: dismissDripError } = useDrip();

  const swapErrorRef = useRef<HTMLDivElement | null>(null);

  // Scroll to error when it appears
  useEffect(() => {
    if (swapError || dripError) {
      setTimeout(() => {
        swapErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [swapError, dripError]);

  const handleSwapClick = () => {
    // Check if user needs onboarding
    if (isUsingEmbeddedWallet || onboardingStatus === 'idle') {
      // Start onboarding - user initiated a swap transaction
      startOnboarding(true);
    } else if (onboardingStatus === 'completed') {
      // Already onboarded, execute swap directly
      executeSwap();
    }
  };

  const handleMaxFromClick = () => {
    if (balances.gregoCoin !== null) {
      setFromAmount(balances.gregoCoin.toString());
    }
  };

  const handleMaxToClick = () => {
    if (balances.gregoCoinPremium !== null) {
      setToAmount(balances.gregoCoinPremium.toString());
    }
  };

  const showBalance = !isUsingEmbeddedWallet && currentAddress !== null;

  // Only disable inputs when swap is in progress
  const disableFromBox = isSwapping;
  const disableToBox = isSwapping;

  // Show "..." placeholder when rate is unavailable and opposite box has value
  const isRateUnavailable = isLoadingRate || exchangeRate === null;
  const fromPlaceholder = isRateUnavailable && toAmount !== '' ? '...' : '0.0';
  const toPlaceholder = isRateUnavailable && fromAmount !== '' ? '...' : '0.0';

  // Calculate if FROM amount exceeds balance
  const fromHasError =
    showBalance &&
    balances.gregoCoin !== null &&
    fromAmount !== '' &&
    parseFloat(fromAmount) > Number(balances.gregoCoin);

  // Combined error handling
  const displayError = swapError || dripError;
  const handleDismissError = () => {
    if (dripError) dismissDripError();
    if (swapError) dismissSwapError();
  };

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
        onChange={setFromAmount}
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
        onChange={setToAmount}
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

      {/* Swap Button or Progress */}
      {isDripping ? (
        <DripProgress phase={dripPhase === 'sending' || dripPhase === 'mining' ? dripPhase : undefined} />
      ) : isSwapping ? (
        <SwapProgress phase={swapPhase === 'sending' || swapPhase === 'mining' ? swapPhase : undefined} />
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
      <SwapErrorAlert error={displayError} onDismiss={handleDismissError} errorRef={swapErrorRef} />
    </Paper>
  );
}

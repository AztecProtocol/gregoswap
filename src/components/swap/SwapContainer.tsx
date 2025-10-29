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

interface SwapContainerProps {
  onStartOnboarding: () => void;
}

export function SwapContainer({ onStartOnboarding }: SwapContainerProps) {
  const { isLoadingContracts, fetchBalances } = useContracts();

  const { isUsingEmbeddedWallet, currentAddress } = useWallet();
  const { status: onboardingStatus, startOnboarding } = useOnboarding();

  const swapErrorRef = useRef<HTMLDivElement | null>(null);

  // State for balances
  const [gregoCoinBalance, setGregoCoinBalance] = useState<bigint | undefined>();
  const [gregoCoinPremiumBalance, setGregoCoinPremiumBalance] = useState<bigint | undefined>();

  // State for amounts
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');

  // Use swap hook for calculations, validation, exchange rate, and swap logic
  const {
    fromAmountUSD,
    toAmountUSD,
    exchangeRate,
    isLoadingRate,
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

  // Track previous isSwapping state to detect completion
  const prevIsSwappingRef = useRef(isSwapping);
  useEffect(() => {
    // If swap just completed successfully (was swapping, now not swapping, no error)
    if (prevIsSwappingRef.current && !isSwapping && !swapError) {
      setFromAmount('');
      setToAmount('');
    }
    prevIsSwappingRef.current = isSwapping;
  }, [isSwapping, swapError]);

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
      startOnboarding(true);
      onStartOnboarding();
    } else if (onboardingStatus === 'completed') {
      // Already onboarded, execute swap directly
      executeSwap();
    }
  };

  // Scroll to error when it appears
  useEffect(() => {
    if (swapError) {
      setTimeout(() => {
        swapErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [swapError]);

  const handleMaxFromClick = () => {
    if (gregoCoinBalance !== null) {
      handleFromChange(gregoCoinBalance.toString());
    }
  };

  const handleMaxToClick = () => {
    if (gregoCoinPremiumBalance !== null) {
      handleToChange(gregoCoinPremiumBalance.toString());
    }
  };

  const showBalance = !isUsingEmbeddedWallet && currentAddress !== null;

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
        disabled={isSwapping}
        usdValue={fromAmountUSD}
        balance={gregoCoinBalance}
        showBalance={showBalance}
        onMaxClick={handleMaxFromClick}
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
        disabled={isSwapping}
        usdValue={toAmountUSD * 5}
        balance={gregoCoinPremiumBalance}
        showBalance={showBalance}
        onMaxClick={handleMaxToClick}
      />

      {/* Exchange Rate Info */}
      <ExchangeRateDisplay exchangeRate={exchangeRate} isLoading={isLoadingContracts || isLoadingRate} />

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

import { useEffect, useState } from 'react';
import {
  ThemeProvider,
  CssBaseline,
  Container,
  Box,
  Typography,
  Button,
  IconButton,
  Paper,
  CircularProgress,
  Alert,
  Collapse,
  Chip,
} from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { theme } from './theme';
import { SwapBox } from './components/SwapBox';
import { SwapProgress } from './components/SwapProgress';
import { useContracts } from './contexts/ContractsContext';
import { useWallet } from './contexts/WalletContext';
import { WalletConnectModal } from './components/WalletConnectModal';
import type { AztecAddress } from '@aztec/aztec.js';

function GregoSwapLogo({ height = 48 }: { height?: number }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontSize: `${height}px`,
        lineHeight: 1,
      }}
    >
      {/* GREGO in Martel - GRE normal, GO italic */}
      <Box
        component="span"
        sx={{
          fontFamily: 'Martel, serif',
          fontWeight: 300,
          color: '#D4FF28',
          letterSpacing: '0.02em',
        }}
      >
        <Box component="span" sx={{ fontStyle: 'normal' }}>
          GRE
        </Box>
        <Box component="span" sx={{ fontStyle: 'italic' }}>
          GO&nbsp;
        </Box>
      </Box>

      {/* SWAP in Workbench */}
      <Box
        component="span"
        sx={{
          fontFamily: 'Workbench, monospace',
          fontWeight: 400,
          fontStyle: 'normal',
          color: '#9d4d87',
          letterSpacing: '0.05em',
        }}
      >
        SWAP
      </Box>
    </Box>
  );
}

export function App() {
  const {
    amm,
    gregoCoin,
    gregoCoinPremium,
    isLoading: contractsLoading,
    error,
    getExchangeRate,
    swap,
    fetchBalances,
    gregoCoinBalance,
    gregoCoinPremiumBalance,
    isLoadingBalances,
  } = useContracts();
  const { setCurrentAddress, isUsingEmbeddedWallet, currentAddress } = useWallet();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [isFromActive, setIsFromActive] = useState(true);
  const [exchangeRate, setExchangeRate] = useState<number | undefined>(undefined);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shouldExecuteSwap, setShouldExecuteSwap] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isModalForSwap, setIsModalForSwap] = useState(false);

  // USD conversion constants (1 GregoCoin = $10 USD)
  const GREGOCOIN_USD_PRICE = 10;

  // Calculate USD values
  const fromAmountUSD = fromAmount ? parseFloat(fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = toAmount && exchangeRate ? parseFloat(toAmount) * GREGOCOIN_USD_PRICE * exchangeRate : 0;

  // Check if amounts exceed balance
  const fromExceedsBalance =
    !isUsingEmbeddedWallet &&
    currentAddress !== null &&
    gregoCoinBalance !== null &&
    fromAmount !== '' &&
    parseFloat(fromAmount) > Number(gregoCoinBalance);

  const toExceedsBalance =
    !isUsingEmbeddedWallet &&
    currentAddress !== null &&
    gregoCoinPremiumBalance !== null &&
    toAmount !== '' &&
    parseFloat(toAmount) > Number(gregoCoinPremiumBalance);

  // Fetch exchange rate with auto-refresh every 10 seconds (paused during swaps)
  useEffect(() => {
    async function fetchExchangeRate() {
      if (!amm || !gregoCoin || !gregoCoinPremium || isSwapping) return;

      try {
        setIsLoadingRate(true);
        const rate = await getExchangeRate();

        setExchangeRate(rate);
        setIsLoadingRate(false);
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
        setIsLoadingRate(false);
      }
    }

    // Initial fetch
    fetchExchangeRate();

    // Set up auto-refresh every 10 seconds (only when not swapping)
    const intervalId = setInterval(() => {
      if (!isSwapping) {
        fetchExchangeRate();
      }
    }, 10000);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [amm, gregoCoin, gregoCoinPremium, getExchangeRate, isSwapping]);

  // Recalculate amounts when exchange rate changes
  useEffect(() => {
    if (exchangeRate === undefined) return;

    if (isFromActive && fromAmount !== '' && fromAmount !== '0') {
      const calculatedTo = (parseFloat(fromAmount) * exchangeRate).toFixed(6);
      setToAmount(calculatedTo);
    } else if (!isFromActive && toAmount !== '' && toAmount !== '0') {
      const calculatedFrom = (parseFloat(toAmount) / exchangeRate).toFixed(6);
      setFromAmount(calculatedFrom);
    }
  }, [exchangeRate, isFromActive, fromAmount, toAmount]);

  // Fetch balances when external wallet is connected
  useEffect(() => {
    if (!isUsingEmbeddedWallet && currentAddress && !contractsLoading && gregoCoin && gregoCoinPremium) {
      fetchBalances();
    }
  }, [isUsingEmbeddedWallet, currentAddress, contractsLoading, gregoCoin, gregoCoinPremium, fetchBalances]);

  // Execute swap after wallet switch when ready
  useEffect(() => {
    if (shouldExecuteSwap && currentAddress && !isUsingEmbeddedWallet && !contractsLoading) {
      setShouldExecuteSwap(false);
      doSwap();
    }
  }, [shouldExecuteSwap, currentAddress, isUsingEmbeddedWallet, contractsLoading]);

  const handleFromChange = (value: string) => {
    setFromAmount(value);
    setIsFromActive(true);

    if (value === '') {
      setToAmount('');
    } else if (exchangeRate !== undefined) {
      const calculatedTo = (parseFloat(value) * exchangeRate).toFixed(6);
      setToAmount(calculatedTo);
    } else {
      // If rate is loading and user is typing, show loading in the other box
      setToAmount('...');
    }
  };

  const handleToChange = (value: string) => {
    setToAmount(value);
    setIsFromActive(false);

    if (value === '') {
      setFromAmount('');
    } else if (exchangeRate !== undefined) {
      const calculatedFrom = (parseFloat(value) / exchangeRate).toFixed(6);
      setFromAmount(calculatedFrom);
    } else {
      // If rate is loading and user is typing, show loading in the other box
      setFromAmount('...');
    }
  };

  const handleSwapDirection = () => {
    // Swap the tokens and values
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
    setIsFromActive(!isFromActive);
  };

  const doSwap = async () => {
    // Clear any previous errors
    setSwapError(null);

    if (!amm || !gregoCoin || !gregoCoinPremium || !fromAmount || parseFloat(fromAmount) <= 0) {
      const errorMsg = 'Cannot perform swap: Missing data or invalid amount';
      console.error(errorMsg);
      setSwapError(errorMsg);
      return;
    }

    setIsSwapping(true);
    try {
      await swap(gregoCoin.address, gregoCoinPremium.address, parseFloat(toAmount), parseFloat(fromAmount) * 1.1);
      // Clear inputs on success
      setFromAmount('');
      setToAmount('');

      // Refresh exchange rate after successful swap
      try {
        const rate = await getExchangeRate();
        setExchangeRate(rate);
      } catch (err) {
        console.error('Failed to refresh exchange rate after swap:', err);
      }

      // Refresh balances after successful swap
      if (!isUsingEmbeddedWallet && currentAddress) {
        try {
          await fetchBalances();
        } catch (err) {
          console.error('Failed to refresh balances after swap:', err);
        }
      }
    } catch (error) {
      console.error('Swap failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Swap failed. Please try again.';
      setSwapError(errorMessage);
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: 'background.default',
          py: 4,
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'url(/background.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)',
            opacity: 0.6,
            zIndex: 0,
          },
        }}
      >
        {/* Wallet Connection Chip - Top Right */}
        <Box
          sx={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 1000,
          }}
        >
          <Chip
            label={
              !isUsingEmbeddedWallet && currentAddress
                ? `${currentAddress.toString().slice(0, 6)}...${currentAddress.toString().slice(-4)}`
                : 'Connect wallet'
            }
            onClick={() => {
              setIsModalForSwap(false);
              setIsModalOpen(true);
            }}
            sx={{
              backgroundColor: 'rgba(212, 255, 40, 0.15)',
              border: '1px solid',
              borderColor: 'primary.main',
              color: 'primary.main',
              fontFamily: !isUsingEmbeddedWallet && currentAddress ? 'monospace' : 'inherit',
              fontWeight: 600,
              fontSize: '0.875rem',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                backgroundColor: 'rgba(212, 255, 40, 0.25)',
                borderColor: 'primary.main',
                transform: 'scale(1.05)',
                boxShadow: '0 4px 12px rgba(212, 255, 40, 0.3)',
              },
              '& .MuiChip-label': {
                px: 2,
              },
            }}
          />
        </Box>

        <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 6, mt: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <GregoSwapLogo height={56} />
            </Box>
            <Typography variant="body1" color="text.secondary">
              Swap GregoCoin for GregoCoinPremium
            </Typography>
          </Box>

          {/* Swap Interface */}
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
              disabled={isSwapping || (!isFromActive && toAmount !== '' && exchangeRate === undefined)}
              usdValue={fromAmountUSD}
              balance={gregoCoinBalance}
              showBalance={!isUsingEmbeddedWallet && currentAddress !== null}
              onMaxClick={() => {
                if (gregoCoinBalance !== null) {
                  handleFromChange(gregoCoinBalance.toString());
                }
              }}
            />

            {/* Swap Direction Button */}
            <Box sx={{ display: 'flex', justifyContent: 'center', my: -2, position: 'relative', zIndex: 1 }}>
              <IconButton
                onClick={handleSwapDirection}
                disabled={isSwapping || contractsLoading || isLoadingRate || exchangeRate === undefined}
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
              disabled={isSwapping || (isFromActive && fromAmount !== '' && exchangeRate === undefined)}
              usdValue={toAmountUSD * 5}
              balance={gregoCoinPremiumBalance}
              showBalance={!isUsingEmbeddedWallet && currentAddress !== null}
              onMaxClick={() => {
                if (gregoCoinPremiumBalance !== null) {
                  handleToChange(gregoCoinPremiumBalance.toString());
                }
              }}
            />

            {/* Exchange Rate Info */}
            <Box
              sx={{
                mt: 2,
                p: 2,
                backgroundColor: 'background.default',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Exchange Rate:
              </Typography>
              {contractsLoading || isLoadingRate || exchangeRate === undefined ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={14} sx={{ color: 'primary.main' }} />
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Loading...
                  </Typography>
                </Box>
              ) : error ? (
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#ff6b6b' }}>
                  Error
                </Typography>
              ) : amm ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                  1 GRG = {exchangeRate.toFixed(18)} GRGP
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                  No AMM
                </Typography>
              )}
            </Box>

            {/* Swap Button or Progress */}
            {isSwapping ? (
              <SwapProgress />
            ) : (
              <Button
                fullWidth
                variant="contained"
                size="large"
                disabled={
                  !fromAmount ||
                  parseFloat(fromAmount) <= 0 ||
                  contractsLoading ||
                  !amm ||
                  !gregoCoin ||
                  !gregoCoinPremium ||
                  fromExceedsBalance ||
                  toExceedsBalance
                }
                onClick={() => {
                  if (isUsingEmbeddedWallet) {
                    setIsModalForSwap(true);
                    setIsModalOpen(true);
                  } else {
                    doSwap();
                  }
                }}
                sx={{
                  mt: 3,
                  py: 2,
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #80336A 0%, #9d4d87 100%)',
                  color: '#F2EEE1',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #9d4d87 0%, #b35fa0 100%)',
                    boxShadow: '0px 4px 20px rgba(128, 51, 106, 0.5)',
                  },
                  '&:disabled': {
                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                    color: 'rgba(255, 255, 255, 0.3)',
                  },
                }}
              >
                {contractsLoading
                  ? 'Loading contracts...'
                  : !amm || !gregoCoin || !gregoCoinPremium
                    ? 'Contracts not registered'
                    : !fromAmount || parseFloat(fromAmount) <= 0
                      ? 'Enter an amount'
                      : 'Swap'}
              </Button>
            )}

            {/* Error Display */}
            <Collapse in={!!swapError}>
              <Alert
                severity="error"
                onClose={() => setSwapError(null)}
                sx={{
                  mt: 2,
                  backgroundColor: 'rgba(211, 47, 47, 0.1)',
                  border: '1px solid rgba(211, 47, 47, 0.3)',
                  color: '#ff6b6b',
                  '& .MuiAlert-icon': {
                    color: '#ff6b6b',
                  },
                }}
              >
                {swapError}
              </Alert>
            </Collapse>
          </Paper>

          {/* Footer Info */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
              mt: 4,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Built on
            </Typography>
            <Box
              component="img"
              src="/aztec_symbol_circle.png"
              alt="Aztec Network"
              sx={{
                height: 20,
                width: 20,
                opacity: 0.7,
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Aztec Network
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setIsModalForSwap(false);
        }}
        onAccountSelect={(address: AztecAddress) => {
          setCurrentAddress(address);

          // Only trigger swap if modal was opened from swap button
          if (isModalForSwap) {
            setShouldExecuteSwap(true);
            setIsModalForSwap(false);
          }
        }}
      />
    </ThemeProvider>
  );
}

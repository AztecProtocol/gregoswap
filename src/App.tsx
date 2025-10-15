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
} from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { theme } from './theme';
import { SwapBox } from './components/SwapBox';
import { useContracts } from './contexts/ContractsContext';

export function App() {
  const { amm, gregoCoin, gregoCoinPremium, isLoading: contractsLoading, error, getExchangeRate } = useContracts();
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [isFromActive, setIsFromActive] = useState(true);
  const [exchangeRate, setExchangeRate] = useState<number | undefined>(undefined);
  const [isLoadingRate, setIsLoadingRate] = useState(false);

  useEffect(() => {
    async function fetchExchangeRate() {
      if (!amm || !gregoCoin || !gregoCoinPremium) return;

      try {
        setIsLoadingRate(true);
        const rate = await getExchangeRate();

        console.log('Exchange rate:', rate);

        setExchangeRate(rate);
        setIsLoadingRate(false);
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
        setIsLoadingRate(false);
      }
    }

    fetchExchangeRate();
  }, [amm, gregoCoin, gregoCoinPremium, getExchangeRate]);

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
        <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 6, mt: 4 }}>
            <Typography variant="h2" component="h1" color="primary" sx={{ fontWeight: 700, mb: 1 }}>
              GregoSwap
            </Typography>
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
              tokenName="GregoCoin"
              value={fromAmount}
              onChange={handleFromChange}
              disabled={!isFromActive && toAmount !== '' && exchangeRate === undefined}
            />

            {/* Swap Direction Button */}
            <Box sx={{ display: 'flex', justifyContent: 'center', my: -2, position: 'relative', zIndex: 1 }}>
              <IconButton
                onClick={handleSwapDirection}
                disabled={contractsLoading || isLoadingRate || exchangeRate === undefined}
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
              tokenName="GregoCoinPremium"
              value={toAmount}
              onChange={handleToChange}
              disabled={isFromActive && fromAmount !== '' && exchangeRate === undefined}
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
                  1 GC = {exchangeRate.toFixed(6)} GCP
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                  No AMM
                </Typography>
              )}
            </Box>

            {/* Swap Button */}
            <Button
              fullWidth
              variant="contained"
              size="large"
              disabled={!fromAmount || parseFloat(fromAmount) <= 0}
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
              {!fromAmount || parseFloat(fromAmount) <= 0 ? 'Enter an amount' : 'Swap'}
            </Button>
          </Paper>

          {/* Footer Info */}
          <Box sx={{ textAlign: 'center', mt: 4 }}>
            <Typography variant="caption" color="text.secondary">
              Powered by Aztec Network
            </Typography>
          </Box>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

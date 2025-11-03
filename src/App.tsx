import { ThemeProvider, CssBaseline, Container, Box, Typography } from '@mui/material';
import { theme } from './theme';
import { GregoSwapLogo } from './components/GregoSwapLogo';
import { WalletChip } from './components/WalletChip';
import { NetworkSwitcher } from './components/NetworkSwitcher';
import { FooterInfo } from './components/FooterInfo';
import { SwapContainer } from './components/swap';
import { useWallet } from './contexts/WalletContext';
import { useOnboarding } from './contexts/OnboardingContext';
import { OnboardingModal } from './components/OnboardingModal';
import type { AztecAddress } from '@aztec/aztec.js/addresses';

export function App() {
  const { disconnectWallet, setCurrentAddress, isUsingEmbeddedWallet, currentAddress, error: walletError, isLoading: walletLoading } = useWallet();
  const { isOnboardingModalOpen, startOnboardingFlow, resetOnboarding } = useOnboarding();

  const handleWalletClick = () => {
    // If already connected, start a new onboarding flow to change wallet
    if (!isUsingEmbeddedWallet && currentAddress) {
      resetOnboarding();
    }
    startOnboardingFlow('swap'); // Default to swap flow when clicked from wallet chip
  };

  const handleDisconnect = () => {
    disconnectWallet();
    resetOnboarding();
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
            backgroundImage: 'url(/background.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)',
            opacity: 0.6,
            zIndex: 0,
          },
        }}
      >
        {/* Network Switcher */}
        <NetworkSwitcher />

        {/* Wallet Connection Chip */}
        <WalletChip
          address={currentAddress?.toString() || null}
          isConnected={!isUsingEmbeddedWallet && currentAddress !== null}
          onClick={handleWalletClick}
          onDisconnect={handleDisconnect}
        />

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
          <SwapContainer />

          {/* Wallet Error Display */}
          {walletError && (
            <Box sx={{ mt: 3 }}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(211, 47, 47, 0.1)',
                  border: '1px solid rgba(211, 47, 47, 0.3)',
                  borderRadius: 1,
                }}
              >
                <Typography variant="h6" color="error" sx={{ mb: 1, fontWeight: 600 }}>
                  Wallet Connection Error
                </Typography>
                <Typography variant="body2" color="error" sx={{ whiteSpace: 'pre-line' }}>
                  {walletError}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Loading Display */}
          {walletLoading && !walletError && (
            <Box sx={{ mt: 3 }}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(212, 255, 40, 0.05)',
                  border: '1px solid rgba(212, 255, 40, 0.2)',
                  borderRadius: 1,
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Connecting to network...
                </Typography>
              </Box>
            </Box>
          )}

          {/* Footer Info */}
          <FooterInfo />
        </Container>
      </Box>

      {/* Onboarding Modal - Handles the full onboarding flow */}
      <OnboardingModal
        open={isOnboardingModalOpen}
        onAccountSelect={(address: AztecAddress) => {
          setCurrentAddress(address);
        }}
      />
    </ThemeProvider>
  );
}

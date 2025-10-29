import { ThemeProvider, CssBaseline, Container, Box, Typography } from '@mui/material';
import { theme } from './theme';
import { GregoSwapLogo } from './components/GregoSwapLogo';
import { WalletChip } from './components/WalletChip';
import { FooterInfo } from './components/FooterInfo';
import { SwapContainer } from './components/swap';
import { useWallet } from './contexts/WalletContext';
import { useOnboarding } from './contexts/OnboardingContext';
import { OnboardingModal } from './components/OnboardingModal';
import type { AztecAddress } from '@aztec/aztec.js/addresses';

export function App() {
  const { disconnectWallet, setCurrentAddress, isUsingEmbeddedWallet, currentAddress } = useWallet();
  const { isOnboardingModalOpen, startOnboardingFlow, resetOnboarding } = useOnboarding();

  const handleWalletClick = () => {
    // If already connected, start a new onboarding flow to change wallet
    if (!isUsingEmbeddedWallet && currentAddress) {
      resetOnboarding();
    }
    startOnboardingFlow(false); // No pending swap when clicked from wallet chip
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

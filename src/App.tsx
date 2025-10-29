import { useState } from 'react';
import { ThemeProvider, CssBaseline, Container, Box, Typography } from '@mui/material';
import { theme } from './theme';
import { GregoSwapLogo } from './components/GregoSwapLogo';
import { WalletChip } from './components/WalletChip';
import { FooterInfo } from './components/FooterInfo';
import { SwapContainer } from './components/swap';
import { useWallet } from './contexts/WalletContext';
import { useOnboarding } from './contexts/OnboardingContext';
import { useContracts } from './contexts/ContractsContext';
import { WalletConnectModal } from './components/WalletConnectModal';
import { OnboardingModal } from './components/OnboardingModal';
import { SwapTransition } from './components/SwapTransition';
import { useOnboardingFlow } from './hooks/useOnboardingFlow';
import type { AztecAddress } from '@aztec/aztec.js/addresses';

export function App() {
  const { setCurrentAddress, isUsingEmbeddedWallet, currentAddress } = useWallet();
  const {
    status: onboardingStatus,
    isSwapPending,
    setStatus: setOnboardingStatus,
    completeOnboarding,
    clearSwapPending,
  } = useOnboarding();

  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Use onboarding flow hook
  const { isOnboardingModalOpen, showTransition, setIsOnboardingModalOpen, setShowTransition } = useOnboardingFlow({
    onboardingStatus,
    isSwapPending,
    setOnboardingStatus,
    completeOnboarding,
  });

  const handleTransitionComplete = () => {
    clearSwapPending();
    setShowTransition(false);
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
          onClick={() => setIsWalletModalOpen(true)}
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
          <SwapContainer onStartOnboarding={() => setIsOnboardingModalOpen(true)} />

          {/* Footer Info */}
          <FooterInfo />
        </Container>
      </Box>

      {/* Wallet Connect Modal - Only for non-onboarding wallet connection */}
      <WalletConnectModal
        open={isWalletModalOpen && onboardingStatus !== 'connecting_wallet'}
        onClose={() => setIsWalletModalOpen(false)}
        onAccountSelect={(address: AztecAddress) => {
          setCurrentAddress(address);
          setIsWalletModalOpen(false);
        }}
      />

      {/* Onboarding Modal - Handles the full onboarding flow */}
      <OnboardingModal
        open={
          isOnboardingModalOpen &&
          (onboardingStatus === 'connecting_wallet' ||
            onboardingStatus === 'registering_contracts' ||
            onboardingStatus === 'simulating_queries' ||
            onboardingStatus === 'error')
        }
        onAccountSelect={(address: AztecAddress) => {
          setCurrentAddress(address);
        }}
      />

      {/* Swap Transition Modal */}
      <SwapTransition open={showTransition} onComplete={handleTransitionComplete} />
    </ThemeProvider>
  );
}

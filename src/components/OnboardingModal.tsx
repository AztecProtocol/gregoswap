import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  ListItemButton,
  Fade,
  Collapse,
  TextField,
  Button,
  IconButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import SecurityIcon from '@mui/icons-material/Security';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useWallet } from '../contexts/WalletContext';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Aliased } from '@aztec/aztec.js/wallet';
import type { WalletProvider, PendingConnection } from '@aztec/wallet-sdk/manager';
import { hashToEmoji } from '@aztec/wallet-sdk/crypto';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

/** Computes verification emoji from provider metadata */
function getVerificationEmoji(provider: WalletProvider): string {
  return provider.metadata?.verificationHash ? hashToEmoji(provider.metadata.verificationHash as string) : '';
}

/**
 * Renders a 3x3 emoji grid for verification display.
 */
function EmojiGrid({ emojis, size = 'medium' }: { emojis: string; size?: 'small' | 'medium' | 'large' }) {
  const emojiArray = [...emojis];
  const rows = [emojiArray.slice(0, 3), emojiArray.slice(3, 6), emojiArray.slice(6, 9)];
  const fontSize = size === 'small' ? '0.9rem' : size === 'large' ? '1.8rem' : '1.4rem';

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
      {rows.map((row, i) => (
        <Box key={i} sx={{ display: 'flex', gap: '2px' }}>
          {row.map((emoji, j) => (
            <Box
              key={j}
              sx={{
                fontSize,
                width: '1.2em',
                height: '1.2em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {emoji}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

type WalletConnectionPhase = 'discovering' | 'selecting_wallet' | 'verifying' | 'connecting' | 'selecting_account';

interface OnboardingModalProps {
  open: boolean;
  onAccountSelect: (address: AztecAddress) => void;
}

export function OnboardingModal({ open, onAccountSelect }: OnboardingModalProps) {
  const {
    status,
    error,
    currentStep,
    totalSteps,
    resetOnboarding,
    flowType,
    currentFlow,
    closeModal,
    completeDripOnboarding,
    isSwapPending,
    isDripPending,
  } = useOnboarding();
  const { discoverWallets, initiateConnection, confirmConnection, cancelConnection, onWalletDisconnect } = useWallet();
  const [accounts, setAccounts] = useState<Aliased<AztecAddress>[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  // Wallet discovery and verification state
  const [connectionPhase, setConnectionPhase] = useState<WalletConnectionPhase>('discovering');
  const [discoveredWallets, setDiscoveredWallets] = useState<WalletProvider[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletProvider | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);

  // Track if we need to re-discover due to wallet disconnect
  const [needsRediscovery, setNeedsRediscovery] = useState(false);

  // Drip flow state
  const [password, setPassword] = useState('');

  // Transition animation state
  const [showCompletionCheck, setShowCompletionCheck] = useState(false);
  const [showSwapIcon, setShowSwapIcon] = useState(false);

  // Get steps from flow config
  const steps = currentFlow?.steps || [];

  // Listen for unexpected wallet disconnection
  useEffect(() => {
    const unsubscribe = onWalletDisconnect(() => {
      // Mark that we need to re-discover wallets (old MessagePorts are now invalid)
      setNeedsRediscovery(true);
      // Clear discovered wallets since they're now stale
      setDiscoveredWallets([]);
      setAccounts([]);
      // Reset to discovering phase so user can reconnect
      if (status === 'connecting_wallet') {
        setConnectionPhase('discovering');
        setAccountsError('Wallet disconnected. Please reconnect.');
      }
    });

    return unsubscribe;
  }, [onWalletDisconnect, status]);

  // Start wallet discovery when modal opens and status is connecting_wallet
  useEffect(() => {
    if (!open || status !== 'connecting_wallet') return;

    // Reset state
    setConnectionPhase('discovering');
    setDiscoveredWallets([]);
    setSelectedWallet(null);
    setPendingConnection(null);
    setAccounts([]);
    setAccountsError(null);
    setNeedsRediscovery(false);

    const discovery = discoverWallets();

    (async () => {
      let foundAny = false;
      for await (const wallet of discovery.wallets) {
        foundAny = true;
        setConnectionPhase('selecting_wallet');
        setDiscoveredWallets(prev => [...prev, wallet]);
      }
      if (!foundAny) {
        setAccountsError('No wallets found. Make sure your wallet extension is installed.');
      }
    })();

    return () => {
      discovery.cancel();
    };
  }, [open, status, discoverWallets]);

  // Handle manual re-discovery
  const handleRediscover = async () => {
    // Cancel any pending connection
    if (pendingConnection) {
      cancelConnection(pendingConnection);
    }

    setConnectionPhase('discovering');
    setDiscoveredWallets([]);
    setSelectedWallet(null);
    setPendingConnection(null);
    setAccounts([]);
    setAccountsError(null);
    setNeedsRediscovery(false);

    const discovery = discoverWallets();
    let foundAny = false;
    for await (const wallet of discovery.wallets) {
      foundAny = true;
      setConnectionPhase('selecting_wallet');
      setDiscoveredWallets(prev => [...prev, wallet]);
    }

    if (!foundAny) {
      setAccountsError('No wallets found. Make sure your wallet extension is installed.');
    }
  };

  // Handle wallet selection - initiates connection and shows verification UI
  const handleWalletSelect = async (provider: WalletProvider) => {
    try {
      setSelectedWallet(provider);
      setConnectionPhase('verifying');
      setAccountsError(null);

      // Initiate connection - this performs key exchange and returns pending connection
      const pending = await initiateConnection(provider);
      setPendingConnection(pending);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : 'Failed to initiate connection');
      setConnectionPhase('selecting_wallet');
      setSelectedWallet(null);
      setPendingConnection(null);
    }
  };

  // Handle user confirming the emoji verification
  const handleConfirmConnection = async () => {
    if (!selectedWallet || !pendingConnection) return;

    try {
      setConnectionPhase('connecting');
      setIsLoadingAccounts(true);

      const wallet = await confirmConnection(selectedWallet, pendingConnection);

      // Get accounts from wallet
      const walletAccounts = await wallet.getAccounts();

      if (!walletAccounts || walletAccounts.length === 0) {
        throw new Error('No accounts found in wallet. Please create an account in your Aztec wallet.');
      }

      setAccounts(walletAccounts);
      setConnectionPhase('selecting_account');
      setIsLoadingAccounts(false);
      setPendingConnection(null);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : 'Failed to connect to wallet');
      setConnectionPhase('selecting_wallet');
      setSelectedWallet(null);
      setPendingConnection(null);
      setIsLoadingAccounts(false);
    }
  };

  // Handle user canceling the connection (emojis don't match)
  const handleCancelConnection = () => {
    if (pendingConnection) {
      cancelConnection(pendingConnection);
    }
    setPendingConnection(null);
    setSelectedWallet(null);
    setConnectionPhase('selecting_wallet');
  };

  // Handle completion animation and auto-close
  useEffect(() => {
    // Only show transition animation if there's a pending action (swap or drip)
    const hasPendingAction = isSwapPending || isDripPending;

    if (status === 'completed' && hasPendingAction) {
      // Show completion check immediately
      setShowCompletionCheck(true);

      // Show action icon after 800ms (swap or drip icon based on flow)
      const iconTimer = setTimeout(() => {
        setShowSwapIcon(true);
      }, 800);

      // Close modal 2 seconds after completion (transaction continues in background)
      const closeTimer = setTimeout(() => {
        closeModal();
      }, 2000);

      return () => {
        clearTimeout(iconTimer);
        clearTimeout(closeTimer);
      };
    } else if (status === 'completed' && !hasPendingAction) {
      // No pending action - close modal immediately (wallet connection only)
      closeModal();
    } else {
      // Reset animation state when not showing completion
      setShowCompletionCheck(false);
      setShowSwapIcon(false);
    }
  }, [status, closeModal, isSwapPending, isDripPending]);

  const getStepStatus = (stepIndex: number): 'completed' | 'active' | 'pending' | 'error' => {
    // If there's an error, mark the current step as error
    if (status === 'error' && stepIndex === currentStep) return 'error';
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'active';
    return 'pending';
  };

  const handleAccountSelect = (address: AztecAddress) => {
    onAccountSelect(address);
  };

  const handlePasswordSubmit = async () => {
    if (!password) return;
    // Complete onboarding with password, which will trigger drip execution in SwapContainer
    await completeDripOnboarding(password);
    setPassword('');
  };

  const isLoading = status !== 'not_started' && status !== 'completed' && status !== 'error';
  const progress = (currentStep / totalSteps) * 100;

  // Show wallet selection UI when wallets are discovered
  const showWalletSelection =
    status === 'connecting_wallet' && connectionPhase === 'selecting_wallet' && discoveredWallets.length > 0;
  // Show emoji verification UI when connection is pending
  const showEmojiVerification =
    status === 'connecting_wallet' && connectionPhase === 'verifying' && pendingConnection !== null;
  // Show account selection UI when in selecting_account phase
  const showAccountSelection =
    status === 'connecting_wallet' && connectionPhase === 'selecting_account' && accounts.length > 0;

  // Show completion transition instead of steps when completed
  const showCompletionTransition = status === 'completed';

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown
      sx={{
        backgroundColor: 'background.paper',
        backgroundImage: 'none',
      }}
    >
      <DialogTitle
        sx={{ fontWeight: 600, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        Setting Up Your Wallet
        <IconButton
          onClick={closeModal}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            },
          }}
          aria-label="close"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {/* Show completion transition or normal progress */}
        {showCompletionTransition ? (
          // Completion Transition Animation
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 6,
              gap: 3,
            }}
          >
            {/* Success Checkmark */}
            <Fade in={showCompletionCheck} timeout={500}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CheckCircleIcon
                  sx={{
                    color: 'primary.main',
                    fontSize: 48,
                  }}
                />
                <Typography variant="h6" color="text.primary" sx={{ fontWeight: 600 }}>
                  Wallet Configured!
                </Typography>
              </Box>
            </Fade>

            {/* Action Icon and Message */}
            <Fade in={showSwapIcon} timeout={500}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                {flowType === 'drip' ? (
                  <WaterDropIcon
                    sx={{
                      color: 'secondary.main',
                      fontSize: 40,
                      animation: 'pulse 1s ease-in-out infinite',
                      '@keyframes pulse': {
                        '0%, 100%': {
                          opacity: 1,
                          transform: 'scale(1)',
                        },
                        '50%': {
                          opacity: 0.7,
                          transform: 'scale(1.1)',
                        },
                      },
                    }}
                  />
                ) : (
                  <SwapHorizIcon
                    sx={{
                      color: 'secondary.main',
                      fontSize: 40,
                      animation: 'pulse 1s ease-in-out infinite',
                      '@keyframes pulse': {
                        '0%, 100%': {
                          opacity: 1,
                          transform: 'scale(1)',
                        },
                        '50%': {
                          opacity: 0.7,
                          transform: 'scale(1.1)',
                        },
                      },
                    }}
                  />
                )}
                <Typography variant="body1" color="text.secondary" textAlign="center">
                  {flowType === 'drip' ? 'Claiming GregoCoin...' : 'Executing swap...'}
                </Typography>
              </Box>
            </Fade>
          </Box>
        ) : (
          <>
            {/* Progress Bar */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Step {currentStep} of {totalSteps}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {Math.round(progress)}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(212, 255, 40, 0.1)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: 'primary.main',
                    borderRadius: 4,
                  },
                }}
              />
            </Box>

            {/* Error Display */}
            {(error || accountsError) && (
              <Alert
                severity="error"
                sx={{ mb: 3 }}
                action={
                  needsRediscovery || accountsError?.includes('disconnected') ? (
                    <Button size="small" color="inherit" startIcon={<RefreshIcon />} onClick={handleRediscover}>
                      Reconnect
                    </Button>
                  ) : (
                    <Typography
                      variant="button"
                      sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={resetOnboarding}
                    >
                      Retry
                    </Typography>
                  )
                }
              >
                {error || accountsError}
              </Alert>
            )}

            {/* Steps List - Show only first step during connecting_wallet phase */}
            <List sx={{ py: 0 }}>
              {steps.map((step, index) => {
                const stepNum = index + 1;
                const stepStatus = getStepStatus(stepNum);
                const isActive = stepStatus === 'active';
                const isCompleted = stepStatus === 'completed';
                const isError = stepStatus === 'error';

                // First step always visible
                if (index === 0) {
                  return (
                    <ListItem
                      key={step.label}
                      sx={{
                        py: 2,
                        px: 0,
                        opacity: stepStatus === 'pending' ? 0.5 : 1,
                        transition: 'opacity 0.3s',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {isError ? (
                          <ErrorIcon sx={{ color: 'error.main', fontSize: 28 }} />
                        ) : isCompleted ? (
                          <CheckCircleIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                        ) : isActive && isLoading ? (
                          <CircularProgress size={24} sx={{ color: 'primary.main' }} />
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ color: 'text.disabled', fontSize: 28 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography
                            variant="body1"
                            sx={{
                              fontWeight: isActive || isError ? 600 : 400,
                              color: isError ? 'error.main' : isActive ? 'text.primary' : 'text.secondary',
                            }}
                          >
                            {step.label}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color={isError ? 'error.main' : 'text.secondary'}>
                            {step.description}
                          </Typography>
                        }
                      />
                    </ListItem>
                  );
                }

                // Remaining steps - animate with Collapse
                return (
                  <Collapse key={step.label} in={status !== 'connecting_wallet'} timeout={400}>
                    <ListItem
                      sx={{
                        py: 2,
                        px: 0,
                        opacity: stepStatus === 'pending' ? 0.5 : 1,
                        transition: 'opacity 0.3s',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {isError ? (
                          <ErrorIcon sx={{ color: 'error.main', fontSize: 28 }} />
                        ) : isCompleted ? (
                          <CheckCircleIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                        ) : isActive && isLoading ? (
                          <CircularProgress size={24} sx={{ color: 'primary.main' }} />
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ color: 'text.disabled', fontSize: 28 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography
                            variant="body1"
                            sx={{
                              fontWeight: isActive || isError ? 600 : 400,
                              color: isError ? 'error.main' : isActive ? 'text.primary' : 'text.secondary',
                            }}
                          >
                            {step.label}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color={isError ? 'error.main' : 'text.secondary'}>
                            {step.description}
                          </Typography>
                        }
                      />
                    </ListItem>
                  </Collapse>
                );
              })}
            </List>

            {/* Wallet discovery, verification, and account selection below first step */}
            <Collapse in={status === 'connecting_wallet'} timeout={400}>
              <Box sx={{ pl: 5, pr: 2, pb: 2 }}>
                {isLoadingAccounts && connectionPhase === 'discovering' ? (
                  // Discovering wallets
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      py: 2,
                      gap: 2,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary" textAlign="center">
                      Discovering wallets...
                    </Typography>
                  </Box>
                ) : isLoadingAccounts && connectionPhase === 'connecting' && selectedWallet ? (
                  // Connecting to selected wallet - show wallet info with emoji while loading
                  <>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        p: 2,
                        border: '1px solid',
                        borderColor: 'primary.main',
                        borderRadius: 1,
                        backgroundColor: 'rgba(212, 255, 40, 0.05)',
                        mb: 2,
                      }}
                    >
                      {selectedWallet.icon ? (
                        <Box
                          component="img"
                          src={selectedWallet.icon}
                          alt={selectedWallet.name}
                          sx={{ width: 40, height: 40, borderRadius: 1 }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 40,
                            height: 40,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            borderRadius: 1,
                          }}
                        >
                          <AccountBalanceWalletIcon sx={{ fontSize: 24, color: 'primary.main' }} />
                        </Box>
                      )}
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedWallet.name}
                        </Typography>
                        {getVerificationEmoji(selectedWallet) && (
                          <Typography variant="body2" sx={{ letterSpacing: '0.15em', mt: 0.5 }}>
                            {getVerificationEmoji(selectedWallet)}
                          </Typography>
                        )}
                      </Box>
                      <CircularProgress size={24} sx={{ color: 'primary.main' }} />
                    </Box>

                    <Box
                      sx={{
                        p: 1.5,
                        backgroundColor: 'rgba(33, 150, 243, 0.08)',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'rgba(33, 150, 243, 0.3)',
                        mb: 2,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <SecurityIcon sx={{ fontSize: 18, color: 'info.main' }} />
                        <Typography variant="body2" fontWeight={600} color="info.main">
                          Security Verification
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Verify the emoji code matches what your wallet is showing.
                      </Typography>
                    </Box>

                    <Typography variant="body2" color="text.secondary" textAlign="center">
                      Connecting and retrieving accounts...
                    </Typography>
                    <Typography textAlign="center" sx={{ alignSelf: 'center', mt: 0.5 }}>
                      Please approve the request in your wallet
                    </Typography>
                  </>
                ) : showWalletSelection ? (
                  // Wallet selection step
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        Select your wallet to connect:
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={handleRediscover}
                        title="Refresh wallet list"
                        sx={{ color: 'text.secondary' }}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    <Box sx={{ maxHeight: '240px', overflowY: 'auto' }}>
                      <List sx={{ pt: 0 }}>
                        {discoveredWallets.map(provider => (
                          <ListItem key={provider.id} disablePadding sx={{ mb: 1 }}>
                            <ListItemButton
                              onClick={() => handleWalletSelect(provider)}
                              sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                '&:hover': {
                                  borderColor: 'primary.main',
                                  backgroundColor: 'rgba(212, 255, 40, 0.05)',
                                },
                              }}
                            >
                              <ListItemIcon sx={{ minWidth: 48 }}>
                                {provider.icon ? (
                                  <Box
                                    component="img"
                                    src={provider.icon}
                                    alt={provider.name}
                                    sx={{ width: 32, height: 32, borderRadius: 1 }}
                                  />
                                ) : (
                                  <Box
                                    sx={{
                                      width: 32,
                                      height: 32,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                      borderRadius: 1,
                                    }}
                                  >
                                    <AccountBalanceWalletIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                                  </Box>
                                )}
                              </ListItemIcon>
                              <ListItemText
                                primary={
                                  <Typography variant="body1" fontWeight={600}>
                                    {provider.name}
                                  </Typography>
                                }
                              />
                            </ListItemButton>
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  </>
                ) : showEmojiVerification && selectedWallet && pendingConnection ? (
                  // Emoji verification step - user must confirm emojis match
                  <>
                    <Box
                      sx={{
                        p: 2,
                        border: '1px solid',
                        borderColor: 'primary.main',
                        borderRadius: 1,
                        backgroundColor: 'rgba(212, 255, 40, 0.05)',
                        mb: 2,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        {selectedWallet.icon ? (
                          <Box
                            component="img"
                            src={selectedWallet.icon}
                            alt={selectedWallet.name}
                            sx={{ width: 40, height: 40, borderRadius: 1 }}
                          />
                        ) : (
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: 'rgba(255, 255, 255, 0.1)',
                              borderRadius: 1,
                            }}
                          >
                            <AccountBalanceWalletIcon sx={{ fontSize: 24, color: 'primary.main' }} />
                          </Box>
                        )}
                        <Typography variant="body1" fontWeight={600}>
                          {selectedWallet.name}
                        </Typography>
                      </Box>

                      {/* Verification emoji display */}
                      <Box
                        sx={{
                          p: 2,
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          borderRadius: 1,
                          display: 'flex',
                          justifyContent: 'center',
                        }}
                      >
                        <EmojiGrid emojis={hashToEmoji(pendingConnection.verificationHash)} size="large" />
                      </Box>
                    </Box>

                    <Box
                      sx={{
                        p: 1.5,
                        backgroundColor: 'rgba(33, 150, 243, 0.08)',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'rgba(33, 150, 243, 0.3)',
                        mb: 2,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <SecurityIcon sx={{ fontSize: 18, color: 'info.main' }} />
                        <Typography variant="body2" fontWeight={600} color="info.main">
                          Security Verification
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Verify the emoji code above matches what your wallet is showing. If they don't match, click
                        "Cancel" - someone may be trying to intercept your connection.
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Button variant="outlined" color="inherit" onClick={handleCancelConnection} sx={{ flex: 1 }}>
                        Cancel
                      </Button>
                      <Button variant="contained" color="primary" onClick={handleConfirmConnection} sx={{ flex: 1 }}>
                        Emojis Match
                      </Button>
                    </Box>
                  </>
                ) : showAccountSelection ? (
                  // Account selection (after wallet connected)
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Select an account to continue:
                    </Typography>
                    <Box sx={{ maxHeight: '240px', overflowY: 'auto' }}>
                      <List sx={{ pt: 0 }}>
                        {accounts.map((account, index) => {
                          const alias = account.alias || `Account ${index + 1}`;
                          const addressStr = account.item.toString();

                          return (
                            <ListItem key={addressStr} disablePadding sx={{ mb: 1 }}>
                              <ListItemButton
                                onClick={() => handleAccountSelect(account.item)}
                                sx={{
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  borderRadius: 1,
                                  '&:hover': {
                                    borderColor: 'primary.main',
                                    backgroundColor: 'rgba(212, 255, 40, 0.05)',
                                  },
                                }}
                              >
                                <ListItemText
                                  primary={
                                    <Typography variant="body1" fontWeight={600}>
                                      {alias}
                                    </Typography>
                                  }
                                  secondary={
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        fontFamily: 'monospace',
                                        wordBreak: 'break-all',
                                      }}
                                    >
                                      {addressStr}
                                    </Typography>
                                  }
                                />
                              </ListItemButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    </Box>
                  </>
                ) : null}
              </Box>
            </Collapse>

            {/* Swap flow: show approval message */}
            {status === 'simulating_queries' && flowType === 'swap' && (
              <Box
                sx={{
                  mt: 3,
                  p: 2,
                  backgroundColor: 'rgba(212, 255, 40, 0.05)',
                  border: '1px solid',
                  borderColor: 'rgba(212, 255, 40, 0.2)',
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Please approve the batched queries in your wallet. This is a one-time setup that enables seamless
                  interactions going forward.
                </Typography>
              </Box>
            )}

            {/* Drip flow: show info message during registration */}
            {status === 'registering_drip' && flowType === 'drip' && (
              <Box sx={{ mt: 3 }}>
                <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
                  <Typography variant="body2" sx={{ mb: 1.5 }}>
                    Uh oh! You have no GregoCoin balance!
                  </Typography>
                  <Typography variant="body2" component="div">
                    <strong>Next steps:</strong>
                    <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                      <li>Approve the registration of ProofOfPassword contract in your wallet</li>
                      <li>Provide the password to claim your tokens</li>
                      <li>Authorize the transaction</li>
                    </ol>
                  </Typography>
                </Alert>
              </Box>
            )}

            {/* Drip flow: show password input - only when awaiting password, not during registration */}
            <Collapse in={status === 'awaiting_drip' && flowType === 'drip'} timeout={400}>
              {status === 'awaiting_drip' && flowType === 'drip' && (
                <Box
                  sx={{
                    mt: 3,
                    '@keyframes pulseGlow': {
                      '0%, 100%': {
                        boxShadow: '0 0 0 0 rgba(212, 255, 40, 0.4)',
                      },
                      '50%': {
                        boxShadow: '0 0 20px 5px rgba(212, 255, 40, 0.2)',
                      },
                    },
                    animation: 'pulseGlow 2s ease-in-out 3',
                    borderRadius: 1,
                    p: 2,
                    backgroundColor: 'rgba(212, 255, 40, 0.03)',
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Enter the password to claim your free GregoCoin tokens:
                  </Typography>

                  <TextField
                    fullWidth
                    type="password"
                    label="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoFocus
                    sx={{ mb: 2 }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && password) {
                        handlePasswordSubmit();
                      }
                    }}
                  />

                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handlePasswordSubmit}
                    disabled={!password}
                    startIcon={<WaterDropIcon />}
                  >
                    Continue
                  </Button>
                </Box>
              )}
            </Collapse>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

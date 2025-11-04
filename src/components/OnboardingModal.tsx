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
import { useOnboarding } from '../contexts/OnboardingContext';
import { useWallet } from '../contexts/WalletContext';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Aliased } from '@aztec/aztec.js/wallet';

interface OnboardingModalProps {
  open: boolean;
  onAccountSelect: (address: AztecAddress) => void;
}

export function OnboardingModal({ open, onAccountSelect }: OnboardingModalProps) {
  const { status, error, currentStep, totalSteps, resetOnboarding, flowType, currentFlow, closeModal, completeDripOnboarding, switchedToDrip } =
    useOnboarding();
  const { connectWallet } = useWallet();
  const [accounts, setAccounts] = useState<Aliased<AztecAddress>[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  // Drip flow state
  const [password, setPassword] = useState('');

  // Transition animation state
  const [showCompletionCheck, setShowCompletionCheck] = useState(false);
  const [showSwapIcon, setShowSwapIcon] = useState(false);

  // Get steps from flow config
  const steps = currentFlow?.steps || [];

  // Fetch accounts when modal opens and status is connecting_wallet
  useEffect(() => {
    async function fetchAccounts() {
      if (!open || status !== 'connecting_wallet') return;

      try {
        setIsLoadingAccounts(true);
        setAccountsError(null);
        setAccounts([]);

        // Connect to extension wallet (ChainInfo is constructed from active network inside connectWallet)
        const extensionWallet = await connectWallet();

        // Get accounts from extension wallet
        const walletAccounts = await extensionWallet.getAccounts();

        if (!walletAccounts || walletAccounts.length === 0) {
          throw new Error('No accounts found in wallet. Please create an account in your Aztec wallet.');
        }

        setAccounts(walletAccounts);
        setIsLoadingAccounts(false);
      } catch (err) {
        setAccountsError(err instanceof Error ? err.message : 'Failed to connect to wallet');
        setIsLoadingAccounts(false);
      }
    }

    fetchAccounts();
  }, [open, status, connectWallet]);

  // Handle completion animation and auto-close
  useEffect(() => {
    if (status === 'completed') {
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
    } else {
      // Reset animation state when not showing completion
      setShowCompletionCheck(false);
      setShowSwapIcon(false);
    }
  }, [status, closeModal]);

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

  // Show account selection UI when in connecting_wallet status
  const showAccountSelection = status === 'connecting_wallet' && !isLoadingAccounts && accounts.length > 0;

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
      <DialogTitle sx={{ fontWeight: 600, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  <Typography
                    variant="button"
                    sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={resetOnboarding}
                  >
                    Retry
                  </Typography>
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

            {/* Account selection or loading message below first step */}
            <Collapse in={status === 'connecting_wallet'} timeout={400}>
              <Box sx={{ pl: 7, pr: 0, pb: 2 }}>
                {isLoadingAccounts ? (
                  // Loading state
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
                      Waiting for wallet to respond...
                    </Typography>
                    <Typography variant="caption" color="text.secondary" textAlign="center">
                      Please check your Aztec wallet
                    </Typography>
                  </Box>
                ) : showAccountSelection ? (
                  // Account selection
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
            {status === 'registering_drip' && flowType === 'drip' && switchedToDrip && (
              <Box sx={{ mt: 3 }}>
                <Alert severity="info">
                  <Typography variant="body2">
                    We noticed you don't have any tokens yet. Let's get you started with some free GregoCoin!
                  </Typography>
                </Alert>
              </Box>
            )}

            {/* Drip flow: show password input - only when awaiting password, not during registration */}
            <Collapse in={status === 'awaiting_drip' && flowType === 'drip'} timeout={400}>
              {status === 'awaiting_drip' && flowType === 'drip' && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Enter the password to claim your free GregoCoin tokens:
                  </Typography>

                  <TextField
                    fullWidth
                    type="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    sx={{ mb: 2 }}
                    onKeyDown={(e) => {
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

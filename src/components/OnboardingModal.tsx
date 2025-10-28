import { useEffect } from 'react';
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
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useOnboarding } from '../contexts/OnboardingContext';

interface OnboardingStep {
  label: string;
  description: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    label: 'Connect Wallet',
    description: 'Select your account from the wallet extension',
  },
  {
    label: 'Register Contracts',
    description: 'Setting up token contracts in your wallet',
  },
  {
    label: 'Prepare Queries',
    description: 'Batching read operations for approval',
  },
  {
    label: 'Approve in Wallet',
    description: 'Review and approve queries in your wallet extension',
  },
];

interface OnboardingModalProps {
  open: boolean;
}

export function OnboardingModal({ open }: OnboardingModalProps) {
  const { status, error, currentStep, totalSteps, resetOnboarding } = useOnboarding();

  // Auto-close on completion (parent will handle this)
  useEffect(() => {
    if (status === 'completed') {
      // Modal will be closed by parent component
    }
  }, [status]);

  const getStepStatus = (stepIndex: number): 'completed' | 'active' | 'pending' => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'active';
    return 'pending';
  };

  const isLoading = status !== 'not_started' && status !== 'completed' && status !== 'error';
  const progress = (currentStep / totalSteps) * 100;

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
      <DialogTitle sx={{ fontWeight: 600, pb: 1 }}>Setting Up Your Wallet</DialogTitle>

      <DialogContent>
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
        {error && (
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
            {error}
          </Alert>
        )}

        {/* Steps List */}
        <List sx={{ py: 0 }}>
          {ONBOARDING_STEPS.map((step, index) => {
            const stepNum = index + 1;
            const stepStatus = getStepStatus(stepNum);
            const isActive = stepStatus === 'active';
            const isCompleted = stepStatus === 'completed';

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
                  {isCompleted ? (
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
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'text.primary' : 'text.secondary',
                      }}
                    >
                      {step.label}
                    </Typography>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {step.description}
                    </Typography>
                  }
                />
              </ListItem>
            );
          })}
        </List>

        {/* Additional Instructions */}
        {status === 'connecting_wallet' && (
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
              Please check your Aztec wallet extension to continue
            </Typography>
          </Box>
        )}

        {status === 'simulating_queries' && (
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
      </DialogContent>
    </Dialog>
  );
}

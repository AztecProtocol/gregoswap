import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  LinearProgress,
} from '@mui/material';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useContracts } from '../contexts/ContractsContext';
import { useWallet } from '../contexts/WalletContext';
import { waitForTxWithPhases } from '../utils/txUtils';

interface DripModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type DripPhase = 'sending' | 'mining';

export function DripModal({ open, onClose, onSuccess }: DripModalProps) {
  const [password, setPassword] = useState('');
  const [isDripping, setIsDripping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<DripPhase | null>(null);
  const { drip } = useContracts();
  const { currentAddress } = useWallet();

  const handleClose = () => {
    if (!isDripping) {
      setPassword('');
      setError(null);
      setSuccess(false);
      setCurrentPhase(null);
      onClose();
    }
  };

  const handleDrip = async () => {
    if (!password || !currentAddress) return;

    setError(null);
    setSuccess(false);
    setIsDripping(true);
    setCurrentPhase('sending');

    try {
      const sentTx = await drip(password, currentAddress);
      await waitForTxWithPhases(sentTx, setCurrentPhase);
      setSuccess(true);
      setPassword('');
      // Trigger success callback (e.g., refresh balances)
      if (onSuccess) {
        onSuccess();
      }
      // Auto-close after 2 seconds on success
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err) {
      console.error('Drip error:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to claim GregoCoin. Please check your password and try again.';
      setError(errorMessage);
      setCurrentPhase(null);
    } finally {
      setIsDripping(false);
    }
  };

  const getPhaseLabel = (phase: DripPhase | null) => {
    switch (phase) {
      case 'sending':
        return 'Sending transaction...';
      case 'mining':
        return 'Mining transaction...';
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WaterDropIcon color="primary" />
          <Typography variant="h6">Claim Free GregoCoin</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {success ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              GregoCoin Claimed Successfully!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your tokens will be available shortly.
            </Typography>
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Enter the password to receive free GregoCoin tokens. This is a one-time claim to help you get started.
            </Typography>

            <TextField
              fullWidth
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isDripping}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && password && !isDripping) {
                  handleDrip();
                }
              }}
              autoFocus
              sx={{ mb: 2 }}
            />

            {isDripping && currentPhase && (
              <Box sx={{ mt: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    {getPhaseLabel(currentPhase)}
                  </Typography>
                </Box>
                <LinearProgress />
              </Box>
            )}

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      {!success && (
        <DialogActions>
          <Button onClick={handleClose} disabled={isDripping}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleDrip}
            disabled={!password || isDripping}
            startIcon={isDripping ? <CircularProgress size={16} /> : <WaterDropIcon />}
          >
            {isDripping ? 'Claiming...' : 'Claim Tokens'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

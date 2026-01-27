/**
 * FlowMessages Component
 * Shows context-specific messages during onboarding
 */

import { Box, Typography, Alert } from '@mui/material';
import type { OnboardingStatus } from '../../contexts/onboarding';

interface FlowMessagesProps {
  status: OnboardingStatus;
}

export function FlowMessages({ status }: FlowMessagesProps) {
  // Show approval message during simulation
  if (status === 'simulating') {
    return (
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
          Please approve the batched queries in your wallet. This is a one-time setup that enables seamless interactions
          going forward.
        </Typography>
      </Box>
    );
  }

  // Show info message during drip registration (when balance is 0)
  if (status === 'registering_drip') {
    return (
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
    );
  }

  return null;
}

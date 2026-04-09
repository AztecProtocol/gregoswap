import { Box, Typography, Button, Alert, CircularProgress, Container, Chip } from '@mui/material';
import { useEffect, useState, useCallback } from 'react';
import { extractClaimPayload, type TransferLink } from '../../services/offchainLinkService';
import { ClaimProgress } from './ClaimProgress';
import { ClaimSuccess } from './ClaimSuccess';
import { GregoSwapLogo } from '../GregoSwapLogo';

type ClaimState =
  | { phase: 'decoding' }
  | { phase: 'preview'; data: TransferLink }
  | { phase: 'claiming'; data: TransferLink }
  | { phase: 'verifying'; data: TransferLink }
  | { phase: 'claimed'; data: TransferLink; verified: boolean }
  | { phase: 'error'; message: string };

export function ClaimPage() {
  const [state, setState] = useState<ClaimState>({ phase: 'decoding' });

  // Step 1: Decode the link on mount
  useEffect(() => {
    const data = extractClaimPayload();
    if (!data) {
      setState({ phase: 'error', message: 'Invalid or missing claim link.' });
      return;
    }
    setState({ phase: 'preview', data });
  }, []);

  // Step 2: Execute the claim (will be fully wired in Task 10)
  const doClaim = useCallback(async () => {
    if (state.phase !== 'preview') return;
    const { data } = state;
    setState({ phase: 'claiming', data });

    try {
      // TODO(Task 10): Wire offchain_receive via ContractsContext
      // 1. Ensure wallet is connected/created
      // 2. Register token contract
      // 3. Call claimOffchainTransfer(tokenKey, message)
      // 4. Verify balance

      // For now, simulate the flow progression
      setState({ phase: 'error', message: 'Claim not yet wired — will be connected in Task 10.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claim failed. Please try again.';
      setState({ phase: 'error', message });
    }
  }, [state]);

  const handleGoToSwap = () => {
    window.location.hash = '';
    window.location.reload();
  };

  const tokenName = (t: string) => (t === 'gc' ? 'GregoCoin' : 'GregoCoinPremium');

  return (
    <Container maxWidth="sm" sx={{ py: 4, position: 'relative', zIndex: 1 }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <GregoSwapLogo height={40} />
      </Box>
      <Box sx={{ p: 3, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        {state.phase === 'decoding' && (
          <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>
        )}
        {state.phase === 'preview' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" color="text.primary">Someone sent you</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h4" color="primary" sx={{ fontWeight: 'bold' }}>
                {state.data.amount} {tokenName(state.data.token)}
              </Typography>
              <Chip label="unverified" size="small" variant="outlined" />
            </Box>
            <Button variant="contained" size="large" onClick={doClaim} sx={{ mt: 2, fontWeight: 'bold', px: 6 }}>Claim</Button>
          </Box>
        )}
        {state.phase === 'claiming' && <ClaimProgress phase="claiming" />}
        {state.phase === 'verifying' && <ClaimProgress phase="verifying" />}
        {state.phase === 'claimed' && (
          <ClaimSuccess amount={state.data.amount} tokenName={tokenName(state.data.token)} verified={state.verified} onGoToSwap={handleGoToSwap} />
        )}
        {state.phase === 'error' && <Alert severity="error">{state.message}</Alert>}
      </Box>
    </Container>
  );
}

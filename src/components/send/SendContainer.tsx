import { Box, Alert } from '@mui/material';
import { useSend } from '../../contexts/send';
import { useWallet } from '../../contexts/wallet';
import { useContracts } from '../../contexts/contracts';
import { SendForm } from './SendForm';
import { SendProgress } from './SendProgress';
import { LinkDisplay } from './LinkDisplay';
import { SentHistory } from './SentHistory';
import { useEffect, useState } from 'react';

export function SendContainer() {
  const { phase, error, generatedLink, token, amount, recipientAddress, dismissError, reset } = useSend();
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { fetchBalances } = useContracts();
  const [balances, setBalances] = useState<{ gc: bigint | null; gcp: bigint | null }>({ gc: null, gcp: null });

  useEffect(() => {
    if (currentAddress && !isUsingEmbeddedWallet) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [currentAddress, isUsingEmbeddedWallet, fetchBalances]);

  useEffect(() => {
    if (phase === 'link_ready' && currentAddress) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [phase, currentAddress, fetchBalances]);

  if (isUsingEmbeddedWallet) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Alert severity="info">Connect an external wallet to send tokens.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {phase === 'link_ready' && generatedLink ? (
        <LinkDisplay link={generatedLink} amount={amount} token={token} recipient={recipientAddress} onReset={reset} />
      ) : (
        <>
          <SendForm balance={balances} />
          <SendProgress phase={phase} />
        </>
      )}
      {error && <Alert severity="error" onClose={dismissError} sx={{ mt: 2 }}>{error}</Alert>}
      {currentAddress && <SentHistory senderAddress={currentAddress.toString()} />}
    </Box>
  );
}

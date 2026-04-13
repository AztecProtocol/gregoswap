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
  const { currentAddress } = useWallet();
  const { fetchBalances } = useContracts();
  const [balances, setBalances] = useState<{ gc: bigint | null; gcp: bigint | null }>({ gc: null, gcp: null });

  useEffect(() => {
    if (currentAddress) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [currentAddress, fetchBalances]);

  useEffect(() => {
    if (phase === 'link_ready' && currentAddress) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [phase, currentAddress, fetchBalances]);

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

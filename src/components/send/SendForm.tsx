import { Box, TextField, Typography, ToggleButton, ToggleButtonGroup, Button } from '@mui/material';
import { useSend } from '../../contexts/send';

interface SendFormProps {
  balance: { gc: bigint | null; gcp: bigint | null };
}

export function SendForm({ balance }: SendFormProps) {
  const { token, recipientAddress, amount, phase, setToken, setRecipientAddress, setAmount } = useSend();
  const isSending = phase === 'sending' || phase === 'generating_link';
  const currentBalance = token === 'gc' ? balance.gc : balance.gcp;
  const canSend = !!amount && parseFloat(amount) > 0 && !!recipientAddress && !isSending;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Token
        </Typography>
        <ToggleButtonGroup value={token} exclusive onChange={(_, v) => v && setToken(v)} size="small" fullWidth disabled={isSending}>
          <ToggleButton value="gc">GregoCoin</ToggleButton>
          <ToggleButton value="gcp">GregoCoinPremium</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <TextField label="Recipient Address" placeholder="0x..." value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} fullWidth disabled={isSending} size="small" />
      <Box>
        <TextField label="Amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} fullWidth disabled={isSending} size="small"
          slotProps={{ input: { endAdornment: currentBalance !== null ? <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>Balance: {currentBalance.toString()}</Typography> : null } }} />
      </Box>
      <Button variant="contained" fullWidth disabled={!canSend} onClick={() => {}} sx={{ mt: 1, fontWeight: 'bold' }}>
        {isSending ? 'Sending...' : 'Send & Generate Link'}
      </Button>
    </Box>
  );
}

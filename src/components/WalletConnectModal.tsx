import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Alert,
} from '@mui/material';
import { type AztecAddress, type Aliased, Fr } from '@aztec/aztec.js';
import { useWallet } from '../contexts/WalletContext';

interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
  onAccountSelect: (address: AztecAddress) => void;
}

export function WalletConnectModal({ open, onClose, onAccountSelect }: WalletConnectModalProps) {
  const { connectWallet } = useWallet();
  const [accounts, setAccounts] = useState<Aliased<AztecAddress>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAccounts() {
      if (!open) return;

      try {
        setIsLoading(true);
        setError(null);
        setAccounts([]);

        console.log('Requesting accounts from extension wallet...');

        // Construct ChainInfo from env variables
        const chainInfo = {
          chainId: Fr.fromString(import.meta.env.VITE_CHAIN_ID || '31337'),
          version: Fr.fromString(import.meta.env.VITE_ROLLUP_VERSION || '1681471542'),
        };

        // Connect to extension wallet
        const extensionWallet = await connectWallet(chainInfo);

        // Get accounts from extension wallet
        const walletAccounts = await extensionWallet.getAccounts();

        console.log('Received accounts:', walletAccounts);

        if (!walletAccounts || walletAccounts.length === 0) {
          throw new Error('No accounts found in wallet. Please create an account in your Aztec wallet.');
        }

        setAccounts(walletAccounts);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to fetch accounts:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect to wallet');
        setIsLoading(false);
      }
    }

    fetchAccounts();
  }, [open, connectWallet]);

  const handleAccountSelect = (address: AztecAddress) => {
    onAccountSelect(address);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{
        backgroundColor: 'background.paper',
        backgroundImage: 'none',
      }}
    >
      <DialogTitle sx={{ fontWeight: 600 }}>Connect Wallet</DialogTitle>

      <DialogContent>
        {isLoading && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              gap: 3,
            }}
          >
            <CircularProgress size={48} sx={{ color: 'primary.main' }} />
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Waiting for wallet to respond...
            </Typography>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Please check your Aztec wallet extension
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!isLoading && !error && accounts.length > 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select an account to use:
            </Typography>
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
        )}
      </DialogContent>
    </Dialog>
  );
}

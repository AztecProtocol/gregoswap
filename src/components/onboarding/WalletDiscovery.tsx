/**
 * WalletDiscovery Component
 * Shows discovery animation while searching for wallets
 */

import { Box, Typography } from '@mui/material';

export function WalletDiscovery() {
  return (
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
  );
}

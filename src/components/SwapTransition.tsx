import { useEffect, useState } from 'react';
import { Dialog, DialogContent, Box, Typography, Fade } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

interface SwapTransitionProps {
  open: boolean;
  onComplete: () => void;
}

export function SwapTransition({ open, onComplete }: SwapTransitionProps) {
  const [showCheck, setShowCheck] = useState(false);
  const [showSwap, setShowSwap] = useState(false);

  useEffect(() => {
    if (open) {
      // Show check mark immediately
      setShowCheck(true);

      // Show swap icon after 800ms
      const swapTimer = setTimeout(() => {
        setShowSwap(true);
      }, 800);

      // Complete transition and trigger swap after 2000ms total
      const completeTimer = setTimeout(() => {
        onComplete();
      }, 2000);

      return () => {
        clearTimeout(swapTimer);
        clearTimeout(completeTimer);
      };
    } else {
      // Reset state when closed
      setShowCheck(false);
      setShowSwap(false);
    }
  }, [open, onComplete]);

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          backgroundColor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogContent>
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
          {/* Success Checkmark */}
          <Fade in={showCheck} timeout={500}>
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

          {/* Swap Arrow and Message */}
          <Fade in={showSwap} timeout={500}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
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
              <Typography variant="body1" color="text.secondary" textAlign="center">
                Executing swap...
              </Typography>
            </Box>
          </Fade>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

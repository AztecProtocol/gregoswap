import { Box, Typography, keyframes } from '@mui/material';
import WaterDropIcon from '@mui/icons-material/WaterDrop';

const pulse = keyframes`
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
`;

const shimmer = keyframes`
  0% {
    background-position: -200% center;
  }
  100% {
    background-position: 200% center;
  }
`;

const drip = keyframes`
  0% {
    transform: translateY(-10px);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: translateY(10px);
    opacity: 0;
  }
`;

type DripPhase = 'sending' | 'mining';

interface DripProgressProps {
  phase?: DripPhase;
}

export function DripProgress({ phase = 'sending' }: DripProgressProps) {
  const statusText = phase === 'sending' ? 'Proving & sending transaction' : 'Mining transaction';
  const statusDetail = phase === 'sending' ? 'Claiming your GregoCoin...' : 'Waiting for confirmation...';

  return (
    <Box
      sx={{
        width: '100%',
        mt: 3,
        py: 2,
        px: 3,
        borderRadius: 1,
        background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent, rgba(212, 255, 40, 0.2), transparent)',
          backgroundSize: '200% 100%',
          animation: `${shimmer} 2s linear infinite`,
        },
      }}
    >
      {/* Animated water drop icon */}
      <Box
        sx={{
          position: 'relative',
          width: 32,
          height: 32,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <WaterDropIcon
          sx={{
            fontSize: 32,
            color: '#F2EEE1',
            animation: `${drip} 2s ease-in-out infinite`,
          }}
        />
      </Box>

      {/* Status text */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, zIndex: 1, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography
            variant="body1"
            sx={{
              color: '#F2EEE1',
              fontWeight: 600,
              fontSize: '1.125rem',
            }}
          >
            {statusText}
          </Typography>

          {/* Loading dots */}
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              alignItems: 'center',
            }}
          >
            {[0, 1, 2].map(i => (
              <Box
                key={i}
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#F2EEE1',
                  animation: `${pulse} 1.5s ease-in-out infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Detail text */}
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(242, 238, 225, 0.7)',
            fontSize: '0.875rem',
          }}
        >
          {statusDetail}
        </Typography>
      </Box>
    </Box>
  );
}

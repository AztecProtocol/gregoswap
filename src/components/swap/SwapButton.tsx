import { Button } from '@mui/material';

interface SwapButtonProps {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  contractsLoading: boolean;
  hasAmount: boolean;
}

export function SwapButton({ onClick, disabled, loading, contractsLoading, hasAmount }: SwapButtonProps) {
  const getButtonText = () => {
    if (contractsLoading) {
      return 'Loading contracts...';
    }
    if (!hasAmount) {
      return 'Enter an amount';
    }
    return 'Swap';
  };

  return (
    <Button
      fullWidth
      variant="contained"
      size="large"
      disabled={disabled || loading}
      onClick={onClick}
      sx={{
        mt: 3,
        py: 2,
        fontSize: '1.125rem',
        fontWeight: 600,
        background: 'linear-gradient(135deg, #80336A 0%, #9d4d87 100%)',
        color: '#F2EEE1',
        '&:hover': {
          background: 'linear-gradient(135deg, #9d4d87 0%, #b35fa0 100%)',
          boxShadow: '0px 4px 20px rgba(128, 51, 106, 0.5)',
        },
        '&:disabled': {
          backgroundColor: 'rgba(255, 255, 255, 0.12)',
          color: 'rgba(255, 255, 255, 0.3)',
        },
      }}
    >
      {getButtonText()}
    </Button>
  );
}

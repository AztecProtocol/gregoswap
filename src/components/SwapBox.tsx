import { Box, Typography, TextField, Paper } from '@mui/material';

interface SwapBoxProps {
  label: string;
  tokenName: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SwapBox({ label, tokenName, value, onChange, disabled = false }: SwapBoxProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Only allow numbers and decimal point
    if (newValue === '' || /^\d*\.?\d*$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <Paper
      elevation={2}
      sx={{
        p: 3,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        border: '1px solid',
        borderColor: 'rgba(212, 255, 40, 0.15)',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: '0px 4px 16px rgba(212, 255, 40, 0.25)',
        },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          Balance: 0.00
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          fullWidth
          variant="standard"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          placeholder="0.0"
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontSize: '2rem',
                fontWeight: 600,
                color: 'text.primary',
                '& input': {
                  padding: 0,
                },
                '&.Mui-disabled': {
                  color: 'text.primary',
                  WebkitTextFillColor: 'inherit',
                },
              },
            },
          }}
          sx={{
            flex: 1,
          }}
        />

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            backgroundColor: 'rgba(212, 255, 40, 0.15)',
            border: '1px solid',
            borderColor: 'primary.main',
            color: 'primary.main',
          }}
        >
          <Typography variant="body1" fontWeight={700}>
            {tokenName}
          </Typography>
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ≈ $0.00
      </Typography>
    </Paper>
  );
}

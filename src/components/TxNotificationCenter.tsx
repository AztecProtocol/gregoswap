/**
 * TxNotificationCenter
 * Toast-style notification panel pinned to the bottom-right corner.
 * Shows live transaction progress for embedded wallet operations,
 * including phase status, elapsed time, and a PhaseTimeline breakdown on completion.
 */

import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Collapse,
  Tooltip,
  CircularProgress,
  Chip,
  keyframes,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { txProgress, type TxProgressEvent, type PhaseTiming } from '../tx-progress';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const formatDurationLong = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} milliseconds`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} seconds`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const PHASE_LABELS: Record<string, string> = {
  simulating: 'Simulating',
  proving: 'Proving',
  sending: 'Sending',
  mining: 'Waiting for confirmation',
  complete: 'Complete',
  error: 'Failed',
};

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

// ─── PhaseTimeline (inline, simplified from demo-wallet) ─────────────────────

function PhaseTimelineBar({ phases }: { phases: PhaseTiming[] }) {
  const totalDuration = useMemo(() => phases.reduce((sum, p) => sum + p.duration, 0), [phases]);
  const miningDuration = useMemo(
    () => phases.filter(p => p.name === 'Mining').reduce((sum, p) => sum + p.duration, 0),
    [phases],
  );

  if (phases.length === 0 || totalDuration === 0) return null;

  const preparingDuration = totalDuration - miningDuration;
  const hasMining = miningDuration > 0;

  return (
    <Box sx={{ width: '100%', mt: 1.5 }}>
      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, flexWrap: 'wrap' }}>
        {hasMining ? (
          <>
            <Chip
              label={`Preparing: ${formatDuration(preparingDuration)}`}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem' }}
            />
            <Chip
              label={`Mining: ${formatDuration(miningDuration)}`}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#4caf50', color: 'white' }}
            />
            <Chip
              label={`Total: ${formatDuration(totalDuration)}`}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600 }}
            />
          </>
        ) : (
          <Chip
            label={`Total: ${formatDuration(totalDuration)}`}
            size="small"
            sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600 }}
          />
        )}
      </Box>

      {/* Timeline bar */}
      <Box
        sx={{
          display: 'flex',
          width: '100%',
          height: 14,
          borderRadius: 0.5,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        {phases.map((phase, index) => {
          const percentage = (phase.duration / totalDuration) * 100;
          return (
            <Tooltip
              key={phase.name}
              title={
                <Box sx={{ p: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {phase.name}
                  </Typography>
                  <Typography variant="body2">
                    {formatDurationLong(phase.duration)} ({percentage.toFixed(1)}%)
                  </Typography>
                  {phase.breakdown?.map((item, idx) => (
                    <Typography key={idx} variant="caption" sx={{ display: 'block', pl: 1 }}>
                      {item.label}: {formatDuration(item.duration)}
                    </Typography>
                  ))}
                </Box>
              }
              arrow
              placement="top"
            >
              <Box
                sx={{
                  width: `${percentage}%`,
                  minWidth: percentage > 0 ? 2 : 0,
                  height: '100%',
                  bgcolor: phase.color,
                  borderRight: index < phases.length - 1 ? '1px solid rgba(255,255,255,0.3)' : undefined,
                  transition: 'filter 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': { filter: 'brightness(1.2)' },
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
        {phases.map(phase => (
          <Box key={phase.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: phase.color }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
              {phase.name}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── Single Toast ────────────────────────────────────────────────────────────

interface TxToastProps {
  event: TxProgressEvent;
  onDismiss: () => void;
}

function TxToast({ event, onDismiss }: TxToastProps) {
  const [elapsed, setElapsed] = useState(Date.now() - event.startTime);
  const [expanded, setExpanded] = useState(true);
  const isActive = event.phase !== 'complete' && event.phase !== 'error';

  // Tick elapsed time while active
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setElapsed(Date.now() - event.startTime), 200);
    return () => clearInterval(interval);
  }, [isActive, event.startTime]);

  const isComplete = event.phase === 'complete';
  const isError = event.phase === 'error';

  return (
    <Paper
      elevation={8}
      sx={{
        width: 340,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: isError
          ? 'rgba(211, 47, 47, 0.4)'
          : isComplete
            ? 'rgba(76, 175, 80, 0.4)'
            : 'rgba(212, 255, 40, 0.3)',
        bgcolor: 'background.paper',
        transition: 'border-color 0.3s ease',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          py: 1,
          gap: 1,
          bgcolor: isError
            ? 'rgba(211, 47, 47, 0.08)'
            : isComplete
              ? 'rgba(76, 175, 80, 0.08)'
              : 'rgba(212, 255, 40, 0.05)',
        }}
      >
        {/* Status indicator */}
        {isComplete ? (
          <CheckCircleOutlineIcon sx={{ fontSize: 20, color: '#4caf50' }} />
        ) : isError ? (
          <ErrorOutlineIcon sx={{ fontSize: 20, color: 'error.main' }} />
        ) : (
          <CircularProgress size={16} sx={{ color: 'primary.main' }} />
        )}

        {/* Label and phase */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
            {event.label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {PHASE_LABELS[event.phase] ?? event.phase}
            </Typography>
            {isActive && (
              <Box sx={{ display: 'flex', gap: 0.3, ml: 0.5 }}>
                {[0, 1, 2].map(i => (
                  <Box
                    key={i}
                    sx={{
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      animation: `${pulse} 1.5s ease-in-out infinite`,
                      animationDelay: `${i * 0.2}s`,
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* Elapsed time */}
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>
          {formatDuration(isActive ? elapsed : Date.now() - event.startTime)}
        </Typography>

        {/* Expand/collapse */}
        {isComplete && event.phases.length > 0 && (
          <IconButton size="small" onClick={() => setExpanded(prev => !prev)} sx={{ p: 0.25 }}>
            {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        )}

        {/* Dismiss */}
        <IconButton size="small" onClick={onDismiss} sx={{ p: 0.25, color: 'text.secondary' }}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      {/* Phase timeline breakdown (shown when complete) */}
      <Collapse in={isComplete && expanded && event.phases.length > 0}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <PhaseTimelineBar phases={event.phases} />
        </Box>
      </Collapse>

      {/* Error message */}
      {isError && event.error && (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Typography variant="caption" color="error" sx={{ fontSize: '0.7rem', wordBreak: 'break-word' }}>
            {event.error.length > 200 ? event.error.slice(0, 200) + '...' : event.error}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

// ─── Notification Center Container ───────────────────────────────────────────

export function TxNotificationCenter() {
  const [toasts, setToasts] = useState<Map<string, TxProgressEvent>>(new Map());
  const [collapsed, setCollapsed] = useState(false);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  useEffect(() => {
    return txProgress.subscribe(event => {
      setToasts(prev => {
        const next = new Map(prev);
        next.set(event.txId, event);
        return next;
      });
    });
  }, []);

  const dismiss = (txId: string) => {
    setToasts(prev => {
      const next = new Map(prev);
      next.delete(txId);
      return next;
    });
  };

  const toastList = Array.from(toasts.entries());

  if (toastList.length === 0) return null;

  const activeCount = toastList.filter(([, e]) => e.phase !== 'complete' && e.phase !== 'error').length;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'flex-end',
        gap: 1,
        pointerEvents: 'none',
        '& > *': { pointerEvents: 'auto' },
      }}
    >
      {/* Collapse / expand toggle */}
      <Tooltip title={collapsed ? 'Show notifications' : 'Hide notifications'} placement="left">
        <IconButton
          size="small"
          onClick={() => setCollapsed(prev => !prev)}
          sx={{
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: activeCount > 0 ? 'rgba(212, 255, 40, 0.3)' : 'divider',
            '&:hover': { bgcolor: 'action.hover' },
            px: 1,
            borderRadius: 1,
            gap: 0.5,
          }}
        >
          {collapsed && (
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
              {toastList.length} tx{toastList.length !== 1 ? 's' : ''}
            </Typography>
          )}
          {collapsed ? <UnfoldMoreIcon sx={{ fontSize: 16 }} /> : <UnfoldLessIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>

      {/* Toast list */}
      {!collapsed &&
        toastList.map(([txId, event]) => (
          <TxToast key={txId} event={event} onDismiss={() => dismiss(txId)} />
        ))}
    </Box>
  );
}

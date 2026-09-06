import type { CSSProperties } from 'react'

// Central design tokens for the PlaneSplit dashboard. App.tsx is 100%
// inline-style React with no `className` usage of its own (the tokens in
// index.css belong to an unrelated, unused Vite-template docs page with a
// different purple/light-dark palette) — this module exists so colors,
// fonts, and button variants are each defined exactly once and reused,
// instead of the same hex/rgba literal being copy-pasted at every call
// site. A plain typed module also gives autocomplete/typo safety inline
// `style={{...}}` objects can't get from a `var(--foo)` string.

export const colors = {
  bgDeep: '#020617',
  bgPanel: 'rgba(15, 23, 42, 0.5)',
  bgPanelStrong: 'rgba(15, 23, 42, 0.9)',
  bgPanelHeader: 'rgba(15, 23, 42, 0.65)',
  bgConsole: '#05070d',
  border: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.05)',
  borderStrong: 'rgba(255, 255, 255, 0.1)',

  textPrimary: '#f8fafc',
  textHeading: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textDim: '#475569',
  textConsole: '#cbd5e1',

  accent: '#38bdf8',       // cyan — primary action / CP-live indicator
  success: '#22c55e',      // green — synced / CP path
  warning: '#fbbf24',      // amber — tolerated
  danger: '#ef4444',       // red — alert / fault
  dpSuccess: '#3b82f6',    // blue — DP path when healthy (distinct from CP green)
  userCluster: '#818cf8',  // indigo — attached user hosts
} as const

export const status = {
  synced: colors.success,
  tolerated: colors.warning,
  alert: colors.danger,
} as const

export const statusLabel = {
  synced: 'NETWORK SYNCED',
  tolerated: 'PROPAGATING (TOLERATED)',
  alert: 'DIVERGENCE DETECTED',
} as const

// The four real node kinds this topology's routers fall into (see
// backend/state.py ROUTERS / components/topologyStatus.ts) — used by both
// the 3D scene and the 2D map so a given router looks conceptually
// consistent (same color family) across views, even though the geometry
// differs per view.
export const nodeKindColor = {
  user: colors.userCluster,
  gateway: '#f472b6',   // pink — Firewall: an enforcement boundary, distinct from routing
  router: colors.accent, // cyan — AWS_ALB: routes/load-balances, matches the CP-accent hue
  server: '#0f172a',    // dark slate body color (status ring is layered on top, not this)
} as const

export const nodeKindLabel = {
  user: 'Users',
  gateway: 'Gateway (Firewall)',
  router: 'Router (AWS_ALB)',
  server: 'Server',
} as const

// Distinct from ambient per-flow traffic colors above — a request_event
// marker (see components/map/TopologyMap.tsx, components/scene/Packet.tsx)
// must read as "one specific thing you asked for", not just another packet.
export const requestStatusColor = {
  delivered: '#34d399',
  diverged: '#fbbf24',
  dropped: '#f87171',
} as const

export const requestStatusLabel = {
  delivered: 'DELIVERED',
  diverged: 'DIVERGED',
  dropped: 'DROPPED',
} as const

export const font = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
} as const

export const buttonStyle: CSSProperties = {
  padding: '7px 10px',
  background: 'rgba(56, 189, 248, 0.1)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(56, 189, 248, 0.4)',
  color: colors.accent,
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
  fontSize: '10.5px',
  lineHeight: '1.2',
  transition: 'all 0.2s',
  outline: 'none',
}

export const disabledButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: colors.textDim,
  borderColor: 'rgba(71, 85, 105, 0.3)',
  background: 'rgba(71, 85, 105, 0.08)',
  cursor: 'not-allowed',
}

export const dangerButtonStyle: CSSProperties = {
  ...buttonStyle, color: colors.danger, borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)',
}
export const warningButtonStyle: CSSProperties = {
  ...buttonStyle, color: colors.warning, borderColor: 'rgba(251, 191, 36, 0.4)', background: 'rgba(251, 191, 36, 0.1)',
}
export const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle, color: colors.textSecondary, borderColor: 'rgba(148, 163, 184, 0.35)', background: 'rgba(148, 163, 184, 0.06)',
}

export const numberInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '3px',
  padding: '5px 8px',
  background: 'rgba(2, 6, 23, 0.5)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.3)',
  borderRadius: '6px',
  color: colors.textPrimary,
  fontSize: '11px',
  fontWeight: 'bold',
  outline: 'none',
  boxSizing: 'border-box',
}

export const rangeInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '4px',
  height: '12px',
  accentColor: colors.accent,
  cursor: 'pointer',
}

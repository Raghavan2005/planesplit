import type * as THREE from 'three'

export type FaultType = 'none' | 'delay' | 'drop' | 'corrupt'
export type GlowStatus = 'synced' | 'tolerated' | 'alert' | null

// Shared by ServerRack and RouterNode so a server, gateway, and router all
// speak the same fault/status visual language instead of three copies of
// the same color logic drifting apart over time.
export function applyStatusGlowColor(color: THREE.Color, elapsedSeconds: number, faultType: FaultType, status: GlowStatus) {
  if (faultType === 'delay') {
    // Yellow pulsing for processing struggle
    const pulse = (Math.sin(elapsedSeconds * 10) + 1) / 2
    color.setRGB(1, 0.8 * pulse, 0)
  } else if (faultType === 'drop' || faultType === 'corrupt') {
    // Red flashing for error
    const flash = elapsedSeconds % 0.5 > 0.25 ? 1 : 0.2
    color.setRGB(flash, 0, 0)
  } else if (status === 'alert') {
    const flash = elapsedSeconds % 0.5 > 0.25 ? 1 : 0.2
    color.setRGB(flash, 0, 0)
  } else if (status === 'tolerated') {
    const pulse = (Math.sin(elapsedSeconds * 10) + 1) / 2
    color.setRGB(1, 0.8 * pulse, 0)
  } else {
    // Normal cyan — synced (or no real traffic through this node right now)
    color.setRGB(0.2, 0.74, 0.97) // #38bdf8
  }
}

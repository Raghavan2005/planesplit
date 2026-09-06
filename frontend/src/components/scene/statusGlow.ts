import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

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

// Shared by ServerRack and RouterNode -- previously each duplicated an
// identical useFrame block (same THREE.Color allocation, same
// applyStatusGlowColor call, same idle-vs-active guard, same emissive
// 0.8 multiplier) with only their idle-state color/emissive differing.
// Extracted here so both call one shared hook instead of maintaining two
// copies of the same logic. Behavior is unchanged -- pure dedup.
export function useStatusGlowMaterial(
  faultType: FaultType,
  status: GlowStatus,
  idleColor: string,
  idleEmissive: [number, number, number] = [0, 0, 0],
) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const c = new THREE.Color()
    applyStatusGlowColor(c, clock.getElapsedTime(), faultType, status)

    if (faultType === 'none' && status !== 'alert' && status !== 'tolerated') {
      matRef.current.color.set(idleColor)
      matRef.current.emissive.setRGB(...idleEmissive)
    } else {
      matRef.current.color.copy(c)
      matRef.current.emissive.copy(c).multiplyScalar(0.8)
    }
  })

  return matRef
}

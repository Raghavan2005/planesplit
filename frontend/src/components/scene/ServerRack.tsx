import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import type * as THREE from 'three'
import { applyStatusGlowColor, type FaultType, type GlowStatus } from './statusGlow'

// Color is driven by two independent signals: `faultType` (the fault the
// user actually requested, real per-node now via
// components/topologyStatus.ts::isResponsibleForActiveFault rather than a
// hardcoded "always Users") and `status`, each individual server's OWN
// FlowSnapshot.status. A server that is itself tolerated/alerting flashes
// amber/red even though the fault visual is anchored elsewhere, so each
// rack honestly reflects its own state.
interface ServerRackProps {
  name: string
  position: [number, number, number]
  faultType: FaultType
  status: GlowStatus
}

export function ServerRack({ name, position, faultType, status }: ServerRackProps) {
  const glowRef = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    if (!glowRef.current) return
    applyStatusGlowColor(glowRef.current.color, clock.getElapsedTime(), faultType, status)
  })

  return (
    <group position={position}>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[1.5, 3, 1.5]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.1} />
      </mesh>

      <mesh position={[0, 1.5, 0.76]}>
        <boxGeometry args={[1.2, 2.0, 0.1]} />
        <meshBasicMaterial ref={glowRef} toneMapped={false} />
      </mesh>

      {/* Label — Billboard keeps it facing the camera as OrbitControls'
          autoRotate orbits the scene. Without it, the plain <Text> plane
          only faces its authored direction, so once the camera swings
          around far enough it's looking at the back of the glyphs, which
          renders mirrored/upside-down (not a fresh bug, a rotating camera
          eventually exposes it). */}
      <Billboard position={[0, 3.5, 0]}>
        <Text fontSize={0.6} color="#ffffff" outlineWidth={0.05} outlineColor="#000000">
          {name}
        </Text>
      </Billboard>
    </group>
  )
}

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import type * as THREE from 'three'
import { applyStatusGlowColor, type FaultType, type GlowStatus } from './statusGlow'
import type { NodeKind } from '../topologyStatus'

// Firewall/AWS_ALB previously reused ServerRack's server-box geometry and
// never received a real status (they don't appear in `flows`, which is
// keyed by backend server_id) -- they were visually inert except for a
// hardcoded "highlight Users" fault indicator. This gives them their own
// geometry (a flattened, wide "gateway" body for Firewall; a rounded
// "router" body for AWS_ALB) plus the same real, data-driven status glow
// ServerRack uses, computed from actual traffic via topologyStatus.ts.
interface RouterNodeProps {
  kind: Extract<NodeKind, 'gateway' | 'router'>
  name: string
  position: [number, number, number]
  faultType: FaultType
  status: GlowStatus
}

export function RouterNode({ kind, name, position, faultType, status }: RouterNodeProps) {
  const glowRef = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    if (!glowRef.current) return
    applyStatusGlowColor(glowRef.current.color, clock.getElapsedTime(), faultType, status)
  })

  const bodyColor = kind === 'gateway' ? '#4c1d3d' : '#0c2f3d'

  return (
    <group position={position}>
      {kind === 'gateway' ? (
        // Gateway/Firewall — a wide, flat enforcement-boundary slab.
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[2.2, 2, 0.6]} />
          <meshStandardMaterial color={bodyColor} metalness={0.7} roughness={0.25} />
        </mesh>
      ) : (
        // Router/AWS_ALB — a rounded load-balancing hub.
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 2.4, 24]} />
          <meshStandardMaterial color={bodyColor} metalness={0.7} roughness={0.25} />
        </mesh>
      )}

      <mesh position={[0, 1.2, kind === 'gateway' ? 0.31 : 0.76]}>
        {kind === 'gateway' ? (
          <boxGeometry args={[1.7, 1.5, 0.06]} />
        ) : (
          <torusGeometry args={[0.65, 0.08, 12, 32]} />
        )}
        <meshBasicMaterial ref={glowRef} toneMapped={false} />
      </mesh>

      <Billboard position={[0, 2.6, 0]}>
        <Text fontSize={0.5} color="#ffffff" outlineWidth={0.05} outlineColor="#000000">
          {name}
        </Text>
      </Billboard>
    </group>
  )
}

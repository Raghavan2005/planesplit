import { Billboard, Text } from '@react-three/drei'
import { useStatusGlowMaterial, type FaultType, type GlowStatus } from './statusGlow'

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
  // Idle body is mostly dark with a subtle blue emissive tint (rather than a
  // bright cyan glow at rest); active fault/status states pulse/flash via
  // the shared hook exactly as before.
  const matRef = useStatusGlowMaterial(faultType, status, '#0f172a', [0, 0.05, 0.1])

  return (
    <group position={position}>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[1.5, 3, 1.5]} />
        <meshStandardMaterial ref={matRef} metalness={0.7} roughness={0.2} toneMapped={false} />
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

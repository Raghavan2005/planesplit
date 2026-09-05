import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
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
  const matRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const c = new THREE.Color()
    applyStatusGlowColor(c, clock.getElapsedTime(), faultType, status)
    
    // For normal state (cyan), we want the main body to be mostly dark, but when there's an alert, we want the whole body to pulse/flash that color.
    // Let's just apply it directly. It will make the whole box glow cyan when normal, which might be too bright.
    // Let's dim the normal cyan for the body.
    if (faultType === 'none' && status !== 'alert' && status !== 'tolerated') {
        matRef.current.color.set("#0f172a")
        matRef.current.emissive.setRGB(0, 0.05, 0.1) // subtle blue
    } else {
        matRef.current.color.copy(c)
        matRef.current.emissive.copy(c).multiplyScalar(0.8)
    }
  })

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

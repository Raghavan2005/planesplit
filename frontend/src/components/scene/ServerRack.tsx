import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import type * as THREE from 'three'

// Color is driven by two independent signals: `faultType` (the fault the
// user actually requested, only ever non-'none' at the shared ingress node
// that's the target of the injection — e.g. "Users") and `status`, which is
// each individual backend server's OWN FlowSnapshot.status. Before this,
// every server box downstream of the fault stayed generic cyan regardless
// of whether that specific server's flow was alerting — only the shared
// "Users" indicator ever changed color. Now a server that is itself
// tolerated/alerting flashes amber/red even though the fault visual is
// anchored elsewhere, so each rack honestly reflects its own state.
interface ServerRackProps {
  name: string
  position: [number, number, number]
  faultType: 'none' | 'delay' | 'drop' | 'corrupt'
  status: 'synced' | 'tolerated' | 'alert' | null
}

export function ServerRack({ name, position, faultType, status }: ServerRackProps) {
  const glowRef = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    if (!glowRef.current) return
    if (faultType === 'delay') {
      const pulse = (Math.sin(clock.getElapsedTime() * 10) + 1) / 2
      glowRef.current.color.setRGB(1, 0.8 * pulse, 0)
    } else if (faultType === 'drop' || faultType === 'corrupt') {
      const flash = clock.getElapsedTime() % 0.5 > 0.25 ? 1 : 0.2
      glowRef.current.color.setRGB(flash, 0, 0)
    } else if (status === 'alert') {
      // This specific server's own DP has diverged past the grace
      // window — red flash, same visual language as an injected fault.
      const flash = clock.getElapsedTime() % 0.5 > 0.25 ? 1 : 0.2
      glowRef.current.color.setRGB(flash, 0, 0)
    } else if (status === 'tolerated') {
      const pulse = (Math.sin(clock.getElapsedTime() * 10) + 1) / 2
      glowRef.current.color.setRGB(1, 0.8 * pulse, 0)
    } else {
      // Normal cyan — synced (or a non-flow node like Firewall/AWS_ALB
      // with no fault targeting it).
      glowRef.current.color.setRGB(0.2, 0.74, 0.97) // #38bdf8
    }
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

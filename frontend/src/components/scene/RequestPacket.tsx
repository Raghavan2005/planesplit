import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, Trail } from '@react-three/drei'
import * as THREE from 'three'
import type { NodePositions } from './layout'
import type { ActiveRequestEvent } from '../../hooks/useActiveRequestEvents'
import { requestStatusColor, requestStatusLabel } from '../../theme'

// The 3D counterpart to map/TopologyMap.tsx's RequestMarker -- a discrete,
// one-shot marker for a real, user-triggered `request_event` (backend/
// state.py::SimulationState.send_request), travelling the request's real
// observed path and ending in an explicit outcome label at its real final
// position. Deliberately a separate component from Packet.tsx rather than
// a new prop branch on it: Packet.tsx's perpetual, ever-looping ambient
// animation and this one-shot, wall-clock-timed animation have different
// lifecycles (looping vs. arrive-once-and-stop), and forcing both into one
// component was already source of a "which mode am I in" bug risk not
// worth taking on a component this central to the ambient traffic visual.
interface RequestPacketProps {
  active: ActiveRequestEvent
  nodePositions: NodePositions
}

const TRAVEL_DURATION_MS = 1400

export function RequestPacket({ active, nodePositions }: RequestPacketProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [arrived, setArrived] = useState(false)
  const [restPosition, setRestPosition] = useState<[number, number, number] | null>(null)

  const { event, firstSeenAt } = active
  // Delivered means cp_trace/dp_trace agree already; diverged/dropped
  // travel the real OBSERVED path (dp_trace), including wherever a dropped
  // packet actually stopped, rather than the intended path it never fully
  // completed.
  const path = event.status === 'delivered' ? event.cp_trace : event.dp_trace

  const curve = useMemo(() => {
    const points = path
      .filter((p) => p !== 'DROP' && p !== 'LOOP' && nodePositions[p])
      .map((p) => {
        const v = new THREE.Vector3(...nodePositions[p])
        v.y += 1.5
        return v
      })
    if (points.length < 2) return null
    return new THREE.CatmullRomCurve3(points, false, 'chordal', 0.1)
  }, [path, nodePositions])

  useFrame(() => {
    if (!curve || arrived) return
    const progress = Math.min(1, (performance.now() - firstSeenAt) / TRAVEL_DURATION_MS)
    const pos = curve.getPointAt(progress)
    if (meshRef.current) meshRef.current.position.copy(pos)
    if (progress >= 1) {
      setArrived(true)
      setRestPosition(pos.toArray() as [number, number, number])
    }
  })

  if (!curve) return null
  const color = requestStatusColor[event.status]

  return (
    <>
      {!arrived && (
        <Trail width={4} length={7} color={color} attenuation={(t) => t * t} local={false}>
          <mesh ref={meshRef}>
            <sphereGeometry args={[0.35, 24, 24]} />
            <meshBasicMaterial color={color} toneMapped={false} />
            <mesh scale={0.55}>
              <sphereGeometry args={[0.35, 16, 16]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          </mesh>
        </Trail>
      )}
      {arrived && restPosition && (
        <Billboard position={[restPosition[0], restPosition[1] + 0.9, restPosition[2]]}>
          <Text fontSize={0.45} color={color} outlineWidth={0.05} outlineColor="#000000">
            {requestStatusLabel[event.status]}
          </Text>
        </Billboard>
      )}
    </>
  )
}

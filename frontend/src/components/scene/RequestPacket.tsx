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

  const { curve, singlePoint } = useMemo(() => {
    const points = path
      .filter((p) => p !== 'DROP' && p !== 'LOOP' && nodePositions[p])
      .map((p) => {
        const v = new THREE.Vector3(...nodePositions[p])
        v.y += 1.5
        return v
      })
    // A real single-hop dp_trace (e.g. a packet dropped at its very first
    // hop -- see backend/tests/test_state.py::
    // test_send_request_reports_dropped_when_the_packet_has_no_route_at_all)
    // has nothing to travel along, but it's still a real event that must be
    // shown, not silently hidden. map/TopologyMap.tsx's pointAlongHops
    // already handles this length-1 case explicitly for the 2D view.
    if (points.length === 0) return { curve: null, singlePoint: null as THREE.Vector3 | null }
    if (points.length === 1) return { curve: null, singlePoint: points[0] }
    return { curve: new THREE.CatmullRomCurve3(points, false, 'chordal', 0.1), singlePoint: null }
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

  if (!curve && !singlePoint) return null
  const color = requestStatusColor[event.status]

  if (!curve && singlePoint) {
    // No travel to animate -- render the same outcome-label treatment used
    // once a multi-hop packet arrives, positioned at that one real hop,
    // instead of inventing a separate visual style for this case.
    return (
      <Billboard position={[singlePoint.x, singlePoint.y + 0.9, singlePoint.z]}>
        <Text fontSize={0.45} color={color} outlineWidth={0.05} outlineColor="#000000">
          {requestStatusLabel[event.status]}
        </Text>
      </Billboard>
    )
  }

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

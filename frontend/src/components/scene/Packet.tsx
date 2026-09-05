import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Trail } from '@react-three/drei'
import * as THREE from 'three'
import { Explosion } from './Explosion'
import type { NodePositions } from './layout'

interface PacketProps {
  path: string[]
  isCP: boolean
  nodePositions: NodePositions
}

export function Packet({ path, isCP, nodePositions }: PacketProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  // A ref, not state: this is mutated every frame inside useFrame below and
  // only ever consumed imperatively (to move meshRef's position) — never
  // read during render. Making it React state was the real cause of a
  // visible lag: it forced a full React re-render at 60fps for every single
  // packet, which multiplied by scale (up to 12 packets at 6 servers) added
  // up to hundreds of re-renders per second.
  const progressRef = useRef(0)
  const [exploded, setExploded] = useState(false)
  const [endPos, setEndPos] = useState<[number, number, number]>([0, 0, 0])

  const curve = useMemo(() => {
    const points = path
      .filter((p) => p !== 'DROP' && p !== 'LOOP' && nodePositions[p])
      .map((p) => {
        const v = new THREE.Vector3(...nodePositions[p])
        v.y += 1.5 // raise to middle of rack
        return v
      })

    // If it dropped, add a point slightly past the last node downwards
    if (path.includes('DROP') || path.includes('LOOP')) {
      const lastValid = points[points.length - 1]
      if (lastValid) {
        points.push(new THREE.Vector3(lastValid.x, -2, lastValid.z + 1))
      }
    }

    if (points.length < 2) return null
    return new THREE.CatmullRomCurve3(points, false, 'chordal', 0.1) // tight corners
  }, [path, nodePositions])

  // Reset when the path actually changes — compared by content (`pathKey`),
  // not array reference. The backend's tick loop broadcasts a fresh
  // snapshot (and therefore a brand-new `path` array) roughly every 300ms
  // whether or not the route changed, so depending on `[path]` directly
  // reset this animation back to the start on every single broadcast —
  // the packet never got to finish a lap, it just stuttered near the
  // beginning. This is very likely what read as "the dots are lagging".
  const pathKey = path.join(',')
  useEffect(() => {
    progressRef.current = 0
    setExploded(false)
  }, [pathKey])

  useFrame((_state, delta) => {
    if (!curve || exploded || !meshRef.current) return

    const newProgress = progressRef.current + delta * 0.8

    if (newProgress >= 1) {
      setExploded(true)
      setEndPos(meshRef.current.position.toArray() as [number, number, number])
      setTimeout(() => {
        progressRef.current = 0
        setExploded(false)
      }, 1500)
      return
    }

    progressRef.current = newProgress
    const pos = curve.getPointAt(newProgress)
    meshRef.current.position.copy(pos)

    // Offset slightly so CP and DP don't z-fight
    if (isCP) {
      meshRef.current.position.y += 0.3
    } else {
      meshRef.current.position.y -= 0.3
    }
  })

  if (!curve) return null

  const isFailure = !isCP && (path.includes('DROP') || path.includes('LOOP'))
  const color = isCP ? '#22c55e' : isFailure ? '#ef4444' : '#3b82f6' // Green CP, Blue DP Success, Red DP Fail

  if (exploded) {
    if (isFailure) {
      return <Explosion position={endPos} color="#ef4444" />
    }
    return null // On success, the packet is just smoothly absorbed
  }

  return (
    <Trail width={2.5} length={5} color={color} attenuation={(t) => t * t} local={false}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} />
        {/* Inner bright core */}
        <mesh scale={0.6}>
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      </mesh>
    </Trail>
  )
}

import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { NodePositions } from './layout'

interface PathLineProps {
  path: string[]
  color: string
  offset: number
  nodePositions: NodePositions
}

export function PathLine({ path, color, offset, nodePositions }: PathLineProps) {
  const points = path
    .filter((p) => p !== 'DROP' && p !== 'LOOP' && nodePositions[p])
    .map((p) => {
      const v = new THREE.Vector3(...nodePositions[p])
      v.y += 1.5 + offset
      return v
    })

  if (points.length < 2) return null
  return (
    <Line
      points={points}
      color={color}
      lineWidth={3}
      dashed={true}
      dashScale={20}
      dashSize={1}
      dashOffset={0}
      toneMapped={false}
    />
  )
}

import { Line } from '@react-three/drei'
import type { LinkPair, NodePositions } from './layout'

interface BaseInfrastructureProps {
  nodePositions: NodePositions
  links: LinkPair[]
}

export function BaseInfrastructure({ nodePositions, links }: BaseInfrastructureProps) {
  return (
    <group>
      {links.map((link, i) => {
        const p1 = nodePositions[link[0]]
        const p2 = nodePositions[link[1]]
        if (!p1 || !p2) return null
        return (
          <Line
            key={i}
            points={[
              [p1[0], 0.2, p1[2]],
              [p2[0], 0.2, p2[2]],
            ]}
            color="#1e293b"
            lineWidth={2}
            toneMapped={false}
          />
        )
      })}
    </group>
  )
}

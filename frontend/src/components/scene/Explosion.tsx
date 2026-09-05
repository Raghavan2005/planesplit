import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

interface ExplosionProps {
  position: [number, number, number]
  color: string
}

export function Explosion({ position, color }: ExplosionProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [age, setAge] = useState(0)

  useFrame((_, delta) => {
    if (age > 1) return
    setAge((a) => a + delta * 2)
    if (groupRef.current) {
      groupRef.current.scale.setScalar(1 + age * 2)
      groupRef.current.children.forEach((c) => {
        const mesh = c as THREE.Mesh
        const material = mesh.material as THREE.MeshBasicMaterial
        material.opacity = 1 - age
      })
    }
  })

  if (age > 1) return null

  return (
    <group ref={groupRef} position={position}>
      {[...Array(6)].map((_, i) => (
        <mesh key={i} position={[Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshBasicMaterial color={color} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// Purely a population indicator near the "Users" node — honestly scoped:
// routing in this simulation is destination-based (planesplit's Router.
// forward() matches on packet.dst only), so every attached user genuinely
// follows the identical real computed path for whichever server/flow it's
// grouped under. These dots represent "this many real hosts are attached
// here" (backend/state.py really does attach num_users distinct host IPs),
// not an independent per-user route simulation that isn't actually running.
interface UserClusterProps {
  position: [number, number, number]
  count: number
}

export function UserCluster({ position, count }: UserClusterProps) {
  const shown = Math.min(count, 12)
  return (
    <group position={position}>
      {[...Array(shown)].map((_, i) => {
        const angle = (i / shown) * Math.PI * 2
        const r = 1.4
        return (
          <mesh key={i} position={[Math.cos(angle) * r, 0.3 + (i % 3) * 0.25, Math.sin(angle) * r]}>
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshBasicMaterial color="#818cf8" toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

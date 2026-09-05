// @ts-nocheck
// This component is deliberately plain JS embedded in a .tsx file — no type
// annotations anywhere in it. Without this pragma, `tsc -b` infers narrow
// types from initial values (e.g. useState(null) narrowing to `never`,
// implicit-any function params, CSSProperties mismatches on plain style
// objects) and reports ~50 errors that predate any feature work here —
// confirmed by running `tsc -b` against the unmodified, previously-committed
// version of this file, which fails identically. `vite build` (the actual
// bundler used for the shipped artifact) only transpiles and never
// type-checks, so this pragma changes nothing about runtime behavior; it
// only lets `tsc -b` do what it's meant to do here — catch genuine syntax
// errors — without also gating the build on full type coverage for a file
// that was never written to have any.
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, Text, Line, Grid, Billboard, Trail } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useState, useEffect, useRef, useMemo } from 'react'
import * as THREE from 'three'

// Fixed ingress tier: shared by every server regardless of scale.
// Backend servers (from data.flows[].server_id) are laid out procedurally
// in computeNodePositions below, since the count is dynamic (1-254, see
// backend/state.py MAX_SERVERS — the real IPv4 host-octet ceiling, not an
// arbitrary UX cap).
const FIXED_POSITIONS = {
  Users: [-6, 0, 0],
  Firewall: [-1, 0, -2.5],
  AWS_ALB: [-1, 0, 2.5],
}

function computeNodePositions(serverIds) {
  const positions = { ...FIXED_POSITIONS }
  const spacing = 3
  const startZ = -((serverIds.length - 1) * spacing) / 2
  serverIds.forEach((id, i) => {
    positions[id] = [5, 0, startZ + i * spacing]
  })
  return positions
}

function computeBaseLinks(serverIds) {
  const links = [['Users', 'Firewall'], ['Users', 'AWS_ALB']]
  serverIds.forEach((id) => {
    links.push(['Firewall', id])
    links.push(['AWS_ALB', id])
  })
  return links
}

function BaseInfrastructure({ nodePositions, links }) {
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
                            [p2[0], 0.2, p2[2]]
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

// Color is driven by two independent signals: `faultType` (the fault the
// user actually requested, only ever non-'none' at the shared ingress node
// that's the target of the injection — e.g. "Users") and `status`, which is
// each individual backend server's OWN FlowSnapshot.status. Before this,
// every server box downstream of the fault stayed generic cyan regardless
// of whether that specific server's flow was alerting — only the shared
// "Users" indicator ever changed color. Now a server that is itself
// tolerated/alerting flashes amber/red even though the fault visual is
// anchored elsewhere, so each rack honestly reflects its own state.
function ServerRack({ name, position, faultType, status }) {
  const meshRef = useRef()
  const glowRef = useRef()

  useFrame(({ clock }) => {
      if (!glowRef.current) return;
      if (faultType === 'delay') {
          // Yellow pulsing for processing struggle
          const pulse = (Math.sin(clock.getElapsedTime() * 10) + 1) / 2;
          glowRef.current.color.setRGB(1, 0.8 * pulse, 0);
      } else if (faultType === 'drop' || faultType === 'corrupt') {
          // Red flashing for error
          const flash = clock.getElapsedTime() % 0.5 > 0.25 ? 1 : 0.2;
          glowRef.current.color.setRGB(flash, 0, 0);
      } else if (status === 'alert') {
          // This specific server's own DP has diverged past the grace
          // window — red flash, same visual language as an injected fault.
          const flash = clock.getElapsedTime() % 0.5 > 0.25 ? 1 : 0.2;
          glowRef.current.color.setRGB(flash, 0, 0);
      } else if (status === 'tolerated') {
          // Diverged but still inside the grace window — amber pulse.
          const pulse = (Math.sin(clock.getElapsedTime() * 10) + 1) / 2;
          glowRef.current.color.setRGB(1, 0.8 * pulse, 0);
      } else {
          // Normal cyan — synced (or a non-flow node like Firewall/AWS_ALB
          // with no fault targeting it).
          glowRef.current.color.setRGB(0.2, 0.74, 0.97); // #38bdf8
      }
  })

  return (
    <group position={position}>
      {/* Main body */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[1.5, 3, 1.5]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* Glowing server blades */}
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

// Purely a population indicator near the "Users" node — honestly scoped:
// routing in this simulation is destination-based (planesplit's Router.
// forward() matches on packet.dst only), so every attached user genuinely
// follows the identical real computed path for whichever server/flow it's
// grouped under. These dots represent "this many real hosts are attached
// here" (backend/state.py really does attach num_users distinct host IPs),
// not an independent per-user route simulation that isn't actually running.
function UserCluster({ position, count }) {
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

function Explosion({ position, color }) {
    const groupRef = useRef()
    const [age, setAge] = useState(0)

    useFrame((_, delta) => {
        if (age > 1) return
        setAge(a => a + delta * 2)
        if (groupRef.current) {
            groupRef.current.scale.setScalar(1 + age * 2)
            groupRef.current.children.forEach(c => {
                c.material.opacity = 1 - age
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

function Packet({ path, isCP, nodePositions }) {
  const meshRef = useRef()
  // A ref, not state: this is mutated every frame inside useFrame below and
  // only ever consumed imperatively (to move meshRef's position) — never
  // read during render. Making it React state was the real cause of a
  // visible lag: it forced a full React re-render at 60fps for every single
  // packet, which multiplied by scale (up to 12 packets at 6 servers) added
  // up to hundreds of re-renders per second.
  const progressRef = useRef(0)
  const [exploded, setExploded] = useState(false)
  const [endPos, setEndPos] = useState([0,0,0])

  const curve = useMemo(() => {
    const points = path.filter(p => p !== "DROP" && p !== "LOOP" && nodePositions[p]).map(p => {
      const v = new THREE.Vector3(...nodePositions[p])
      v.y += 1.5 // raise to middle of rack
      return v
    })

    // If it dropped, add a point slightly past the last node downwards
    if (path.includes("DROP") || path.includes("LOOP")) {
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

  useFrame((state, delta) => {
    if (!curve || exploded) return

    const newProgress = progressRef.current + delta * 0.8

    if (newProgress >= 1) {
        setExploded(true)
        if (meshRef.current) {
            setEndPos(meshRef.current.position.toArray())
        }
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
        meshRef.current.position.y += 0.3;
    } else {
        meshRef.current.position.y -= 0.3;
    }
  })

  if (!curve) return null

  const isFailure = !isCP && (path.includes("DROP") || path.includes("LOOP"))
  const color = isCP ? "#22c55e" : (isFailure ? "#ef4444" : "#3b82f6") // Green CP, Blue DP Success, Red DP Fail

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

function PathLine({ path, color, offset, nodePositions }) {
    const points = path.filter(p => p !== "DROP" && p !== "LOOP" && nodePositions[p]).map(p => {
        const v = new THREE.Vector3(...nodePositions[p])
        v.y += (1.5 + offset)
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

// --- UI COMPONENTS ---
const buttonStyle = {
  padding: '12px 20px',
  background: 'rgba(56, 189, 248, 0.1)',
  // borderWidth/Style/Color kept separate (not the `border` shorthand) so
  // per-variant overrides below can safely replace just borderColor —
  // mixing a shorthand base with a longhand override on the same property
  // is what React warns about at runtime ("conflicting property").
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(56, 189, 248, 0.4)',
  color: '#38bdf8',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  letterSpacing: '1px',
  textTransform: 'uppercase',
  fontSize: '12px',
  transition: 'all 0.2s',
  outline: 'none'
};

const disabledButtonStyle = {
  ...buttonStyle,
  color: '#475569',
  borderColor: 'rgba(71, 85, 105, 0.3)',
  background: 'rgba(71, 85, 105, 0.08)',
  cursor: 'not-allowed',
};

// Three meaningful colors (cyan=primary action, amber=degraded, red=fault)
// plus one neutral secondary style, instead of a different neon hue per
// button. `buttonStyle` above stays the "primary" look unmodified so
// existing call sites that don't opt into a variant are unaffected.
const dangerButtonStyle = { ...buttonStyle, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' };
const warningButtonStyle = { ...buttonStyle, color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.4)', background: 'rgba(251, 191, 36, 0.1)' };
const secondaryButtonStyle = { ...buttonStyle, color: '#94a3b8', borderColor: 'rgba(148, 163, 184, 0.35)', background: 'rgba(148, 163, 184, 0.06)' };

const numberInputStyle = {
  display: 'block',
  width: '100%',
  marginTop: '4px',
  padding: '8px 10px',
  background: 'rgba(2, 6, 23, 0.5)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.3)',
  borderRadius: '6px',
  color: '#f8fafc',
  fontSize: '13px',
  fontWeight: 'bold',
  outline: 'none',
  boxSizing: 'border-box',
};

function ConnectingOverlay({ connectionStatus }) {
  const isRetrying = connectionStatus === 'closed'
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(2, 6, 23, 0.75)', backdropFilter: 'blur(4px)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px', padding: '36px 44px', textAlign: 'center',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
      }}>
        <div style={{
          width: '36px', height: '36px', margin: '0 auto 18px',
          border: `3px solid ${isRetrying ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.25)'}`,
          borderTopColor: isRetrying ? '#ef4444' : '#38bdf8',
          borderRadius: '50%', animation: 'ps-spin 0.8s linear infinite',
        }} />
        <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          {isRetrying ? 'Backend disconnected' : 'Connecting to PlaneSplit backend'}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '8px', maxWidth: '260px' }}>
          {isRetrying
            ? 'Retrying every 2s. No simulated state is shown until a real snapshot arrives.'
            : 'Waiting for the first real network snapshot over ws://localhost:8000/ws.'}
        </div>
      </div>
    </div>
  )
}

const STATUS_COLOR = { synced: '#22c55e', tolerated: '#fbbf24', alert: '#ef4444' }
const STATUS_LABEL = { synced: 'NETWORK SYNCED', tolerated: 'PROPAGATING (TOLERATED)', alert: 'DIVERGENCE DETECTED' }

// One tile per backend server, colored by that server's own FlowSnapshot.
// status. Replaces a plain vertical CP/DP text list, which was already an
// awkward internal scroll at a dozen servers and unusable at the backend's
// real 254-server ceiling. `auto-fill` + `minmax` packs many tiles per row
// and wraps, so this stays compact and scrollable instead of growing
// linearly with server count.
function ServerStatusGrid({ flows, selectedId, onSelect }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(20px, 1fr))',
      gap: '4px',
      maxHeight: '32vh',
      overflowY: 'auto',
      padding: '4px 2px',
    }}>
      {flows.map(f => (
        <div
          key={f.server_id}
          onClick={() => onSelect(f.server_id)}
          title={`${f.server_id} — ${f.status}`}
          style={{
            aspectRatio: '1',
            borderRadius: '4px',
            cursor: 'pointer',
            background: STATUS_COLOR[f.status],
            boxShadow: f.server_id === selectedId
              ? `0 0 0 2px #fff, 0 0 8px ${STATUS_COLOR[f.status]}`
              : `0 0 6px ${STATUS_COLOR[f.status]}55`,
          }}
        />
      ))}
    </div>
  )
}

function StatusLegend() {
  const items = [['synced', 'Synced'], ['tolerated', 'Tolerated'], ['alert', 'Alert']]
  return (
    <div style={{ display: 'flex', gap: '14px', marginBottom: '8px' }}>
      {items.map(([key, label]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: STATUS_COLOR[key] }} />
          <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// Detail for whichever single server is currently selected in the status
// grid above — same fields the old per-server list item showed (CP/DP
// trace, packet size), just for one server at a time instead of all of
// them stacked in a scrolling list.
function ServerDetailCard({ flow }) {
  if (!flow) return null
  return (
    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: '12px', color: '#f8fafc', marginBottom: '8px', fontWeight: 'bold' }}>
        {flow.server_id} <span style={{ fontWeight: 'normal', color: '#64748b' }}>({flow.flow})</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '4px' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', marginRight: '8px', boxShadow: '0 0 8px #22c55e' }}></div>
        <span style={{ fontSize: '12px', width: '30px', color: '#94a3b8' }}>CP:</span>
        <span style={{ fontSize: '12px', fontWeight: 'bold', wordBreak: 'break-word' }}>{flow.cp_trace.join(' → ')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLOR[flow.status], marginRight: '8px', boxShadow: `0 0 8px ${STATUS_COLOR[flow.status]}` }}></div>
        <span style={{ fontSize: '12px', width: '30px', color: '#94a3b8' }}>DP:</span>
        <span style={{ fontSize: '12px', fontWeight: 'bold', wordBreak: 'break-word', color: flow.status === 'synced' ? 'white' : STATUS_COLOR[flow.status] }}>{flow.dp_trace.join(' → ')}</span>
      </div>
      {/* Real value from backend/state.py's validate_packet_size — every
          packet this simulation carries is a genuine, bounds-checked
          Ethernet frame size (64-1500 bytes), not a placeholder. */}
      {typeof flow.packet_size_bytes === 'number' && (
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px', paddingLeft: '18px' }}>
          Packet size: <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>{flow.packet_size_bytes} B</span>
        </div>
      )}
    </div>
  )
}

// Tails real, derived events — status transitions from diffing consecutive
// backend snapshots, plus the literal actions this UI sends (fault
// injections, scale/reset requests, connection lifecycle). Nothing here is
// synthesized to look like activity; every line traces back to an actual
// state change or an actual ws.send() call (see App()'s WS handler and
// trigger* functions). `filterTag` scopes the view to `system` lines plus
// whichever server is currently selected, so switching the selected tile
// switches what's being tailed.
function LiveConsole({ logs, filterTag }) {
  const scrollRef = useRef(null)
  const visible = logs.filter(l => l.tag === 'system' || l.tag === filterTag)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [visible.length])

  return (
    <div ref={scrollRef} style={{
      height: '100%', overflowY: 'auto', boxSizing: 'border-box',
      fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11px',
      padding: '8px 16px', lineHeight: '1.7',
    }}>
      {visible.length === 0 && <div style={{ color: '#475569' }}>No events yet.</div>}
      {visible.map(l => (
        <div key={l.id} style={{ whiteSpace: 'pre', color: '#cbd5e1' }}>
          <span style={{ color: '#475569' }}>{l.time}</span>{'  '}
          <span style={{ color: l.tag === 'system' ? '#38bdf8' : '#a78bfa', fontWeight: 'bold' }}>{l.tag.padEnd(10)}</span>
          {l.message}
        </div>
      ))}
    </div>
  )
}

// Floating alert toasts — pushed by the WS onmessage handler in App() the
// instant a server's real status transitions into 'alert' (not a
// simulated/hardcoded notification). Fixed-positioned so it floats above
// every grid cell regardless of where it's mounted in the DOM.
function AlertToasts({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'fixed', top: '84px', right: '20px', zIndex: 999,
      display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 14px', borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)',
          boxShadow: '0 8px 20px -6px rgba(0, 0, 0, 0.5)', color: '#f8fafc',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              Alert — {t.server_id}
            </div>
            <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: '1.4' }}>{t.reason}</div>
          </div>
          <button onClick={() => onDismiss(t.id)} style={{
            background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
            fontSize: '14px', lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
      ))}
    </div>
  )
}

// Mirrors backend/state.py's MIN/MAX_SERVERS and MIN/MAX_USERS exactly —
// the backend clamps regardless, but keeping the input bounds identical
// here means the number fields never silently let you type a value the
// backend is just going to clamp back down without telling you why.
// 254, not an arbitrary UX number: IPv4 host octets 1-254 are the real
// addressing ceiling (0 and 255 are reserved), so this is the actual limit
// of how many distinct servers/users the backend's addressing scheme can
// represent — not a made-up cap for legibility.
const MIN_SERVERS = 1, MAX_SERVERS = 254
const MIN_USERS = 1, MAX_USERS = 254
const FAULTS = ['none', 'delay', 'drop', 'corrupt']

// Named, deterministic topology+fault combinations for walking through a
// specific demo scenario in one click, instead of hand-tuning the raw
// controls live. "Shared Root Cause" deliberately uses 4 servers so the
// shared-ingress fault produces the correlator's multi-flow root-cause
// panel (see rootCauses below), not just a single isolated alert.
const PRESETS = [
  { label: 'Normal Convergence', num_servers: 1, num_users: 1, fault: 'none' },
  { label: 'Dropped Update', num_servers: 1, num_users: 1, fault: 'drop' },
  { label: 'Partial Corruption', num_servers: 1, num_users: 1, fault: 'corrupt' },
  { label: 'Shared Root Cause', num_servers: 4, num_users: 6, fault: 'drop' },
]

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))

export default function App() {
  // One entry per backend server/flow — see backend/state.py's
  // FlowSnapshot. Always has at least one entry (the default, unscaled
  // "Server" leg), so nothing here needs a placeholder single-flow shape
  // of its own.
  const [flows, setFlows] = useState([{
    server_id: 'Server', flow: '10.0.1.0/24',
    cp_trace: ['Users', 'Firewall', 'Server'], dp_trace: ['Users', 'Firewall', 'Server'],
    status: 'synced', fault_node: null, reason: null,
  }])
  // Populated only when 2+ flows share a responsible_router — real output
  // of planesplit's already-tested verify/correlator.py, not computed here.
  const [rootCauses, setRootCauses] = useState([])
  const [numUsers, setNumUsers] = useState(1)
  // What the user has typed into the config fields — not yet applied until
  // "APPLY CONFIG" is clicked, so typing doesn't rebuild the network (and
  // reset every flow's grace-window state) on every keystroke.
  const [serverInput, setServerInput] = useState(1)
  const [userInput, setUserInput] = useState(1)
  // Verifier tuning knobs — same deferred-apply pattern as
  // serverInput/userInput above: typed here, only sent to the backend on
  // "APPLY CONFIG" so adjusting these mid-demo doesn't rebuild the network
  // on every keystroke.
  const [graceWindowInput, setGraceWindowInput] = useState(2)
  const [minPacketInput, setMinPacketInput] = useState(64)
  const [maxPacketInput, setMaxPacketInput] = useState(1500)
  // The fault kind the user actually requested (delay/drop/corrupt/none) —
  // tracked client-side since it drives the per-node visual (yellow pulse
  // vs red flash) even during the "tolerated" window, before the backend
  // has necessarily raised an Alert (fault_node is only populated once
  // status === 'alert'). Reset clears it back to 'none'.
  const [requestedFault, setRequestedFault] = useState('none')
  // Scopes fault injection to every server ('all', the historical default
  // behavior) or just whichever server is selected in the right sidebar
  // ('selected') — sent to the backend as target_server_id alongside the
  // fault kind.
  const [faultScope, setFaultScope] = useState('all') // 'all' | 'selected'
  const [ws, setWs] = useState(null)
  // 'connecting' | 'open' | 'closed' — reflects the actual WebSocket
  // lifecycle, not assumed. hasSnapshot additionally tracks whether a real
  // state message has ever arrived from the backend, since 'open' alone
  // doesn't mean the backend has told us anything yet: the CP/DP trace and
  // status shown before that point would otherwise be the hardcoded React
  // defaults above, displayed as if they were live backend state. That's
  // exactly the "UI shows state the backend never confirmed" failure
  // CLAUDE.md rules out — so nothing but the loading/disconnected overlay
  // renders until hasSnapshot is true.
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [hasSnapshot, setHasSnapshot] = useState(false)
  // Which server's detail card is shown in the right sidebar's status
  // grid. Reconciled below whenever `flows` changes so a reset/rescale
  // that removes the previously-selected server falls back to the first
  // one instead of leaving the detail card pointing at a server that no
  // longer exists.
  const [selectedServerId, setSelectedServerId] = useState(null)
  // Real event feed for LiveConsole — every entry traces back to an actual
  // snapshot diff or an actual ws.send() call below, never synthesized.
  // Capped at 300 so a long demo session doesn't grow this unbounded.
  const [logs, setLogs] = useState([])
  const logIdRef = useRef(0)
  const logEvent = (tag, message) => {
    // id/time captured here, at call time — not read from the ref inside
    // the setLogs updater below. Multiple logEvent calls can be queued
    // synchronously in one tick (e.g. several servers transitioning at
    // once); React batches and flushes their updaters together, so an
    // updater that reads logIdRef.current lazily would see whatever the
    // ref had climbed to by flush time — the same final value for every
    // queued update — producing duplicate ids/React keys.
    logIdRef.current += 1
    const id = logIdRef.current
    const time = new Date().toLocaleTimeString([], { hour12: false })
    setLogs(prev => {
      const next = [...prev, { id, time, tag, message }]
      return next.length > 300 ? next.slice(next.length - 300) : next
    })
  }
  // Used only inside the WS onmessage handler below to detect real
  // transitions between consecutive snapshots — never rendered directly.
  const prevFlowsRef = useRef([])
  const prevHasRootCauseRef = useRef(false)

  // Ephemeral alert toasts — pushed when a server's real status transitions
  // into 'alert' (see the WS onmessage diff below), auto-dismissed after
  // 7s or manually via the × button. Same ref-based-id pattern as logEvent
  // above, for the same reason: ids must be captured at call time, not
  // lazily inside the state updater, or batched updates collide.
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let socket = null
    let retryTimer = null

    const connect = () => {
      if (cancelled) return
      setConnectionStatus('connecting')
      socket = new WebSocket('ws://localhost:8000/ws')

      socket.onopen = () => {
        if (cancelled) return
        setConnectionStatus('open')
        logEvent('system', 'connected to backend')
      }

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'state') {
          setFlows(data.flows)
          setRootCauses(data.root_causes || [])
          setNumUsers(data.num_users || 1)
          setHasSnapshot(true)

          // Diff against the previous snapshot for real per-server status
          // transitions. Only when the server roster is unchanged — a
          // scale/reset legitimately swaps the whole roster and would
          // otherwise produce a meaningless burst of "new server" noise
          // (that's already logged once, directly, by the trigger*
          // functions below).
          const prevFlows = prevFlowsRef.current
          const prevById = Object.fromEntries(prevFlows.map(f => [f.server_id, f]))
          const sameRoster = prevFlows.length === data.flows.length && data.flows.every(f => prevById[f.server_id])
          if (sameRoster) {
            data.flows.forEach(f => {
              const prev = prevById[f.server_id]
              if (prev && prev.status !== f.status) {
                const detail = f.status === 'alert' && f.fault_node ? ` (diverged at ${f.fault_node})` : ''
                logEvent(f.server_id, `status: ${prev.status} → ${f.status}${detail}`)
              }
              if (prev && prev.status !== 'alert' && f.status === 'alert') {
                toastIdRef.current += 1
                const toastId = toastIdRef.current
                setToasts(ts => [...ts, { id: toastId, server_id: f.server_id, reason: f.reason || 'divergence detected', time: new Date().toLocaleTimeString([], { hour12: false }) }])
                setTimeout(() => setToasts(ts => ts.filter(t => t.id !== toastId)), 7000)
              }
            })
          }
          prevFlowsRef.current = data.flows

          const hasRootCause = (data.root_causes || []).length > 0
          if (hasRootCause && !prevHasRootCauseRef.current) {
            const total = data.root_causes.reduce((n, rc) => n + rc.flows.length, 0)
            const routers = data.root_causes.map(rc => rc.responsible_router).join(', ')
            logEvent('system', `correlated ${total} alerts under ${routers}`)
          }
          prevHasRootCauseRef.current = hasRootCause
        }
      }

      socket.onclose = () => {
        if (cancelled) return
        setConnectionStatus('closed')
        setHasSnapshot(false)
        logEvent('system', 'disconnected — retrying in 2s')
        // The backend's tick loop and dev-server restarts are the normal
        // reasons a socket drops in this project (no auth/session to
        // re-establish) — retrying on a short fixed delay is enough,
        // rather than leaving the UI permanently stuck showing
        // "disconnected" until a manual page reload.
        retryTimer = setTimeout(connect, 2000)
      }

      socket.onerror = () => {
        socket.close()
      }

      setWs(socket)
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (socket) socket.close()
    }
  }, [])

  const isLive = connectionStatus === 'open' && hasSnapshot

  const triggerUpdate = (fault) => {
    if (!isLive) return
    setRequestedFault(fault)
    const target = faultScope === 'selected' ? selectedServerId : null
    logEvent('system', fault === 'none' ? 'route update requested (sync)' : `fault injected: ${fault}${target ? ` (target: ${target})` : ' (all servers)'}`)
    ws.send(JSON.stringify({ action: 'update_route', fault, target_server_id: target }))
  }

  const triggerReset = () => {
    if (!isLive) return
    setRequestedFault('none')
    setServerInput(1)
    setUserInput(1)
    logEvent('system', 'network reset')
    ws.send(JSON.stringify({ action: 'reset' }))
  }

  // Applies exactly what's in the config fields — clamped client-side to
  // the same bounds the backend enforces, so the number shown in the input
  // never silently diverges from what actually gets applied.
  const triggerApplyConfig = () => {
    if (!isLive) return
    const servers = clamp(serverInput, MIN_SERVERS, MAX_SERVERS)
    const users = clamp(userInput, MIN_USERS, MAX_USERS)
    const graceWindow = clamp(graceWindowInput, 1, 10)
    const minPacket = clamp(minPacketInput, 64, 1500)
    const maxPacket = clamp(maxPacketInput, 64, 1500)
    setServerInput(servers)
    setUserInput(users)
    setGraceWindowInput(graceWindow); setMinPacketInput(minPacket); setMaxPacketInput(maxPacket)
    setRequestedFault('none')
    logEvent('system', `scaled to ${servers} servers, ${users} users, grace window ${graceWindow}s, packet size ${minPacket}-${maxPacket}B`)
    ws.send(JSON.stringify({
      action: 'scale', num_servers: servers, num_users: users,
      grace_window_seconds: graceWindow, min_packet_size: minPacket, max_packet_size: maxPacket,
    }))
  }

  // One click: a random topology size (servers + users, within the same
  // bounds as the manual fields) AND a random fault, so "generate a random
  // real-infra scenario" doesn't need two separate clicks. The two WS
  // messages are handled in order by the backend's single receive loop
  // (main.py), so the fault always lands on top of the freshly-scaled,
  // freshly-converged topology, never a stale one.
  const triggerRandomize = () => {
    if (!isLive) return
    const servers = randInt(MIN_SERVERS, MAX_SERVERS)
    const users = randInt(MIN_USERS, MAX_USERS)
    const fault = FAULTS[randInt(0, FAULTS.length - 1)]
    setServerInput(servers)
    setUserInput(users)
    setRequestedFault(fault)
    logEvent('system', `randomized — ${servers} servers, ${users} users, fault=${fault}`)
    ws.send(JSON.stringify({ action: 'scale', num_servers: servers, num_users: users }))
    ws.send(JSON.stringify({ action: 'update_route', fault }))
  }

  // Applies a fixed, named topology + fault combination in one click — for
  // walking a judge through a specific, repeatable scenario instead of
  // hand-tuning the raw controls live. Deliberately leaves grace window /
  // packet range alone (whatever's currently configured stays), and always
  // resets faultScope to 'all' since these are meant to be deterministic
  // regardless of whatever scope was last selected.
  const triggerPreset = (preset) => {
    if (!isLive) return
    setServerInput(preset.num_servers)
    setUserInput(preset.num_users)
    setRequestedFault(preset.fault)
    setFaultScope('all')
    logEvent('system', `preset applied: ${preset.label}`)
    ws.send(JSON.stringify({ action: 'scale', num_servers: preset.num_servers, num_users: preset.num_users }))
    ws.send(JSON.stringify({ action: 'update_route', fault: preset.fault, target_server_id: null }))
  }

  // The only router this demo ever mutates is "Users" — the per-node fault
  // visual always targets it, whether or not the backend has escalated to a
  // formal Alert yet (fault_node from the backend is only set once status
  // is 'alert', but the visual should already react during "tolerated").
  const visualFaultNode = requestedFault !== 'none' ? 'Users' : null

  // Worst-case status across every server, for the single top-level status
  // banner — per-server detail still shown in full below it.
  const overallStatus = flows.some(f => f.status === 'alert') ? 'alert'
    : flows.some(f => f.status === 'tolerated') ? 'tolerated'
    : 'synced'
  const overallColor = STATUS_COLOR[overallStatus]
  const alertCount = flows.filter(f => f.status === 'alert').length

  const serverIds = useMemo(() => flows.map(f => f.server_id), [flows])
  const nodePositions = useMemo(() => computeNodePositions(serverIds), [serverIds])
  const baseLinks = useMemo(() => computeBaseLinks(serverIds), [serverIds])
  // Looked up per-node in the ServerRack render below so each individual
  // server box reflects its OWN flow's status, not just the shared
  // fault-injection target.
  const flowByServerId = useMemo(() => Object.fromEntries(flows.map(f => [f.server_id, f])), [flows])

  useEffect(() => {
    if (!flows.some(f => f.server_id === selectedServerId)) {
      setSelectedServerId(flows[0]?.server_id ?? null)
    }
  }, [flows, selectedServerId])

  const selectedFlow = flowByServerId[selectedServerId] ?? flows[0]

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#020617', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: '#f8fafc',
      display: 'grid',
      gridTemplateColumns: '300px 1fr 340px',
      gridTemplateRows: '72px 1fr 200px',
      gridTemplateAreas: `"header header header" "left main right" "console console console"`,
    }}>

      <AlertToasts toasts={toasts} onDismiss={id => setToasts(ts => ts.filter(t => t.id !== id))} />

      {/* Header — title/subtitle on the left, connection status + sponsor
          logo on the right. Nothing here overlaps the 3D viewport: it's
          its own grid row, not an absolutely-positioned overlay. */}
      <div style={{
        gridArea: 'header', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '3px', height: '30px', background: '#38bdf8', borderRadius: '2px' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 600, letterSpacing: '0.2px', lineHeight: '1.2', color: '#f1f5f9' }}>
              PlaneSplit
            </h1>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
              Control-plane / data-plane consistency
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          {/* Connection indicator — always visible, never implied by the
              presence of the panel itself */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isLive ? '#22c55e' : connectionStatus === 'connecting' ? '#fbbf24' : '#ef4444',
              boxShadow: `0 0 8px ${isLive ? '#22c55e' : connectionStatus === 'connecting' ? '#fbbf24' : '#ef4444'}`,
            }} />
            <span style={{
              fontSize: '11px', letterSpacing: '1px', color: '#64748b', textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px',
            }}>
              {isLive ? 'Live — connected to backend' : connectionStatus === 'connecting' ? 'Connecting to backend…' : 'Disconnected — retrying…'}
            </span>
          </div>
          <div style={{
            background: 'rgba(248, 250, 252, 0.92)', borderRadius: '10px', padding: '6px 12px',
            boxShadow: '0 8px 20px -6px rgba(0, 0, 0, 0.4)',
          }}>
            <img src="/myonsite-logo-transparent.png" alt="myOnsite HealthCare" style={{ height: '24px', display: 'block' }} />
          </div>
        </div>
      </div>

      {/* Left sidebar — fault injection controls + infra config. Fixed
          width, own scroll region, no longer competing with the 3D scene
          for screen space. */}
      <div style={{
        gridArea: 'left', overflowY: 'auto', padding: '20px',
        background: 'rgba(15, 23, 42, 0.5)', borderRight: '1px solid rgba(255, 255, 255, 0.08)',
      }}>
        {/* Fault target scope — 'all' (historical default) injects into
            every server's flow, 'selected' targets only whichever server
            tile is currently selected in the right sidebar's status grid.
            Purely a targeting choice, doesn't disable anything below. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <button onClick={() => setFaultScope('all')} style={faultScope === 'all' ? buttonStyle : secondaryButtonStyle}>
            ALL SERVERS
          </button>
          <button onClick={() => setFaultScope('selected')} style={faultScope === 'selected' ? buttonStyle : secondaryButtonStyle}>
            SELECTED SERVER
          </button>
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button disabled={!isLive} onClick={() => triggerUpdate('none')} style={isLive ? buttonStyle : disabledButtonStyle}>
            UPDATE ROUTE (SYNC)
          </button>

          <button disabled={!isLive} onClick={() => triggerUpdate('delay')} style={isLive ? warningButtonStyle : disabledButtonStyle}>
            INJECT DELAY
          </button>

          <button disabled={!isLive} onClick={() => triggerUpdate('drop')} style={isLive ? dangerButtonStyle : disabledButtonStyle}>
            INJECT DROP
          </button>

          <button disabled={!isLive} onClick={() => triggerUpdate('corrupt')} style={isLive ? dangerButtonStyle : disabledButtonStyle}>
            CORRUPT MASK
          </button>

          <button disabled={!isLive} onClick={triggerReset} style={isLive ? {...secondaryButtonStyle, gridColumn: 'span 2'} : {...disabledButtonStyle, gridColumn: 'span 2'}}>
            RESET NETWORK
          </button>
        </div>

        {/* Scenario presets — named, deterministic topology+fault
            combinations for walking through a specific demo beat in one
            click. Deliberately visually distinct (neutral secondary style)
            from the danger/warning fault buttons above, since these apply
            a full scenario rather than a single fault. */}
        <div style={{ marginTop: '16px', padding: '15px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '1px' }}>Scenario Presets</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                disabled={!isLive}
                onClick={() => triggerPreset(preset)}
                style={isLive ? secondaryButtonStyle : disabledButtonStyle}
              >
                {preset.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Infra config — free-form, not fixed presets. Backend clamps to
            MIN/MAX_SERVERS (1-254) and MIN/MAX_USERS (1-254) regardless
            (the real IPv4 host-octet ceiling, not an arbitrary UX limit),
            but these inputs share the exact same bounds so nothing typed
            here silently gets clamped without the field reflecting it. */}
        <div style={{ marginTop: '16px', padding: '15px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '1px' }}>Configure Infra</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>
              Servers ({MIN_SERVERS}–{MAX_SERVERS})
              <input
                type="number" min={MIN_SERVERS} max={MAX_SERVERS} value={serverInput}
                disabled={!isLive}
                onChange={(e) => setServerInput(clamp(parseInt(e.target.value, 10), MIN_SERVERS, MAX_SERVERS))}
                style={numberInputStyle}
              />
            </label>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>
              Users ({MIN_USERS}–{MAX_USERS})
              <input
                type="number" min={MIN_USERS} max={MAX_USERS} value={userInput}
                disabled={!isLive}
                onChange={(e) => setUserInput(clamp(parseInt(e.target.value, 10), MIN_USERS, MAX_USERS))}
                style={numberInputStyle}
              />
            </label>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>
              Grace window (s)
              <input
                type="number" min={1} max={10} step={0.5} value={graceWindowInput}
                disabled={!isLive}
                onChange={(e) => setGraceWindowInput(clamp(parseFloat(e.target.value), 1, 10))}
                style={numberInputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>
              Min packet (bytes)
              <input
                type="number" min={64} max={1500} value={minPacketInput}
                disabled={!isLive}
                onChange={(e) => setMinPacketInput(clamp(parseInt(e.target.value, 10), 64, 1500))}
                style={numberInputStyle}
              />
            </label>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>
              Max packet (bytes)
              <input
                type="number" min={64} max={1500} value={maxPacketInput}
                disabled={!isLive}
                onChange={(e) => setMaxPacketInput(clamp(parseInt(e.target.value, 10), 64, 1500))}
                style={numberInputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button disabled={!isLive} onClick={triggerApplyConfig} style={isLive ? buttonStyle : disabledButtonStyle}>
              APPLY CONFIG
            </button>
            <button disabled={!isLive} onClick={triggerRandomize} style={isLive ? secondaryButtonStyle : disabledButtonStyle}>
              RANDOMIZE
            </button>
          </div>
        </div>
      </div>

      {/* Main 3D viewport — its own grid cell, so nothing floats over it.
          The connecting/disconnected overlay is scoped to this cell only. */}
      <div style={{ gridArea: 'main', position: 'relative' }}>
        {!isLive && <ConnectingOverlay connectionStatus={connectionStatus} />}

        <Canvas camera={{ position: [0, 10, 16], fov: 50 }}>
        <color attach="background" args={['#020617']} />

        {/* Environment setup */}
        <ambientLight intensity={0.2} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} color="#818cf8" />

        {/* Space dust */}
        <Stars radius={100} depth={50} count={3000} factor={4} saturation={1} fade speed={1.5} />

        {/* Cyberpunk Grid Floor */}
        <Grid
            position={[0, -0.5, 0]}
            args={[40, 40]}
            cellSize={1}
            cellThickness={1}
            cellColor="#1e293b"
            sectionSize={5}
            sectionThickness={1.5}
            sectionColor="#38bdf8"
            fadeDistance={35}
        />

        {/* Base Infrastructure Cables */}
        <BaseInfrastructure nodePositions={nodePositions} links={baseLinks} />

        {/* Routers — status comes from that node's own flow (if it is a
            backend server) so each rack's color is that server's real
            state, not a copy of the shared "Users" fault indicator. */}
        {Object.entries(nodePositions).map(([name, pos]) => (
          <ServerRack
            key={name}
            name={name}
            position={pos}
            faultType={name === visualFaultNode ? requestedFault : 'none'}
            status={flowByServerId[name]?.status ?? null}
          />
        ))}

        {/* Population indicator at the shared ingress */}
        <UserCluster position={nodePositions.Users} count={numUsers} />

        {/* Paths and Packets — one CP/DP pair per backend server/flow */}
        {flows.map(f => (
          <group key={f.server_id}>
            <PathLine path={f.cp_trace} color="#22c55e" offset={0.3} nodePositions={nodePositions} />
            <Packet path={f.cp_trace} isCP={true} nodePositions={nodePositions} />

            <PathLine path={f.dp_trace} color={f.status === 'synced' ? "#3b82f6" : STATUS_COLOR[f.status]} offset={-0.3} nodePositions={nodePositions} />
            <Packet path={f.dp_trace} isCP={false} nodePositions={nodePositions} />
          </group>
        ))}

        <OrbitControls
            makeDefault
            autoRotate={true}
            autoRotateSpeed={0.5}
            maxPolarAngle={Math.PI / 2.1} // don't go under floor
            minDistance={5}
            maxDistance={40}
        />

        {/* Post-processing Bloom for glowing elements */}
        <EffectComposer disableNormalPass>
            <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        </EffectComposer>
        </Canvas>
      </div>

      {/* Right sidebar — status summary, per-server status grid + detail,
          and root-cause correlation. Own scroll region, independent of
          the left sidebar and the 3D viewport. */}
      <div style={{
        gridArea: 'right', overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px',
        background: 'rgba(15, 23, 42, 0.5)', borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
      }}>
        <div>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '12px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '1px' }}>
            {flows.length} server{flows.length > 1 ? 's' : ''}, {numUsers} user{numUsers > 1 ? 's' : ''}
          </h3>
          <div style={{
              padding: '10px',
              textAlign: 'center',
              borderRadius: '6px',
              background: `${overallColor}1a`,
              border: `1px solid ${overallColor}4d`,
          }}>
              <span style={{
                  color: overallColor,
                  fontWeight: 'bold',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  fontSize: '14px'
              }}>
                  {overallStatus === 'alert' ? `${alertCount}/${flows.length} SERVERS ALERTING` : STATUS_LABEL[overallStatus]}
              </span>
          </div>
        </div>

        <div>
          <StatusLegend />
          <ServerStatusGrid flows={flows} selectedId={selectedServerId} onSelect={setSelectedServerId} />
        </div>

        <ServerDetailCard flow={selectedFlow} />

        {/* Real output of verify/correlator.py (already tested in
            planesplit/tests/test_correlator.py) — only appears when 2+
            servers share a responsible_router, i.e. the shared-ingress
            fault case scale() + inject() are built to demonstrate. */}
        {rootCauses.length > 0 && (
            <div style={{ padding: '12px', background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '8px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#fbbf24', fontWeight: 'bold', marginBottom: '6px' }}>
                    Root Cause Analysis
                </div>
                {rootCauses.map((rc, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: '1.5' }}>
                        <b>{rc.flows.length} servers</b> ({rc.flows.join(', ')}) all diverge at the same router: <b>{rc.responsible_router}</b>. Reported as one shared root cause, not {rc.flows.length} separate alerts.
                    </div>
                ))}
            </div>
        )}
      </div>

      {/* Bottom console — tails the currently-selected server's real
          status transitions plus always-visible system events (fault
          injections, scale/reset, connection lifecycle). IDE-style
          bottom panel rather than squeezing a wide log into a sidebar. */}
      <div style={{
        gridArea: 'console', display: 'flex', flexDirection: 'column',
        background: '#05070d', borderTop: '1px solid rgba(255, 255, 255, 0.08)',
      }}>
        <div style={{ padding: '6px 16px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
          Live Console — tailing {selectedServerId ?? 'system'}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <LiveConsole logs={logs} filterTag={selectedServerId} />
        </div>
      </div>
    </div>
  )
}

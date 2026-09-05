import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, Text, Line, Grid } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useState, useEffect, useRef, useMemo } from 'react'
import * as THREE from 'three'

const NODE_POSITIONS = {
  Users: [-5, 0, 0],
  Firewall: [0, 0, -4],
  Server: [5, 0, 0],
  AWS_ALB: [0, 0, 4]
}

function ServerRack({ name, position }) {
  return (
    <group position={position}>
      {/* Main body */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[1.5, 3, 1.5]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Glowing server blades */}
      {[0.5, 1.0, 1.5, 2.0, 2.5].map((y, i) => (
        <mesh key={i} position={[0, y, 0.76]}>
          <boxGeometry args={[1.2, 0.1, 0.1]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
      ))}

      {/* Label */}
      <Text position={[0, 3.5, 0]} fontSize={0.6} color="#ffffff" outlineWidth={0.05} outlineColor="#000000">
        {name}
      </Text>
    </group>
  )
}

function Packet({ path, isCP }) {
  const meshRef = useRef()
  const [progress, setProgress] = useState(0)

  const curve = useMemo(() => {
    const points = path.filter(p => NODE_POSITIONS[p]).map(p => {
      const v = new THREE.Vector3(...NODE_POSITIONS[p])
      v.y += 1.5 // raise to middle of rack
      return v
    })
    if (points.length < 2) return null
    return new THREE.CatmullRomCurve3(points, false, 'chordal', 0.2)
  }, [path])

  useFrame((state, delta) => {
    if (!curve) return
    setProgress(p => (p + delta * 0.4) % 1)
    const pos = curve.getPointAt(progress)
    meshRef.current.position.copy(pos)
    
    // Offset slightly so CP and DP don't z-fight
    if (isCP) {
        meshRef.current.position.y += 0.3;
    } else {
        meshRef.current.position.y -= 0.3;
    }
  })

  if (!curve) return null

  const color = isCP ? "#22c55e" : "#ef4444" // Green vs Red

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.25, 32, 32]} />
      <meshBasicMaterial color={color} toneMapped={false} />
      {/* Inner bright core */}
      <mesh scale={0.6}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </mesh>
  )
}

function PathLine({ path, color, offset }) {
    const points = path.filter(p => NODE_POSITIONS[p]).map(p => {
        const v = new THREE.Vector3(...NODE_POSITIONS[p])
        v.y += (1.5 + offset)
        return v
    })
    
    if (points.length < 2) return null
    return (
        <Line 
            points={points} 
            color={color} 
            lineWidth={4}
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
  border: '1px solid rgba(56, 189, 248, 0.4)',
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

export default function App() {
  const [cpTrace, setCpTrace] = useState(["Users", "Firewall", "Server"])
  const [dpTrace, setDpTrace] = useState(["Users", "Firewall", "Server"])
  const [ws, setWs] = useState(null)

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000/ws')
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'state') {
        setCpTrace(data.cp_trace)
        setDpTrace(data.dp_trace)
      }
    }
    setWs(socket)
    return () => socket.close()
  }, [])

  const triggerUpdate = (fault) => {
    if (ws) ws.send(JSON.stringify({ action: 'update_route', fault }))
  }

  const triggerReset = () => {
    if (ws) ws.send(JSON.stringify({ action: 'reset' }))
  }

  const isSynced = cpTrace.join() === dpTrace.join();

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#020617', position: 'relative', overflow: 'hidden' }}>
      
      {/* Top Right Logo */}
      <div style={{ position: 'absolute', top: 30, right: 40, zIndex: 10, textAlign: 'right' }}>
        <img src="/myonsite-logo-transparent.png" alt="MyOnsite Logo" style={{ height: '60px', filter: 'drop-shadow(0 0 10px rgba(56,189,248,0.5))' }} />
      </div>

      {/* Main Control Panel (Glassmorphism) */}
      <div style={{ 
        position: 'absolute', top: 30, left: 30, zIndex: 10, 
        fontFamily: '"Inter", sans-serif', 
        background: 'rgba(15, 23, 42, 0.65)', 
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '30px', 
        borderRadius: '16px',
        color: '#f8fafc',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        width: '400px'
      }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '24px', letterSpacing: '1px', background: 'linear-gradient(90deg, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          PlaneSplit Diagnostics
        </h1>
        <p style={{ margin: '0 0 25px 0', fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>
          Visualizing Control Plane Intent (Hologram) vs Data Plane Reality (Physical) in real-time.
        </p>
        
        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button 
            onClick={() => triggerUpdate('none')} 
            style={buttonStyle}
            onMouseOver={(e) => e.target.style.background = 'rgba(56, 189, 248, 0.2)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(56, 189, 248, 0.1)'}
          >
            ⚡ Update Route (Sync)
          </button>
          
          <button 
            onClick={() => triggerUpdate('delay')} 
            style={{...buttonStyle, color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.4)', background: 'rgba(251, 191, 36, 0.1)'}}
            onMouseOver={(e) => e.target.style.background = 'rgba(251, 191, 36, 0.2)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(251, 191, 36, 0.1)'}
          >
            ⏳ Inject Delay
          </button>
          
          <button 
            onClick={() => triggerUpdate('drop')} 
            style={{...buttonStyle, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)'}}
            onMouseOver={(e) => e.target.style.background = 'rgba(239, 68, 68, 0.2)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(239, 68, 68, 0.1)'}
          >
            ❌ Inject Drop
          </button>

          <button 
            onClick={triggerReset} 
            style={{...buttonStyle, color: '#94a3b8', borderColor: 'rgba(148, 163, 184, 0.4)', background: 'rgba(148, 163, 184, 0.1)'}}
            onMouseOver={(e) => e.target.style.background = 'rgba(148, 163, 184, 0.2)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(148, 163, 184, 0.1)'}
          >
            🔄 Reset Network
          </button>
        </div>

        {/* State Display */}
        <div style={{ marginTop: '30px', padding: '15px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '12px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '1px' }}>Live Telemetry</h3>
            
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', marginRight: '10px', boxShadow: '0 0 10px #22c55e' }}></div>
                <span style={{ fontSize: '13px', width: '40px', color: '#94a3b8' }}>CP:</span>
                <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{cpTrace.join(' → ')}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', marginRight: '10px', boxShadow: '0 0 10px #ef4444' }}></div>
                <span style={{ fontSize: '13px', width: '40px', color: '#94a3b8' }}>DP:</span>
                <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{dpTrace.join(' → ')}</span>
            </div>

            <div style={{ 
                marginTop: '20px', 
                padding: '10px', 
                textAlign: 'center', 
                borderRadius: '6px',
                background: isSynced ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${isSynced ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            }}>
                <span style={{ 
                    color: isSynced ? '#22c55e' : '#ef4444', 
                    fontWeight: 'bold', 
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    fontSize: '14px'
                }}>
                    {isSynced ? '✓ NETWORK SYNCED' : '⚠ DIVERGENCE DETECTED'}
                </span>
            </div>
        </div>
      </div>

      <Canvas camera={{ position: [0, 8, 12], fov: 50 }}>
        <color attach="background" args={['#020617']} />
        
        {/* Environment setup */}
        <ambientLight intensity={0.2} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} color="#818cf8" />
        
        {/* Space dust */}
        <Stars radius={100} depth={50} count={3000} factor={4} saturation={1} fade speed={1.5} />

        {/* Cyberpunk Grid Floor */}
        <Grid 
            position={[0, -0.5, 0]} 
            args={[30, 30]} 
            cellSize={1} 
            cellThickness={1} 
            cellColor="#1e293b" 
            sectionSize={5} 
            sectionThickness={1.5} 
            sectionColor="#38bdf8" 
            fadeDistance={25} 
        />

        {/* Routers */}
        {Object.entries(NODE_POSITIONS).map(([name, pos]) => (
          <ServerRack key={name} name={name} position={pos} />
        ))}

        {/* Paths and Packets */}
        <PathLine path={cpTrace} color="#22c55e" offset={0.3} />
        <Packet path={cpTrace} isCP={true} />

        <PathLine path={dpTrace} color="#ef4444" offset={-0.3} />
        <Packet path={dpTrace} isCP={false} />

        <OrbitControls 
            makeDefault 
            autoRotate={true}
            autoRotateSpeed={0.5}
            maxPolarAngle={Math.PI / 2.1} // don't go under floor
            minDistance={5}
            maxDistance={25}
        />

        {/* Post-processing Bloom for glowing elements */}
        <EffectComposer disableNormalPass>
            <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

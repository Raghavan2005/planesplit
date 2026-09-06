import { useEffect, useRef, useState, useCallback } from 'react'

export interface FlowSnapshot {
  server_id: string
  flow: string
  cp_trace: string[]
  dp_trace: string[]
  status: 'synced' | 'tolerated' | 'alert'
  fault_node: string | null
  reason: string | null
  packet_size_bytes: number
  detected_at: number | null
}

export interface RootCause {
  responsible_router: string
  flows: string[]
}

export interface RequestEvent {
  type: 'request_event'
  id: string
  server_id: string
  flow: string
  sent_at: number
  cp_trace: string[]
  dp_trace: string[]
  status: 'delivered' | 'diverged' | 'dropped'
  reason: string | null
  packet_size_bytes: number
}

interface StateMessage {
  type: 'state'
  flows: FlowSnapshot[]
  root_causes: RootCause[]
  num_users: number
  recent_requests: RequestEvent[]
}

interface ErrorMessage {
  type: 'error'
  message: string
}

type IncomingMessage = StateMessage | RequestEvent | ErrorMessage

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export type ActionPayload =
  | { action: 'reset' }
  | { action: 'update_route'; fault: 'none' | 'delay' | 'drop' | 'corrupt'; target_server_id: string | null }
  | {
      action: 'scale'
      num_servers: number
      num_users: number
      grace_window_seconds?: number
      min_packet_size?: number
      max_packet_size?: number
    }
  | { action: 'remediate'; server_id: string }
  | { action: 'send_request'; server_id: string }

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws'

const BACKOFF_BASE_MS = 1000
const BACKOFF_FACTOR = 2
const BACKOFF_CAP_MS = 16000

const REQUEST_HISTORY_LIMIT = 50

function mergeRequestEvents(existing: RequestEvent[], incoming: RequestEvent[]): RequestEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]))
  for (const event of incoming) byId.set(event.id, event)
  const merged = [...byId.values()].sort((a, b) => a.sent_at - b.sent_at).slice(-REQUEST_HISTORY_LIMIT)

  // Events are immutable once created (send_request/RequestEvent fields
  // never change after the fact), so if the merge produced the exact same
  // ids in the exact same order as `existing`, it's a genuine no-op --
  // return the SAME reference rather than a fresh array, so React's
  // setState bails out instead of forcing a re-render on every ~300ms tick
  // even when recent_requests carried nothing new.
  if (
    merged.length === existing.length &&
    merged.every((event, i) => event.id === existing[i].id)
  ) {
    return existing
  }
  return merged
}

/**
 * Owns the WebSocket connection to the backend: connect/reconnect (with
 * exponential backoff, reset on a successful open), the raw simulation
 * state (flows/rootCauses/numUsers), the running request-event history
 * (merging both live `request_event` pushes and each snapshot's
 * `recent_requests` so a client that just (re)connected sees history
 * immediately), and surfaced backend errors. Deliberately does NOT do any
 * diffing/logging/toast logic itself — that's a derived side effect of
 * `flows` changing over time, not part of "own the transport", so it lives
 * in the consuming component's own effect instead.
 */
export function useSimulationSocket() {
  const [flows, setFlows] = useState<FlowSnapshot[]>([
    {
      server_id: 'Server',
      flow: '10.0.1.0/24',
      cp_trace: ['Users', 'Firewall', 'Server'],
      dp_trace: ['Users', 'Firewall', 'Server'],
      status: 'synced',
      fault_node: null,
      reason: null,
      packet_size_bytes: 0,
      detected_at: null,
    },
  ])
  const [rootCauses, setRootCauses] = useState<RootCause[]>([])
  const [numUsers, setNumUsers] = useState(1)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [requestEvents, setRequestEvents] = useState<RequestEvent[]>([])
  const [lastError, setLastError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const delayRef = useRef(BACKOFF_BASE_MS)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
      setConnectionStatus('connecting')
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket

      socket.onopen = () => {
        if (cancelled) return
        delayRef.current = BACKOFF_BASE_MS // a real connection succeeded -- forget any prior backoff
        setConnectionStatus('open')
      }

      socket.onmessage = (event: MessageEvent<string>) => {
        const data = JSON.parse(event.data) as IncomingMessage
        if (data.type === 'state') {
          setFlows(data.flows)
          setRootCauses(data.root_causes || [])
          setNumUsers(data.num_users || 1)
          setHasSnapshot(true)
          if (data.recent_requests?.length) {
            setRequestEvents((prev) => mergeRequestEvents(prev, data.recent_requests))
          }
        } else if (data.type === 'request_event') {
          setRequestEvents((prev) => mergeRequestEvents(prev, [data]))
        } else if (data.type === 'error') {
          setLastError(data.message)
        }
      }

      socket.onclose = () => {
        if (cancelled) return
        setConnectionStatus('closed')
        setHasSnapshot(false)
        const delay = Math.min(delayRef.current, BACKOFF_CAP_MS)
        retryTimer = setTimeout(connect, delay)
        delayRef.current = Math.min(delayRef.current * BACKOFF_FACTOR, BACKOFF_CAP_MS)
      }

      socket.onerror = () => {
        socket.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      socketRef.current?.close()
    }
  }, [])

  const send = useCallback((payload: ActionPayload) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload))
    }
  }, [])

  return {
    flows,
    rootCauses,
    numUsers,
    connectionStatus,
    hasSnapshot,
    requestEvents,
    lastError,
    send,
  }
}

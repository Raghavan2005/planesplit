import { buttonStyle, disabledButtonStyle } from '../../theme'

// The literal "a user can also make a request" control: fires the real
// backend `send_request` action (backend/state.py::SimulationState.
// send_request -> a real probe_flow() + Verifier.check() + Network.
// delivered() call chain against server_id's actual current flow state).
// No optimistic UI flip and no client-side guess at the outcome -- the
// result only ever appears once the backend's real `request_event`
// broadcast lands (see useSimulationSocket's requestEvents / App.tsx's
// triggerSendRequest).
interface SendRequestButtonProps {
  serverId: string
  isLive: boolean
  onSendRequest: (serverId: string) => void
}

export function SendRequestButton({ serverId, isLive, onSendRequest }: SendRequestButtonProps) {
  return (
    <button
      disabled={!isLive}
      onClick={() => onSendRequest(serverId)}
      style={{ ...(isLive ? buttonStyle : disabledButtonStyle), width: '100%', marginTop: '10px' }}
    >
      SEND TEST REQUEST
    </button>
  )
}

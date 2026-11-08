/** Versioned parent bridge. Credentials never leave memory or enter URLs. */
export const embedded = new URLSearchParams(location.search).has('embed')
export const readOnly = new URLSearchParams(location.search).get('embed') === 'play'
const params = new URLSearchParams(location.search)
const parentOrigin = params.get('parentOrigin') || ''
const instanceId = params.get('instanceId') || ''
const bootId = crypto.randomUUID()
const allowedParents = (import.meta.env.VITE_PARENT_ORIGINS || '').split(',')
export const bridgeAllowed = embedded && window.parent !== window && allowedParents.includes(parentOrigin) && !!instanceId
export interface BridgeMessage {
  protocol: 'ai-tang-courseware'
  version: 1
  instanceId: string
  bootId: string
  requestId: string
  type: string
  payload: Record<string, unknown>
}
const listeners = new Set<(message: BridgeMessage) => void>()
export function send(type: string, payload: Record<string, unknown> = {}, requestId: string = crypto.randomUUID()) {
  if (!bridgeAllowed) return
  window.parent.postMessage({ protocol: 'ai-tang-courseware', version: 1, instanceId, bootId, requestId, type, payload }, parentOrigin)
}
export function subscribe(listener: (message: BridgeMessage) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
window.addEventListener('message', event => {
  const data = event.data
  if (!bridgeAllowed || event.origin !== parentOrigin || event.source !== window.parent) return
  if (!data || data.protocol !== 'ai-tang-courseware' || data.version !== 1 || data.instanceId !== instanceId || data.bootId !== bootId) return
  if (typeof data.requestId !== 'string' || typeof data.type !== 'string' || !data.payload || typeof data.payload !== 'object') return
  for (const listener of listeners) listener(data)
})

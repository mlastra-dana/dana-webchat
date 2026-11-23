import { mockMessages, mockSession } from '../data/mockSession'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

// Adapt these paths in one place when the dana-webchat-api contract is defined.
const paths = {
  session: (token) => `/sessions/${encodeURIComponent(token)}`,
  messages: (token) => `/sessions/${encodeURIComponent(token)}/messages`,
  actions: (token) => `/sessions/${encodeURIComponent(token)}/actions`,
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) throw new Error(`No se pudo completar la solicitud (${response.status}).`)
  return response.json()
}

const clone = (value) => structuredClone(value)
export const isMockMode = !apiBaseUrl

export async function getSession(sessionToken) {
  if (isMockMode) return clone({ ...mockSession, sessionId: sessionToken || mockSession.sessionId })
  return request(paths.session(sessionToken))
}

export async function getMessages(sessionToken) {
  if (isMockMode) return clone(mockMessages)
  return request(paths.messages(sessionToken))
}

export async function sendMessage(sessionToken, message) {
  if (isMockMode) return { id: crypto.randomUUID(), type: 'outgoing', text: message, time: timeNow() }
  return request(paths.messages(sessionToken), { method: 'POST', body: JSON.stringify({ message }) })
}

export async function sendAction(sessionToken, action) {
  if (isMockMode) return { action, accepted: true }
  return request(paths.actions(sessionToken), { method: 'POST', body: JSON.stringify({ action }) })
}

export function timeNow() {
  return new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
}

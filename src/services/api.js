const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '')

function requireBaseUrl() {
  if (!apiBaseUrl) throw new Error('Falta configurar VITE_API_BASE_URL para conectar DANA LinkChat con la API.')
  return apiBaseUrl
}

const sessionPath = (code) => `/sessions/${encodeURIComponent(code)}`

async function request(path, options = {}) {
  const response = await fetch(`${requireBaseUrl()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })

  let data
  try { data = await response.json() } catch { data = null }

  if (!response.ok || data?.success === false) {
    const detail = [data?.error, data?.message].find((value) => typeof value === 'string')
    throw new Error(detail || `La API respondió con el estado ${response.status}.`)
  }
  if (!data) throw new Error('La API devolvió una respuesta vacía o inválida.')
  return data
}

export function readSession(data) {
  const session = data?.session
  if (!session || !Array.isArray(session.messages)) {
    throw new Error('La API no devolvió una sesión con mensajes válidos.')
  }
  return session
}

export async function getSession(code) {
  return readSession(await request(sessionPath(code)))
}

export async function sendMessage(code, message) {
  return request(`${sessionPath(code)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export async function sendAction(code, action) {
  return request(`${sessionPath(code)}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

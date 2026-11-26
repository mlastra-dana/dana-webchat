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

export async function uploadPaymentProof(code, file) {
  const path = sessionPath(code)
  const data = { fileName: file.name, contentType: file.type, size: file.size, sender: 'user' }
  const upload = await request(`${path}/media/presign`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  const uploadUrl = new URL(upload.uploadUrl)
  if (uploadUrl.protocol !== 'https:' || !upload.mediaKey) throw new Error('La API no devolvió una URL segura para subir el comprobante.')
  const put = await fetch(uploadUrl.href, {
    method: 'PUT',
    headers: upload.uploadHeaders || { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new Error(`No se pudo subir el comprobante a S3 (${put.status}).`)
  return request(`${path}/media/confirm`, {
    method: 'POST',
    body: JSON.stringify({ ...data, mediaKey: upload.mediaKey }),
  })
}

function expectList(data, key) {
  if (!Array.isArray(data?.[key])) throw new Error(`La API no devolvió ${key} en un formato válido.`)
  return data[key]
}

export async function getOperators() {
  return expectList(await request('/operators'), 'operators')
}

export async function createOperator(name, email) {
  return request('/operators', { method: 'POST', body: JSON.stringify({ name, email }) })
}

export async function updateOperator(id, name, email) {
  return request('/operators', { method: 'POST', body: JSON.stringify({ operatorId: id, name, email }) })
}

export async function updateOperatorStatus(id, available) {
  return request(`/operators/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ available }) })
}

export async function getOperatorQueue() {
  return expectList(await request('/operator-queue'), 'sessions')
}

export async function takeSession(code, operatorId) {
  return request(`${sessionPath(code)}/take`, { method: 'POST', body: JSON.stringify({ operatorId }) })
}

export async function sendOperatorMessage(code, operatorId, message) {
  return request(`${sessionPath(code)}/operator-message`, { method: 'POST', body: JSON.stringify({ operatorId, message }) })
}

export async function returnToBot(code, operatorId) {
  return request(`${sessionPath(code)}/return-to-bot`, { method: 'POST', body: JSON.stringify({ operatorId }) })
}

export async function callAction(code, action, sender, operatorId = '') {
  if (!['start', 'accept', 'join', 'reject', 'end'].includes(action)) throw new Error('Acción de llamada inválida.')
  return request(`${sessionPath(code)}/call/${action}`, {
    method: 'POST',
    body: JSON.stringify({ sender, ...(sender === 'operator' ? { operatorId } : {}) }),
  })
}

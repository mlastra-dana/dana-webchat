const storageKey = 'dana-linkchat-operator'

export function normalizeOperator(value) {
  if (!value || typeof value !== 'object') return null
  const id = value.operatorId ?? value.OPERATOR_ID ?? value.id
  if (!id) return null
  return {
    id: String(id),
    name: value.name ?? value.NAME ?? '',
    email: value.email ?? value.EMAIL ?? '',
    active: value.active ?? value.ACTIVE ?? true,
    available: value.available ?? value.AVAILABLE ?? false,
    currentSessionCode: value.currentSessionCode ?? value.CURRENT_SESSION_CODE ?? '',
  }
}

export function loadOperatorIdentity() {
  try { return normalizeOperator(JSON.parse(sessionStorage.getItem(storageKey))) }
  catch { return null }
}

export function saveOperatorIdentity(operator) {
  sessionStorage.setItem(storageKey, JSON.stringify(operator))
}

export function clearOperatorIdentity() {
  sessionStorage.removeItem(storageKey)
}

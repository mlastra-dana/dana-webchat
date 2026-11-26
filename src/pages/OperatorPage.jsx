import { useCallback, useEffect, useState } from 'react'
import OperatorSidebar from '../components/operator/OperatorSidebar'
import OperatorChat from '../components/operator/OperatorChat'
import OperatorSettings from '../components/operator/OperatorSettings'
import BrandMark from '../components/BrandMark'
import { createOperator, getOperatorQueue, getOperators, getSession, readSession, returnToBot, takeSession, updateOperatorStatus } from '../services/api'
import { clearOperatorIdentity, loadOperatorIdentity, normalizeOperator, saveOperatorIdentity } from '../services/operatorIdentity'

function codeFromPath() {
  const match = window.location.pathname.match(/^\/operator\/chat\/([^/]+)\/?$/)
  try { return match ? decodeURIComponent(match[1]) : '' }
  catch { return '' }
}

function viewFromPath() { return window.location.pathname === '/operator/settings' ? 'settings' : 'waiting' }

export default function OperatorPage() {
  const [operator, setOperator] = useState(loadOperatorIdentity)
  const [knownOperators, setKnownOperators] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [activeCode, setActiveCode] = useState(codeFromPath)
  const [currentSession, setCurrentSession] = useState(null)
  const [queue, setQueue] = useState([])
  const [tab, setTab] = useState(() => codeFromPath() ? 'assigned' : viewFromPath())
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const onPop = () => { const code = codeFromPath(); setActiveCode(code); setTab(code ? 'assigned' : viewFromPath()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (operator) return
    let active = true
    getOperators().then((items) => { if (active) setKnownOperators(items.map(normalizeOperator).filter(Boolean)) })
      .catch((cause) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [operator])

  useEffect(() => {
    const stored = loadOperatorIdentity()
    if (!stored?.id || !stored.active || stored.currentSessionCode) return
    updateOperatorStatus(stored.id, true)
      .then((response) => {
        if (loadOperatorIdentity()?.id !== stored.id) return
        const next = normalizeOperator(response.operator)
        if (!next?.available) throw new Error('No se pudo activar la disponibilidad del operador.')
        saveOperatorIdentity(next)
        setOperator(next)
        setSyncError('')
      })
      .catch((cause) => setSyncError(cause.message))
  }, [])

  const refresh = useCallback(async () => {
    if (!operator || document.visibilityState !== 'visible') return
    try {
      const [sessions, operators] = await Promise.all([getOperatorQueue(), getOperators()])
      if (loadOperatorIdentity()?.id !== operator.id) return
      const live = operators.map(normalizeOperator).find((item) => item?.id === operator.id)
      if (!live) throw new Error('El operador ya no aparece en la lista del backend. Ingresa de nuevo.')
      setQueue(sessions.filter((item) => item.mode === 'WAITING_AGENT'))
      setOperator(live)
      saveOperatorIdentity(live)
      setNow(Date.now())
      setSyncError('')
    } catch (cause) { setSyncError(cause.message) }
  }, [operator?.id])

  useEffect(() => {
    if (!operator) return
    refresh()
    const timer = setInterval(refresh, 3000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [operator?.id, refresh])

  const handleSession = useCallback((session) => { setCurrentSession(session) }, [])
  const handleOperatorChanged = useCallback((next) => { setOperator(next); saveOperatorIdentity(next) }, [])

  useEffect(() => {
    const code = operator?.currentSessionCode
    if (!code || currentSession?.code === code) return
    let active = true
    getSession(code).then((session) => { if (active) setCurrentSession(session) }).catch(() => {})
    return () => { active = false }
  }, [operator?.currentSessionCode, currentSession?.code])

  function navigate(code = '', nextTab = 'waiting') {
    const path = code ? `/operator/chat/${encodeURIComponent(code)}` : nextTab === 'settings' ? '/operator/settings' : '/operator'
    window.history.pushState({}, '', path)
    setActiveCode(code)
    setTab(nextTab)
  }

  function selectTab(nextTab) { navigate('', nextTab) }

  async function enter(event) {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanName || !cleanEmail) return
    setBusy(true)
    setError('')
    try {
      const existing = (await getOperators()).map(normalizeOperator)
        .filter((item) => item?.email.toLowerCase() === cleanEmail)
        .sort((a, b) => Number(b.active && b.available) - Number(a.active && a.available))[0]
      if (existing && ![cleanEmail.split('@')[0], existing.name.trim().toLowerCase()].includes(cleanName.toLowerCase())) {
        throw new Error('El usuario no coincide con el correo del operador.')
      }
      const response = existing ? null : await createOperator(cleanName, cleanEmail)
      let next = existing || normalizeOperator(response?.operator || response)
      if (!next) {
        const items = await getOperators()
        next = items.map(normalizeOperator).find((item) => item?.email.toLowerCase() === cleanEmail)
      }
      if (!next) throw new Error('El backend no devolvió un operatorId para el operador creado.')
      if (!next.active) throw new Error('Este operador está inactivo.')
      if (!next.currentSessionCode) {
        const status = await updateOperatorStatus(next.id, true)
        next = normalizeOperator(status.operator)
        if (!next?.available) throw new Error('No se pudo activar la disponibilidad del operador.')
      }
      saveOperatorIdentity(next)
      setOperator(next)
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function take(code) {
    if (!operator || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await takeSession(code, operator.id)
      const session = response?.session ? readSession(response) : await getSession(code)
      if (session.mode !== 'AGENT') throw new Error(`La sesión continúa en modo ${session.mode || 'desconocido'} después de tomarla.`)
      setCurrentSession(session)
      navigate(code, 'assigned')
      await refresh()
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function release(code) {
    if (!operator || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await returnToBot(code, operator.id)
      const session = response?.session ? readSession(response) : await getSession(code)
      if (session.mode !== 'BOT') throw new Error(`La sesión continúa en modo ${session.mode || 'desconocido'} después de devolverla al bot.`)
      navigate()
      await refresh()
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function exit() {
    if (!operator || busy) return
    setBusy(true)
    setError('')
    try {
      await updateOperatorStatus(operator.id, false)
      clearOperatorIdentity()
      setOperator(null)
      setCurrentSession(null)
      setQueue([])
      navigate()
    } catch (cause) { setError(`No se pudo cerrar sesión. ${cause.message}`) }
    finally { setBusy(false) }
  }

  if (!operator) return <main className="operator-entry-shell"><form className="operator-entry-card" onSubmit={enter}>
    <BrandMark className="operator-entry-mark" />
    <span className="operator-entry-eyebrow">DANA LinkChat</span>
    <h1>Panel de operadores</h1>
    <p>Ingresa tus datos para atender conversaciones desde esta consola.</p>
    {knownOperators.length > 0 && <div className="operator-known"><span>Operadores existentes</span><div>{knownOperators.map((item) => <button type="button" key={item.id} onClick={() => { setName(item.email.split('@')[0]); setEmail(item.email) }}>{item.email.split('@')[0]}</button>)}</div></div>}
    <label>Usuario<input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="username" placeholder="mlastra" /></label>
    <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" placeholder="operador@example.com" /></label>
    {error && <div className="operator-entry-error" role="alert">{error}</div>}
    <button className="operator-entry-submit" type="submit" disabled={busy}>{busy ? 'Ingresando...' : 'Ingresar'}</button>
    <small>Acceso de PoC. La identidad del operador se guarda solo en esta sesión del navegador.</small>
  </form></main>

  return <main className={`operator-shell ${activeCode ? 'operator-shell-chat-open' : ''} ${tab === 'settings' ? 'operator-shell-settings-open' : ''}`}>
    <OperatorSidebar operator={operator} queue={queue} activeCode={activeCode} currentSession={currentSession} tab={tab} onTab={selectTab} onSelect={(code) => navigate(code, 'assigned')} onTake={take} onExit={exit} onRefresh={refresh} busy={busy} error={error || syncError} now={now} />
    {tab === 'settings' ? <OperatorSettings currentOperator={operator} onOperatorChanged={handleOperatorChanged} onBack={() => navigate()} /> : activeCode ? <OperatorChat code={activeCode} operator={operator} onBack={() => navigate('', tab)} onTake={take} onReturn={release} onSession={handleSession} busy={busy} actionError={error} /> : <section className="operator-placeholder"><BrandMark className="operator-placeholder-mark" /><h1>{tab === 'assigned' ? 'Mis conversaciones' : 'Cola de atención'}</h1><p>{tab === 'assigned' ? 'Selecciona tu conversación activa para continuar.' : 'Selecciona una conversación de la cola para comenzar a atenderla.'}</p></section>}
  </main>
}

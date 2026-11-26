import { Clock3, Headset, LogOut, RefreshCw, Settings2 } from 'lucide-react'

function formatMoney(value, currency) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return `${currency || '—'} —`
  try { return `${currency || '—'} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value))}` }
  catch { return `${currency || ''} ${value ?? ''}`.trim() }
}

function waitingSince(session) {
  const action = [...(session.messages || [])].reverse().find((message) => message.metadata?.action === 'TALK_TO_AGENT' || message.metadata?.event === 'RECEIPT_REVIEW')
  return session.waitingSince || action?.createdAt || session.createdAt
}

function waitLabel(dateValue, now) {
  const time = new Date(dateValue).getTime()
  if (!Number.isFinite(time)) return 'En espera'
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function OperatorSidebar({ operator, queue, activeCode, currentSession, tab, onTab, onSelect, onTake, onStatus, onExit, onRefresh, busy, error, now }) {
  const assignedCode = operator.currentSessionCode || (currentSession?.mode === 'AGENT' && currentSession?.assignedOperatorId === operator.id ? currentSession.code : '')
  const assigned = assignedCode ? currentSession?.code === assignedCode ? currentSession : null : null
  const orderedQueue = [...queue].sort((a, b) => {
    const first = new Date(waitingSince(a)).getTime()
    const second = new Date(waitingSince(b)).getTime()
    return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity)
  })
  return <aside className={`operator-sidebar ${activeCode ? 'operator-sidebar-has-chat' : ''}`}>
    <div className="operator-sidebar-top">
      <div className="operator-brand-mark">D</div>
      <div className="operator-brand-copy"><strong>DANA LinkChat</strong><span>Panel de operadores</span></div>
      <button className="operator-icon-button" type="button" aria-label="Salir del panel" title="Salir del panel" onClick={onExit}><LogOut size={17} /></button>
    </div>
    <div className="operator-profile">
      <div><span className="operator-profile-label">Operador</span><strong>{operator.name}</strong><small>{operator.email}</small></div>
      <label className="operator-availability"><input type="checkbox" checked={Boolean(operator.available)} onChange={(event) => onStatus(event.target.checked)} disabled={busy || !operator.active || Boolean(operator.currentSessionCode)} /><span aria-hidden="true" className="operator-switch" /><span>{!operator.active ? 'Inactivo' : operator.currentSessionCode ? 'En atención' : operator.available ? 'Disponible' : 'No disponible'}</span></label>
    </div>
    <nav className="operator-tabs" aria-label="Panel de operadores">
      <button type="button" aria-current={tab === 'waiting' ? 'page' : undefined} className={tab === 'waiting' ? 'active' : ''} onClick={() => onTab('waiting')}><Headset size={16} />Cola <span>{queue.length}</span></button>
      <button type="button" aria-current={tab === 'assigned' ? 'page' : undefined} className={tab === 'assigned' ? 'active' : ''} onClick={() => onTab('assigned')}>Mis conversaciones <span>{assignedCode ? 1 : 0}</span></button>
      <button type="button" aria-current={tab === 'settings' ? 'page' : undefined} className={tab === 'settings' ? 'active' : ''} onClick={() => onTab('settings')}><Settings2 size={16} />Configuración</button>
    </nav>
    {tab !== 'settings' && <div className="operator-list-heading"><span>{tab === 'waiting' ? 'Solicitudes en espera' : 'Tu conversación'}</span><button type="button" className="operator-icon-button" aria-label="Actualizar conversaciones" title="Actualizar" onClick={onRefresh} disabled={busy}><RefreshCw size={16} /></button></div>}
    {error && <div className="operator-sidebar-error" role="alert">{error}</div>}
    {tab !== 'settings' && <div className="operator-conversation-list">
      {tab === 'waiting' && (orderedQueue.length ? orderedQueue.map((session) => <article className={`operator-list-card ${activeCode === session.code ? 'selected' : ''}`} key={session.code}>
        <div className="operator-list-card-top"><strong>{session.customer?.firstName || 'Cliente'}</strong><span><Clock3 size={13} />Esperando {waitLabel(waitingSince(session), now)}</span></div>
        <div className="operator-list-card-meta"><strong>{formatMoney(session.collection?.balance, session.collection?.currency)}</strong><span>Ref. {session.collection?.reference || '—'}</span></div>
        <div className="operator-list-card-bottom"><span className="operator-waiting-pill">{session.flowStep === 'PAYMENT_REVIEW' ? 'Revisar comprobante' : 'WAITING_AGENT'}</span><button type="button" onClick={() => onTake(session.code)} disabled={busy || !operator.active || !operator.available || Boolean(operator.currentSessionCode)}>Tomar conversación</button></div>
      </article>) : <div className="operator-empty-list"><Headset size={25} /><strong>Sin conversaciones esperando</strong><span>Las solicitudes aparecerán aquí automáticamente.</span></div>)}
      {tab === 'assigned' && (assignedCode ? <button type="button" className={`operator-list-card operator-assigned-card ${activeCode === assignedCode ? 'selected' : ''}`} onClick={() => onSelect(assignedCode)}><strong>{assigned?.customer?.firstName || 'Conversación en atención'}</strong><span>{assigned?.collection ? `${formatMoney(assigned.collection.balance, assigned.collection.currency)} · Ref. ${assigned.collection.reference || '—'}` : `Sesión ${assignedCode}`}</span><small>En atención · Abrir conversación</small></button> : <div className="operator-empty-list"><Headset size={25} /><strong>Sin conversación activa</strong><span>Toma una solicitud de la cola para comenzar.</span></div>)}
    </div>}
  </aside>
}

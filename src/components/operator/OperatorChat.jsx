import { ArrowLeft, Info, RotateCcw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ChatComposer from '../ChatComposer'
import CustomerContext from './CustomerContext'
import AudioCall from '../AudioCall'
import { getSession, readSession, sendOperatorMessage, uploadMedia } from '../../services/api'

function messageTime(createdAt) {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

export default function OperatorChat({ code, operator, onBack, onTake, onReturn, onSession, busy, actionError }) {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const scrollRef = useRef(null)
  const nearBottomRef = useRef(true)
  const initializedRef = useRef(false)

  useEffect(() => {
    let active = true
    let inFlight = false
    setSession(null)
    setLoading(true)
    setError('')
    nearBottomRef.current = true
    initializedRef.current = false
    async function refresh() {
      if (document.visibilityState !== 'visible' || inFlight) return
      inFlight = true
      try {
        const next = await getSession(code)
        if (active) { setSession(next); onSession(next); setError(''); setLoading(false) }
      } catch (cause) {
        if (active) { setError(cause.message); setLoading(false) }
      } finally { inFlight = false }
    }
    refresh()
    const timer = setInterval(refresh, 2500)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [code, onSession])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !session) return
    if (!initializedRef.current || nearBottomRef.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: initializedRef.current ? 'smooth' : 'instant' })
      initializedRef.current = true
    }
  }, [session?.messages])

  function trackScroll(event) {
    const element = event.currentTarget
    nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
  }

  async function handleSend(message) {
    if (sending || !session || session.mode !== 'AGENT') return false
    setSending(true)
    setError('')
    nearBottomRef.current = true
    try {
      const response = await sendOperatorMessage(code, operator.id, message)
      const next = response?.session ? readSession(response) : await getSession(code)
      setSession(next)
      onSession(next)
      return true
    } catch (cause) { setError(cause.message); return false }
    finally { setSending(false) }
  }

  async function handleSendFile(file) {
    if (sending || !session || session.mode !== 'AGENT') return false
    setSending(true)
    setError('')
    nearBottomRef.current = true
    try {
      const response = await uploadMedia(code, file, 'operator', operator.id)
      const next = response?.session ? readSession(response) : await getSession(code)
      setSession(next)
      onSession(next)
      return true
    } catch (cause) { setError(`No se pudo enviar el archivo. ${cause.message}`); return false }
    finally { setSending(false) }
  }

  const assigned = session?.mode === 'AGENT' && String(session.assignedOperatorId || '') === operator.id
  function updateSession(next) { setSession(next); onSession(next) }
  return <section className="operator-chat">
    <header className="operator-chat-header">
      <button type="button" className="operator-back operator-icon-button" aria-label="Volver a conversaciones" onClick={onBack}><ArrowLeft size={20} /></button>
      <div className="operator-chat-heading"><strong>{session?.customer?.firstName || (loading ? 'Cargando conversación...' : 'Conversación')}</strong><span>{session?.mode === 'AGENT' ? 'En atención' : session?.mode === 'WAITING_AGENT' ? 'Esperando asesor' : session?.mode === 'BOT' ? 'Atendido por el bot' : `Sesión ${code}`}</span></div>
      <button type="button" className="operator-icon-button" aria-label="Ver contexto del cliente" title="Ver contexto" onClick={() => setShowContext((open) => !open)} disabled={!session}><Info size={19} /></button>
      {assigned && <button type="button" className="operator-return-button" onClick={() => onReturn(code)} disabled={busy || sending}><RotateCcw size={16} /><span>Devolver al bot</span></button>}
    </header>
    {session && <AudioCall code={code} session={session} sender="operator" operatorId={operator.id} onSession={updateSession} />}
    <div className={`operator-chat-body ${showContext ? 'operator-context-open' : ''}`}>
      <div className="operator-message-scroll" ref={scrollRef} onScroll={trackScroll}>
        {loading && <div className="operator-chat-state">Cargando historial...</div>}
        {!loading && !session && <div className="operator-chat-state" role="alert">{error || 'No se pudo cargar la conversación.'}</div>}
        {session && <div className="operator-messages" aria-live="polite" aria-relevant="additions">
          {session.messages.map((message, index) => {
            const role = message.role
            const outbound = role === 'operator' || (role === 'assistant' && message.metadata?.operatorId)
            const kind = role === 'system' ? 'system' : outbound ? 'operator' : role === 'user' ? 'customer' : 'bot'
            return <div className={`operator-message operator-message-${kind}`} key={message.id || `${message.createdAt}-${index}`}>
              <div className="operator-message-bubble">{kind === 'bot' && <small>Bot</small>}<p>{message.text}</p>{message.mediaUrl?.startsWith('https://') && message.type === 'audio' && <audio className="message-media-audio" controls preload="none" src={message.mediaUrl} aria-label={message.fileName || 'Nota de voz'} />}{message.mediaUrl?.startsWith('https://') && message.type === 'image' && <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer"><img className="message-media-image" src={message.mediaUrl} alt={message.fileName || 'Imagen adjunta'} loading="lazy" /></a>}{message.mediaUrl?.startsWith('https://') && !['audio', 'image'].includes(message.type) && <a className="operator-media-link" href={message.mediaUrl} target="_blank" rel="noopener noreferrer">Abrir documento</a>}<time>{messageTime(message.createdAt)}</time></div>
            </div>
          })}
        </div>}
      </div>
      {session && <CustomerContext session={session} onClose={() => setShowContext(false)} />}
    </div>
    {session && <div className="operator-chat-footer">
      {(error || actionError) && <div className="operator-chat-error" role="alert">{error || actionError}</div>}
      {session.mode === 'WAITING_AGENT' && <button type="button" className="operator-take-inline" onClick={() => onTake(code)} disabled={busy || !operator.active || !operator.available}>Tomar conversación</button>}
      {session.mode === 'BOT' && <div className="operator-chat-note">Esta conversación está siendo atendida por el bot.</div>}
      {session.mode === 'AGENT' && !assigned && <div className="operator-chat-note">Esta conversación está asignada a otro operador.</div>}
      {assigned && <ChatComposer onSend={handleSend} onSendFile={handleSendFile} disabled={sending || busy} />}
    </div>}
  </section>
}

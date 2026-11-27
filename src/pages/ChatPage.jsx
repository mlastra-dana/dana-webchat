import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ChatHeader from '../components/ChatHeader'
import ChatMessage from '../components/ChatMessage'
import ChatComposer from '../components/ChatComposer'
import DebtCard from '../components/DebtCard'
import PoweredByDana from '../components/PoweredByDana'
import QuickActions from '../components/QuickActions'
import SystemMessage from '../components/SystemMessage'
import PaymentValidationNotice from '../components/PaymentValidationNotice'
import AudioCall from '../components/AudioCall'
import { getSession, readSession, sendAction, sendMessage, uploadMedia } from '../services/api'

const actions = { pay: 'PAY_NOW', advisor: 'TALK_TO_AGENT', back: 'BACK_HOME' }
const quickActions = ['pay', 'advisor']
const actionKeys = { PAY_NOW: 'pay', TALK_TO_AGENT: 'advisor', BACK_HOME: 'back' }

function messageTime(createdAt) {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function secureUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : ''
  } catch { return '' }
}

export default function ChatPage({ sessionToken }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [actionUrl, setActionUrl] = useState('')
  const scrollRef = useRef(null)
  const nearBottomRef = useRef(true)
  const scrollInitializedRef = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setSession(null)
    setLoadError('')
    setError('')
    setActionUrl('')
    nearBottomRef.current = true
    scrollInitializedRef.current = false

    if (!sessionToken) {
      setLoading(false)
      return () => { active = false }
    }

    getSession(sessionToken)
      .then((nextSession) => {
        if (!active) return
        document.title = `${nextSession.brand?.companyName || 'DANA LinkChat'} · ${nextSession.brand?.subtitle || 'Atención digital'}`
        setSession(nextSession)
      })
      .catch((cause) => {
        if (!active) return
        setLoadError(cause.message.includes('VITE_API_BASE_URL') ? cause.message : 'Esta sesión no está disponible o ha expirado.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sessionToken])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (!scrollInitializedRef.current || nearBottomRef.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: scrollInitializedRef.current ? 'smooth' : 'instant' })
      scrollInitializedRef.current = true
    }
  }, [session?.messages, session?.mode])

  useEffect(() => {
    if (!sessionToken || !(['WAITING_AGENT', 'AGENT'].includes(session?.mode) || session?.flowStep === 'PAYMENT_REVIEW')) return
    let active = true
    let busy = false
    async function refresh() {
      if (document.visibilityState !== 'visible' || busy) return
      busy = true
      try { const next = await getSession(sessionToken); if (active) setSession(next) }
      catch { /* Keep the last valid session during a transient polling failure. */ }
      finally { busy = false }
    }
    const timer = setInterval(refresh, 2500)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [sessionToken, session?.mode])

  function trackScroll(event) {
    const element = event.currentTarget
    nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
  }

  async function applyResponse(response) {
    const nextSession = response?.session && Array.isArray(response.session.messages)
      ? readSession(response)
      : await getSession(sessionToken)
    setSession(nextSession)
    setActionUrl(secureUrl(response?.paymentUrl || response?.url || ''))
  }

  async function handleSend(text) {
    if (sending) return false
    nearBottomRef.current = true
    setSending(true)
    setError('')
    try {
      await applyResponse(await sendMessage(sessionToken, text))
      return true
    } catch (cause) {
      setError(`No se pudo enviar el mensaje. ${cause.message}`)
      return false
    } finally { setSending(false) }
  }

  async function handleAction(action) {
    if (sending || !actions[action] || (receiptMatched && action === 'pay')) return
    setSending(true)
    setError('')
    try { await applyResponse(await sendAction(sessionToken, actions[action])) }
    catch (cause) {
      if (cause.message === 'payment_already_confirmed') {
        try { setSession(await getSession(sessionToken)); setError('') }
        catch { setError('El pago ya está acreditado.') }
      } else setError(`No se pudo procesar la opción. ${cause.message}`)
    }
    finally { setSending(false) }
  }

  async function handleSendFile(file) {
    if (sending) return false
    setSending(true)
    setError('')
    nearBottomRef.current = true
    try {
      await applyResponse(await uploadMedia(sessionToken, file))
      return true
    } catch (cause) {
      setError(`No se pudo enviar el archivo. ${cause.message}`)
      return false
    } finally { setSending(false) }
  }

  function renderMessage(item, index) {
    if (!item?.text || item.metadata?.event === 'RETURNED_TO_BOT') return null
    const key = item.id || `${item.createdAt || 'message'}-${index}`
    if (item.role === 'assistant' || item.role === 'user') {
      const fromOperator = item.role === 'assistant' && (item.metadata?.source === 'operator' || Boolean(item.metadata?.operatorId))
      let text = receiptMatched && item.metadata?.event === 'RECEIPT_MATCHED' ? 'Pago acreditado. Gracias.' : item.text
      if (receiptMatched && index === 0) {
        text = text.replace(/(?:Este es el detalle de tu saldo pendiente|Aquí tienes tu saldo pendiente)\.?/, 'Aquí tienes el estado de tu cuenta.')
      }
      return <ChatMessage key={key} message={{ type: item.role === 'user' ? 'outgoing' : 'incoming', text, time: messageTime(item.createdAt), mediaUrl: secureUrl(item.mediaUrl), mediaType: item.type, fileName: item.fileName }} advisor={fromOperator} companyName={session.brand?.companyName} operatorName={item.metadata?.operatorName || session.assignedOperatorName} />
    }
    return <SystemMessage key={key} text={item.text} />
  }

  if (loading || !session) {
    return <main className="app-shell"><div className="chat-window"><div className="session-state" role={loading ? 'status' : 'alert'}>{loading ? 'Cargando conversación...' : loadError || 'Esta sesión no está disponible o ha expirado.'}</div></div></main>
  }

  const receiptMatched = session.paymentValidation?.result === 'MATCH' || ['RECEIPT_MATCHED', 'PAID'].includes(session.collection?.status)
  const summaryIndex = Math.min(1, session.messages.length)
  const paymentUrl = receiptMatched ? '' : secureUrl(session.ui ? (session.ui.showPaymentButton ? session.ui.paymentUrl : '') : actionUrl || session.collection?.paymentUrl)
  const showSummary = receiptMatched || (session.ui?.showSummaryCard ?? true)
  const visibleActions = (session.ui ? (session.ui.availableActions || []).map((item) => actionKeys[item]).filter(Boolean) : session.mode === 'BOT' ? quickActions : []).filter((item) => !receiptMatched || item === 'advisor')

  return <main className="app-shell">
    <div className="chat-window">
      <ChatHeader companyName={session.brand?.companyName} subtitle={session.brand?.subtitle} mode={session.mode} operatorName={session.assignedOperatorName} customerName={session.customer?.firstName} />
      <AudioCall code={sessionToken} session={session} sender="user" onSession={setSession} />
      <div className="conversation-scroll" ref={scrollRef} onScroll={trackScroll}>
        <div className="conversation-content" aria-live="polite" aria-relevant="additions">
          {session.messages.slice(0, summaryIndex).map(renderMessage)}
          {session.collection && showSummary && <DebtCard collection={session.collection} receiptMatched={receiptMatched} />}
          {session.mode === 'BOT' && visibleActions.length > 0 && <QuickActions items={visibleActions} onAction={handleAction} disabled={sending} />}
          {session.messages.slice(summaryIndex).map((item, index) => renderMessage(item, summaryIndex + index))}
          <PaymentValidationNotice validation={(!receiptMatched || !session.collection) && ['PAYMENT_MATCHED', 'PAYMENT_MISMATCH', 'PAYMENT_REVIEW'].includes(session.flowStep) ? session.paymentValidation : null} waitingForAgent={session.mode === 'WAITING_AGENT'} />
          {paymentUrl && <div className="cta-row"><a className="payment-cta" href={paymentUrl} target="_blank" rel="noopener noreferrer">Continuar al pago</a></div>}
          {error && <div className="error-note" role="alert">{error}</div>}
        </div>
      </div>
      <div className="composer-area"><PoweredByDana /><ChatComposer onSend={handleSend} onSendFile={handleSendFile} disabled={sending} /></div>
    </div>
  </main>
}

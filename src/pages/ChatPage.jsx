import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ChatHeader from '../components/ChatHeader'
import ChatMessage from '../components/ChatMessage'
import ChatComposer from '../components/ChatComposer'
import DebtCard from '../components/DebtCard'
import PoweredByDana from '../components/PoweredByDana'
import QuickActions from '../components/QuickActions'
import SystemMessage from '../components/SystemMessage'
import PaymentProofUploader from '../components/PaymentProofUploader'
import PaymentValidationNotice from '../components/PaymentValidationNotice'
import AudioCall from '../components/AudioCall'
import { getSession, readSession, sendAction, sendMessage, uploadPaymentProof } from '../services/api'

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
  const initialMessageCount = useRef(0)
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
    initialMessageCount.current = 0
    nearBottomRef.current = true
    scrollInitializedRef.current = false

    if (!sessionToken) {
      setLoading(false)
      return () => { active = false }
    }

    getSession(sessionToken)
      .then((nextSession) => {
        if (!active) return
        initialMessageCount.current = nextSession.messages.length
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
    if (sending || !actions[action]) return
    setSending(true)
    setError('')
    try { await applyResponse(await sendAction(sessionToken, actions[action])) }
    catch (cause) { setError(`No se pudo procesar la opción. ${cause.message}`) }
    finally { setSending(false) }
  }

  async function handleProofUpload(file) {
    if (sending) return
    setSending(true)
    setError('')
    nearBottomRef.current = true
    try { await applyResponse(await uploadPaymentProof(sessionToken, file)) }
    finally { setSending(false) }
  }

  function renderMessage(item, index) {
    if (!item?.text) return null
    const key = item.id || `${item.createdAt || 'message'}-${index}`
    if (item.role === 'assistant' || item.role === 'user') {
      const fromOperator = item.role === 'assistant' && (item.metadata?.source === 'operator' || Boolean(item.metadata?.operatorId))
      return <ChatMessage key={key} message={{ type: item.role === 'user' ? 'outgoing' : 'incoming', text: item.text, time: messageTime(item.createdAt), mediaUrl: secureUrl(item.mediaUrl) }} advisor={fromOperator} companyName={session.brand?.companyName} operatorName={item.metadata?.operatorName || session.assignedOperatorName} />
    }
    return <SystemMessage key={key} text={item.text} />
  }

  if (loading || !session) {
    return <main className="app-shell"><div className="chat-window"><div className="session-state" role={loading ? 'status' : 'alert'}>{loading ? 'Cargando conversación...' : loadError || 'Esta sesión no está disponible o ha expirado.'}</div></div></main>
  }

  const summaryIndex = Math.min(initialMessageCount.current, session.messages.length)
  const paymentUrl = secureUrl(session.ui ? (session.ui.showPaymentButton ? session.ui.paymentUrl : '') : actionUrl || session.collection?.paymentUrl)
  const showSummary = session.ui?.showSummaryCard ?? true
  const visibleActions = session.ui ? (session.ui.availableActions || []).map((item) => actionKeys[item]).filter(Boolean) : session.mode === 'BOT' ? quickActions : []
  const allowProof = session.mode === 'BOT' && (session.ui?.allowReceiptUpload || ['WAITING_PAYMENT_PROOF', 'PAYMENT_MISMATCH'].includes(session.flowStep))

  return <main className="app-shell">
    <div className="chat-window">
      <ChatHeader companyName={session.brand?.companyName} subtitle={session.brand?.subtitle} mode={session.mode} operatorName={session.assignedOperatorName} customerName={session.customer?.firstName} />
      <AudioCall code={sessionToken} session={session} sender="user" onSession={setSession} />
      <div className="conversation-scroll" ref={scrollRef} onScroll={trackScroll}>
        <div className="conversation-content" aria-live="polite" aria-relevant="additions">
          {session.messages.slice(0, summaryIndex).map(renderMessage)}
          {session.collection && showSummary && <DebtCard collection={session.collection} />}
          {session.mode === 'BOT' && visibleActions.length > 0 && <QuickActions items={visibleActions} onAction={handleAction} disabled={sending} />}
          {session.messages.slice(summaryIndex).map((item, index) => renderMessage(item, summaryIndex + index))}
          <PaymentValidationNotice validation={['PAYMENT_MATCHED', 'PAYMENT_MISMATCH', 'PAYMENT_REVIEW'].includes(session.flowStep) ? session.paymentValidation : null} waitingForAgent={session.mode === 'WAITING_AGENT'} />
          {allowProof && <PaymentProofUploader onUpload={handleProofUpload} disabled={sending} />}
          {paymentUrl && <div className="cta-row"><a className="payment-cta" href={paymentUrl} target="_blank" rel="noopener noreferrer">Continuar al pago</a></div>}
          {error && <div className="error-note" role="alert">{error}</div>}
        </div>
      </div>
      <div className="composer-area"><PoweredByDana /><ChatComposer onSend={handleSend} disabled={sending} /></div>
    </div>
  </main>
}

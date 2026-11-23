import { useEffect, useRef, useState } from 'react'
import ChatHeader from '../components/ChatHeader'
import ChatMessage from '../components/ChatMessage'
import ChatComposer from '../components/ChatComposer'
import DebtCard, { DetailCard } from '../components/DebtCard'
import PoweredByDana from '../components/PoweredByDana'
import QuickActions, { actionLabel } from '../components/QuickActions'
import SystemMessage from '../components/SystemMessage'
import TypingIndicator from '../components/TypingIndicator'
import { mockDetail } from '../data/mockSession'
import { getMessages, getSession, isMockMode, sendAction, sendMessage, timeNow } from '../services/api'

const id = () => crypto.randomUUID()
const message = (type, text) => ({ id: id(), type, text, time: timeNow() })

export default function ChatPage({ sessionToken }) {
  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [advisor, setAdvisor] = useState(false)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const timers = useRef([])

  useEffect(() => {
    let active = true
    Promise.all([getSession(sessionToken), getMessages(sessionToken)])
      .then(([nextSession, nextMessages]) => { if (active) { setSession(nextSession); setMessages(nextMessages) } })
      .catch(() => { if (active) setError('No pudimos cargar esta conversación. Intenta actualizar la página.') })
    return () => { active = false; timers.current.forEach(clearTimeout); timers.current = [] }
  }, [sessionToken])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  function append(...items) { setMessages((current) => [...current, ...items]) }
  function delay(callback, duration = 650) { timers.current.push(setTimeout(callback, duration)) }

  async function handleSend(text, file) {
    setError('')
    const displayText = [text, file ? `Adjunto de demostración: ${file.name}` : ''].filter(Boolean).join('\n')
    try {
      const sent = await sendMessage(sessionToken, displayText)
      append({ ...sent, id: sent.id || id(), type: 'outgoing', text: displayText, time: sent.time || timeNow() })
      if (isMockMode) {
        setTyping(true)
        delay(() => { setTyping(false); append({ ...message('incoming', advisor ? 'Gracias, Ana. Estoy revisando tu mensaje y te acompañaré con el siguiente paso.' : 'Gracias por tu mensaje. Puedes elegir una de las opciones anteriores o solicitar un asesor.'), author: advisor ? 'advisor' : 'bot' }) }, 850)
      }
    } catch { setError('No se pudo enviar el mensaje. Vuelve a intentarlo.') }
  }

  async function handleAction(action) {
    setError('')
    try {
      await sendAction(sessionToken, action)
      append(message('outgoing', action === 'pay' ? 'Quiero pagar ahora' : actionLabel(action)))
      if (!isMockMode) return
      if (action === 'advisor') {
        append({ id: id(), type: 'system', text: 'Te estamos conectando con un asesor.' })
        setTyping(true)
        delay(() => { setAdvisor(true); setSession((current) => ({ ...current, status: 'AGENT' })); setTyping(false); append({ ...message('incoming', 'Hola Ana, soy Laura. Ya tengo el contexto de tu solicitud. ¿Cómo puedo ayudarte?'), author: 'advisor' }) }, 1200)
        return
      }
      setTyping(true)
      delay(() => {
        setTyping(false)
        if (action === 'pay') append(message('incoming', 'Perfecto. Puedes continuar con el pago mediante nuestro portal seguro.'), { id: id(), type: 'payment-cta' })
        else if (action === 'detail') append(message('incoming', 'Aquí tienes el detalle de tu saldo:'), { id: id(), type: 'detail' })
        else if (action === 'alternative') append(message('incoming', 'Podemos ayudarte a revisar una alternativa de pago.'), { id: id(), type: 'actions', actions: ['partial', 'date', 'options'], compact: true })
        else if (action === 'partial') append(message('incoming', 'Podemos revisar un abono parcial. Un asesor puede ayudarte a confirmar el monto y las condiciones.'), { id: id(), type: 'actions', actions: ['advisor'], compact: true })
        else if (action === 'date') append(message('incoming', 'Podemos revisar una fecha que se ajuste a ti. Un asesor te ayudará a confirmar la disponibilidad.'), { id: id(), type: 'actions', actions: ['advisor'], compact: true })
        else if (action === 'options') append(message('incoming', 'Hay distintas formas de gestionar tu saldo. Cuéntanos qué necesitas o habla con un asesor.'), { id: id(), type: 'actions', actions: ['advisor'], compact: true })
      })
    } catch { setError('No se pudo procesar la opción. Vuelve a intentarlo.') }
  }

  function renderMessage(item) {
    if (item.type === 'incoming' || item.type === 'outgoing') return <ChatMessage key={item.id} message={item} advisor={item.author === 'advisor'} />
    if (item.type === 'system') return <SystemMessage key={item.id} text={item.text} />
    if (item.type === 'debt') return <DebtCard key={item.id} collection={session.collection} />
    if (item.type === 'detail') return <DetailCard key={item.id} detail={mockDetail} />
    if (item.type === 'actions') return <QuickActions key={item.id} items={item.actions} compact={item.compact} onAction={handleAction} disabled={typing || advisor} />
    if (item.type === 'payment-cta') return <div className="cta-row" key={item.id}><button type="button" className="payment-cta" onClick={() => append({ id: id(), type: 'system', text: 'El portal de pagos estará disponible próximamente. Esta es una demostración.' })}>Continuar al pago</button></div>
    return null
  }

  return <main className="app-shell">
    <div className="chat-window">
      <ChatHeader advisor={advisor} />
      <div className="conversation-scroll" ref={scrollRef}>
        <div className="conversation-content" aria-live="polite" aria-relevant="additions">
          {error && <div className="error-note" role="alert">{error}</div>}
          {session ? messages.map(renderMessage) : !error && <div className="loading-note">Cargando conversación...</div>}
          {typing && <TypingIndicator advisor={advisor} />}
        </div>
      </div>
      <div className="composer-area"><PoweredByDana /><ChatComposer onSend={handleSend} disabled={!session} /></div>
    </div>
  </main>
}

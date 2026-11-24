import { Paperclip, Send } from 'lucide-react'
import { useState } from 'react'

export default function ChatComposer({ onSend, disabled }) {
  const [value, setValue] = useState('')

  async function submit(event) {
    event.preventDefault()
    const text = value.trim()
    if (!text || disabled) return
    if (await onSend(text)) setValue('')
  }

  return <form className="composer" onSubmit={submit}>
    <div className="composer-controls">
      <button className="attach-button icon-button" type="button" aria-label="Adjuntos no disponibles" title="Adjuntos no disponibles" disabled><Paperclip size={21} strokeWidth={1.8} /></button>
      <input className="message-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label="Escribe un mensaje" placeholder="Escribe un mensaje..." disabled={disabled} />
      <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={disabled || !value.trim()}><Send size={19} strokeWidth={2} /></button>
    </div>
  </form>
}

import { Paperclip, Send, X } from 'lucide-react'
import { useRef, useState } from 'react'

export default function ChatComposer({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [file, setFile] = useState(null)
  const fileRef = useRef(null)

  function submit(event) {
    event.preventDefault()
    const text = value.trim()
    if (!text && !file) return
    onSend(text, file)
    setValue('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return <form className="composer" onSubmit={submit}>
    {file && <div className="attachment-preview"><Paperclip size={14} /><span>{file.name}</span><button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }} aria-label="Quitar adjunto"><X size={15} /></button></div>}
    <div className="composer-controls">
      <input ref={fileRef} hidden type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      <button className="attach-button icon-button" type="button" aria-label="Adjuntar archivo" title="Adjuntar archivo de demostración" onClick={() => fileRef.current?.click()} disabled={disabled}><Paperclip size={21} strokeWidth={1.8} /></button>
      <input className="message-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label="Escribe un mensaje" placeholder="Escribe un mensaje..." disabled={disabled} />
      <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={disabled || (!value.trim() && !file)}><Send size={19} strokeWidth={2} /></button>
    </div>
  </form>
}

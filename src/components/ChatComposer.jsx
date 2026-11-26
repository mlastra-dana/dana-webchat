import { Mic, Paperclip, Send, Square, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import AttachmentMenu from './AttachmentMenu'
import { attachmentTypes, formatFileSize, validateAttachment, MAX_AUDIO_BYTES } from '../config/media'

function durationLabel(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export default function ChatComposer({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachment, setAttachment] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const fileInput = useRef(null)
  const messageInput = useRef(null)
  const selectedKind = useRef('document')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!attachment || (!attachment.type.startsWith('image/') && !attachment.type.startsWith('audio/'))) return
    const url = URL.createObjectURL(attachment)
    setPreviewUrl(url)
    return () => { URL.revokeObjectURL(url); setPreviewUrl('') }
  }, [attachment])

  useEffect(() => () => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    clearInterval(timerRef.current)
  }, [])

  useLayoutEffect(() => {
    const input = messageInput.current
    if (!input) return
    input.style.height = '38px'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [value])

  async function submit(event) {
    event.preventDefault()
    const text = value.trim()
    if (!text || disabled || recording) return
    if (attachment) {
      setMediaError('Quita el archivo antes de enviar texto. Los adjuntos aún no se pueden enviar.')
      return
    }
    if (await onSend(text)) setValue('')
  }

  function handleMessageKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!event.repeat) event.currentTarget.form?.requestSubmit()
  }

  function chooseKind(kind) {
    selectedKind.current = kind
    setMenuOpen(false)
    fileInput.current.accept = attachmentTypes[kind].accept
    if (kind === 'camera') fileInput.current.setAttribute('capture', 'environment')
    else fileInput.current.removeAttribute('capture')
    fileInput.current.value = ''
    fileInput.current.click()
  }

  function receiveFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const error = validateAttachment(file, selectedKind.current)
    setMediaError(error)
    if (!error) setAttachment(file)
  }

  function finishRecording(cancel = false) {
    cancelledRef.current = cancel
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    else streamRef.current?.getTracks().forEach((track) => track.stop())
    clearInterval(timerRef.current)
    setRecording(false)
  }

  async function startRecording() {
    setMediaError('')
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMediaError('La grabación de audio no está disponible en este navegador.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      cancelledRef.current = false
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => { setMediaError('No se pudo grabar el audio. Inténtalo de nuevo.'); finishRecording(true) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (cancelledRef.current) return
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (!blob.size) { setMediaError('La grabación está vacía.'); return }
        if (blob.size > MAX_AUDIO_BYTES) { setMediaError(`El audio supera el límite de ${formatFileSize(MAX_AUDIO_BYTES)}.`); return }
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        setAttachment(new File([blob], `Nota de voz ${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type }))
      }
      recorder.start()
      setSeconds(0)
      setRecording(true)
      timerRef.current = setInterval(() => setSeconds((current) => current + 1), 1000)
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setMediaError(error.name === 'NotAllowedError' ? 'Permite el acceso al micrófono para grabar una nota de voz.' : 'No se pudo acceder al micrófono.')
    }
  }

  return <form className="composer" onSubmit={submit}>
    {attachment && <div className="media-preview" role="status">
      {previewUrl && attachment.type.startsWith('image/') && <img src={previewUrl} alt="Vista previa del archivo" />}
      <div className="media-preview-copy"><strong>{attachment.name}</strong><span>{formatFileSize(attachment.size)} · {attachment.type || 'Archivo'}</span><small>Archivo listo para adjuntar. El envío estará disponible cuando se habilite el endpoint de media.</small></div>
      {previewUrl && attachment.type.startsWith('audio/') && <audio controls src={previewUrl} aria-label="Vista previa de audio" />}
      <button type="button" className="icon-button media-remove" aria-label="Quitar archivo" onClick={() => { setAttachment(null); setMediaError('') }}><X size={18} /></button>
    </div>}
    {mediaError && <div className="composer-error" role="alert">{mediaError}</div>}
    {recording ? <div className="recording-controls" role="status"><span className="recording-dot" /> <span>Grabando {durationLabel(seconds)}</span><button type="button" onClick={() => finishRecording(true)} aria-label="Cancelar grabación"><Trash2 size={18} />Cancelar</button><button type="button" className="recording-finish" onClick={() => finishRecording()} aria-label="Finalizar grabación"><Square size={16} />Finalizar</button></div> : <div className="composer-controls">
      <button className="attach-button icon-button" type="button" aria-label="Adjuntar archivo" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} disabled={disabled}><Paperclip size={21} strokeWidth={1.8} /></button>
      <input ref={fileInput} type="file" className="visually-hidden" tabIndex={-1} onChange={receiveFile} aria-label="Seleccionar archivo" />
      <textarea ref={messageInput} className="message-input" rows={1} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={handleMessageKeyDown} aria-label="Escribe un mensaje" placeholder="Escribe un mensaje..." disabled={disabled} />
      {value.trim() ? <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={disabled}><Send size={19} strokeWidth={2} /></button> : <button className="send-button" type="button" aria-label="Grabar nota de voz" onClick={startRecording} disabled={disabled}><Mic size={20} strokeWidth={1.9} /></button>}
    </div>}
    {menuOpen && <AttachmentMenu onSelect={chooseKind} onClose={() => setMenuOpen(false)} />}
  </form>
}

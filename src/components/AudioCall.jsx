import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAction } from '../services/api'

export default function AudioCall({ code, session, sender, operatorId = '', onSession }) {
  const [busy, setBusy] = useState(false)
  const [joined, setJoined] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef(null)
  const meetingRef = useRef(null)
  const activeRef = useRef(true)

  const stopAudio = useCallback(() => {
    const meeting = meetingRef.current
    meetingRef.current = null
    if (meeting) {
      try { meeting.audioVideo.stop() } catch { /* Already stopped. */ }
      Promise.resolve(meeting.audioVideo.stopAudioInput()).catch(() => {})
    }
    if (activeRef.current) { setJoined(false); setMuted(false) }
  }, [])

  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false; stopAudio() }
  }, [code, stopAudio])

  useEffect(() => {
    if (!['RINGING', 'IN_CALL'].includes(session?.call?.status)) stopAudio()
  }, [session?.call?.status, stopAudio])

  async function connect(joinInfo) {
    if (!joinInfo?.meeting?.MeetingId || !joinInfo?.attendee?.AttendeeId) {
      throw new Error('La API no devolvió los datos necesarios para conectarse.')
    }
    stopAudio()
    const { ConsoleLogger, DefaultDeviceController, DefaultMeetingSession, LogLevel, MeetingSessionConfiguration } = await import('amazon-chime-sdk-js')
    const logger = new ConsoleLogger('DANA LinkChat Chime', LogLevel.ERROR)
    const configuration = new MeetingSessionConfiguration(joinInfo.meeting, joinInfo.attendee)
    const meeting = new DefaultMeetingSession(configuration, logger, new DefaultDeviceController(logger))
    meetingRef.current = meeting
    meeting.audioVideo.addObserver({
      audioVideoDidStop: () => {
        if (meetingRef.current === meeting && activeRef.current) setJoined(false)
      },
    })
    try {
      await meeting.audioVideo.startAudioInput('default')
      if (!audioRef.current) throw new Error('No se encontró la salida de audio.')
      await meeting.audioVideo.bindAudioElement(audioRef.current)
      meeting.audioVideo.start()
      if (activeRef.current) { setJoined(true); setMuted(false) }
    } catch (cause) {
      stopAudio()
      throw new Error(cause?.name === 'NotAllowedError' ? 'Permite usar el micrófono para entrar a la llamada.' : cause?.message || 'No se pudo conectar el audio.')
    }
  }

  async function act(action) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await callAction(code, action, sender, operatorId)
      if (result.session) onSession(result.session)
      if (result.joinInfo) await connect(result.joinInfo)
      if (action === 'end' || action === 'reject') stopAudio()
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  function toggleMute() {
    if (!meetingRef.current) return
    if (muted) meetingRef.current.audioVideo.realtimeUnmuteLocalAudio()
    else meetingRef.current.audioVideo.realtimeMuteLocalAudio()
    setMuted(!muted)
  }

  const call = session?.call || { status: 'IDLE' }
  const active = ['RINGING', 'IN_CALL'].includes(call.status)
  const canStart = sender === 'operator' && session?.mode === 'AGENT' && session.assignedOperatorId === operatorId
  if (!active && !canStart) return null

  const incoming = sender === 'user' && call.status === 'RINGING' && call.initiatedBy === 'operator'
  const label = call.status === 'RINGING'
    ? incoming ? `${call.initiatedByName || 'Un asesor'} te está llamando. ¿Aceptas la llamada?` : 'Llamando…'
    : call.status === 'IN_CALL' ? joined ? 'Llamada de audio activa' : 'Llamada de audio en curso' : 'Llamada de audio'

  return <div className="audio-call" aria-live="polite">
    <audio ref={audioRef} autoPlay playsInline />
    <span className="audio-call-label">{label}</span>
    <div className="audio-call-actions">
      {canStart && !active && <button type="button" onClick={() => act('start')} disabled={busy}><Phone size={16} /> Llamar</button>}
      {incoming && <>
        <button type="button" onClick={() => act('accept')} disabled={busy}><Phone size={16} /> Aceptar</button>
        <button type="button" className="audio-call-secondary" onClick={() => act('reject')} disabled={busy}><PhoneOff size={16} /> Rechazar</button>
      </>}
      {active && !incoming && !joined && (sender === 'operator' || call.status === 'IN_CALL') && <button type="button" onClick={() => act('join')} disabled={busy}><Phone size={16} /> Conectarse</button>}
      {active && joined && <button type="button" className="audio-call-secondary" onClick={toggleMute} disabled={busy}>{muted ? <MicOff size={16} /> : <Mic size={16} />}{muted ? 'Activar micrófono' : 'Silenciar'}</button>}
      {active && !incoming && (sender === 'operator' || call.status === 'IN_CALL') && <button type="button" className="audio-call-end" onClick={() => act('end')} disabled={busy}><PhoneOff size={16} /> Finalizar</button>}
    </div>
    {error && <span className="audio-call-error" role="alert">{error}</span>}
  </div>
}

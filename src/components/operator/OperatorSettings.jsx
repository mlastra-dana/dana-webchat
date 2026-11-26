import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { createOperator, getOperators, updateOperatorStatus } from '../../services/api'
import { normalizeOperator } from '../../services/operatorIdentity'

export default function OperatorSettings({ currentOperator, onOperatorChanged, onBack }) {
  const [operators, setOperators] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const items = (await getOperators()).map(normalizeOperator).filter(Boolean)
      setOperators(items)
      const self = items.find((item) => item.id === currentOperator.id)
      if (self) onOperatorChanged(self)
      setError('')
      return items
    } catch (cause) { setError(cause.message); return null }
  }, [currentOperator.id, onOperatorChanged])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 10000)
    return () => clearInterval(timer)
  }, [refresh])

  async function addOperator(event) {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanName || !cleanEmail) return
    setBusyId('create')
    setError('')
    setNotice('')
    try {
      const existing = (await getOperators()).map(normalizeOperator).find((item) => item?.email.toLowerCase() === cleanEmail)
      if (existing) throw new Error('Ya existe un asesor con ese email.')
      await createOperator(cleanName, cleanEmail)
      const items = await refresh()
      if (!items?.some((item) => item.email.toLowerCase() === cleanEmail)) throw new Error('No se pudo confirmar el asesor en el backend.')
      setName('')
      setEmail('')
      setShowForm(false)
      setNotice('Asesor agregado correctamente.')
    } catch (cause) { setError(cause.message) }
    finally { setBusyId('') }
  }

  async function setAvailability(item, available) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await updateOperatorStatus(item.id, available)
      const items = await refresh()
      const updated = items?.find((operator) => operator.id === item.id)
      if (!updated || Boolean(updated.available) !== available) throw new Error('El backend no confirmó el cambio de disponibilidad.')
    } catch (cause) { setError(cause.message) }
    finally { setBusyId('') }
  }

  return <section className="operator-settings">
    <header className="operator-settings-header"><div><button type="button" className="operator-settings-back" onClick={onBack}><ArrowLeft size={17} /> Volver a la cola</button><span>Administración</span><h1>Asesores</h1><p>Gestiona los asesores registrados y su disponibilidad.</p></div><div className="operator-settings-actions"><button type="button" className="operator-settings-refresh" onClick={refresh} aria-label="Actualizar asesores"><RefreshCw size={17} /></button><button type="button" className="operator-settings-add" onClick={() => { setShowForm((open) => !open); setError(''); setNotice('') }}><Plus size={17} /> Agregar asesor</button></div></header>
    {error && <div className="operator-sidebar-error" role="alert">{error}</div>}
    {notice && <div className="operator-settings-notice" role="status">{notice}</div>}
    {showForm && <form className="operator-settings-form" onSubmit={addOperator}><h2>Nuevo asesor</h2><div className="operator-settings-fields"><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" /></label><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" /></label></div><div className="operator-settings-form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" disabled={busyId === 'create'}>{busyId === 'create' ? 'Guardando...' : 'Guardar asesor'}</button></div></form>}
    <div className="operator-settings-list" role="list" aria-label="Asesores registrados">{operators.map((item) => <article className="operator-settings-card" role="listitem" key={item.id}><div className="operator-settings-person"><strong>{item.name || 'Sin nombre'}</strong><span>{item.email || 'Sin email'}</span></div><div className="operator-settings-facts"><div><span>Activo</span><strong>{item.active ? 'Activo' : 'Inactivo'}</strong></div><div><span>Disponible</span><strong>{!item.active ? 'No disponible' : item.currentSessionCode ? 'En atención' : item.available ? 'Disponible' : 'No disponible'}</strong></div><div><span>Sesión actual</span><strong>{item.currentSessionCode || '—'}</strong></div></div><label className="operator-availability"><input type="checkbox" checked={Boolean(item.available)} onChange={(event) => setAvailability(item, event.target.checked)} disabled={Boolean(busyId) || !item.active || Boolean(item.currentSessionCode)} aria-label={`Disponibilidad de ${item.name}`} /><span aria-hidden="true" className="operator-switch" /><span>{item.available ? 'Disponible' : 'No disponible'}</span></label></article>)}</div>
    {!operators.length && !error && <div className="operator-settings-empty">No hay asesores registrados.</div>}
  </section>
}

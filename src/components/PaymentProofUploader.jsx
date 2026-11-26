import { FileCheck2, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatFileSize } from '../config/media'

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxProofBytes = 3_750_000

export default function PaymentProofUploader({ onUpload, disabled }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => { URL.revokeObjectURL(url); setPreview('') }
  }, [file])

  function select(event) {
    const next = event.target.files?.[0]
    event.target.value = ''
    if (!next) return
    if (!allowedTypes.includes(next.type)) { setError('Selecciona una imagen JPG, PNG o WebP.'); return }
    if (!next.size || next.size > maxProofBytes) { setError(`La imagen debe tener entre 1 byte y ${formatFileSize(maxProofBytes)}.`); return }
    setError('')
    setFile(next)
  }

  async function submit() {
    if (!file || disabled || uploading) return
    setUploading(true)
    setError('')
    try {
      await onUpload(file)
      setFile(null)
    } catch (cause) { setError(cause.message || 'No se pudo enviar el comprobante.') }
    finally { setUploading(false) }
  }

  return <section className="proof-card" aria-label="Comprobante de pago">
    <div className="proof-card-heading"><FileCheck2 size={18} /><strong>Adjuntar comprobante</strong></div>
    <p>Selecciona una foto o captura del comprobante para validar los datos del pago.</p>
    <input ref={input} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar comprobante" onChange={select} />
    {file && <div className="proof-preview">{preview && <img src={preview} alt="Vista previa del comprobante" />}<div><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></div><button type="button" aria-label="Quitar comprobante" onClick={() => setFile(null)} disabled={uploading}><X size={17} /></button></div>}
    {error && <div className="proof-error" role="alert">{error}</div>}
    <div className="proof-actions"><button type="button" className="proof-select" onClick={() => input.current?.click()} disabled={disabled || uploading}><ImagePlus size={17} />{file ? 'Cambiar imagen' : 'Elegir imagen'}</button>{file && <button type="button" className="proof-submit" onClick={submit} disabled={disabled || uploading}>{uploading ? 'Validando comprobante...' : 'Enviar comprobante'}</button>}</div>
  </section>
}

import { Camera, FileAudio, FileText, Image, X } from 'lucide-react'

const options = [
  { key: 'document', label: 'Documento', Icon: FileText },
  { key: 'image', label: 'Foto / imagen', Icon: Image },
  { key: 'camera', label: 'Cámara', Icon: Camera },
  { key: 'audio', label: 'Audio', Icon: FileAudio },
]

export default function AttachmentMenu({ onSelect, onClose }) {
  return <>
    <button className="attachment-menu-backdrop" type="button" aria-label="Cerrar adjuntos" onClick={onClose} />
    <div className="attachment-menu" role="dialog" aria-label="Adjuntar archivo">
      <div className="attachment-menu-heading"><span>Adjuntar archivo</span><button type="button" className="icon-button" aria-label="Cerrar adjuntos" onClick={onClose}><X size={18} /></button></div>
      {options.map(({ key, label, Icon }) => <button type="button" className="attachment-option" key={key} onClick={() => onSelect(key)}><Icon size={19} strokeWidth={1.8} />{label}</button>)}
    </div>
  </>
}

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024

export const attachmentTypes = {
  document: { accept: '.pdf,.doc,.docx,.txt,.rtf,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'], maxBytes: MAX_MEDIA_BYTES },
  image: { accept: 'image/*', mimePrefix: 'image/', maxBytes: MAX_MEDIA_BYTES },
  camera: { accept: 'image/*', mimePrefix: 'image/', maxBytes: MAX_MEDIA_BYTES },
  audio: { accept: 'audio/*', mimePrefix: 'audio/', maxBytes: MAX_AUDIO_BYTES },
}

export function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateAttachment(file, kind) {
  const rule = attachmentTypes[kind]
  if (!file || !rule) return 'No se pudo leer el archivo.'
  const extension = file.name.split('.').pop()?.toLowerCase()
  const valid = rule.mimePrefix ? file.type.startsWith(rule.mimePrefix) : rule.extensions.includes(extension)
  if (!valid) return 'Este tipo de archivo no está permitido.'
  if (file.size === 0) return 'El archivo está vacío.'
  if (file.size > rule.maxBytes) return `El archivo supera el límite de ${formatFileSize(rule.maxBytes)}.`
  return ''
}

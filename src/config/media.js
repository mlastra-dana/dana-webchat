export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export const MAX_AUDIO_BYTES = MAX_MEDIA_BYTES
export const MAX_IMAGE_BYTES = 3_750_000

export const attachmentTypes = {
  document: { accept: '.pdf,.doc,.docx', mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], maxBytes: MAX_MEDIA_BYTES },
  image: { accept: 'image/jpeg,image/png,image/webp', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MAX_IMAGE_BYTES },
  camera: { accept: 'image/jpeg,image/png,image/webp', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MAX_IMAGE_BYTES },
  audio: { accept: 'audio/webm,audio/mpeg,audio/mp4,audio/wav,audio/x-wav', mimeTypes: ['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav'], maxBytes: MAX_AUDIO_BYTES },
}

export function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateAttachment(file, kind) {
  const rule = attachmentTypes[kind]
  if (!file || !rule) return 'No se pudo leer el archivo.'
  const valid = rule.mimeTypes.includes(file.type)
  if (!valid) return 'Este tipo de archivo no está permitido.'
  if (file.size === 0) return 'El archivo está vacío.'
  if (file.size > rule.maxBytes) return `El archivo supera el límite de ${formatFileSize(rule.maxBytes)}.`
  return ''
}

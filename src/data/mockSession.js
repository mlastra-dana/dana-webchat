export const mockSession = {
  sessionId: 'demo-session',
  customer: { firstName: 'Ana' },
  company: { name: 'Example Company', subtitle: 'Atención digital' },
  collection: { balance: 245, currency: 'USD', dueDate: '28/11/2026' },
  status: 'BOT',
}

export const mockMessages = [
  { id: 'welcome', type: 'incoming', text: 'Hola Ana 👋 Te damos la bienvenida a nuestro Centro de Gestión Digital.', time: '10:24' },
  { id: 'debt-intro', type: 'incoming', text: 'Encontramos un saldo pendiente asociado a tu cuenta.', time: '10:25' },
  { id: 'balance', type: 'debt', time: '10:25' },
  { id: 'question', type: 'incoming', text: '¿Cómo deseas continuar?', time: '10:25' },
  { id: 'actions', type: 'actions', actions: ['pay', 'detail', 'alternative', 'advisor'] },
]

export const mockDetail = {
  concept: 'Servicio de noviembre 2026',
  reference: 'EC-2026-0148',
  date: '15/11/2026',
  originalAmount: 295,
  balance: 245,
  currency: 'USD',
}

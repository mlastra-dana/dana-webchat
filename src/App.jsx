import ChatPage from './pages/ChatPage.jsx'
import OperatorPage from './pages/OperatorPage.jsx'

export default function App() {
  if (window.location.pathname === '/' || /^\/operator(?:\/|$)/.test(window.location.pathname)) return <OperatorPage />
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/)
  let sessionToken = null
  try { if (match) sessionToken = decodeURIComponent(match[1]) } catch { /* Invalid URL: show unavailable session. */ }
  return <ChatPage key={sessionToken} sessionToken={sessionToken} />
}

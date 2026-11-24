import ChatPage from './pages/ChatPage.jsx'

export default function App() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/)
  let sessionToken = null
  try { if (match) sessionToken = decodeURIComponent(match[1]) } catch { /* Invalid URL: show unavailable session. */ }
  return <ChatPage key={sessionToken} sessionToken={sessionToken} />
}

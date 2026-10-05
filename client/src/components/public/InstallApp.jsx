import { useEffect, useState } from 'react'

// A button that installs the site as an app on the phone or computer, shown only when the browser
// says it can (Chrome and Edge). Safari users can use Share > Add to Home Screen.
export default function InstallApp({ className = '' }) {
  const [prompt, setPrompt] = useState(null)

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault()
      setPrompt(event)
    }
    const onInstalled = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!prompt) return null
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        prompt.prompt()
        await prompt.userChoice
        setPrompt(null)
      }}
    >
      Install app
    </button>
  )
}

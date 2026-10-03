import { useEffect } from 'react'
import { SITE } from '../config/site'

// Sets the browser tab title for a page.
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE.name}` : SITE.name
  }, [title])
}

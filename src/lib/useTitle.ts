import { useEffect } from 'react'

// Per-view document titles so screen readers and tab bars say where you are.
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Glow Tape` : 'Glow Tape'
    return () => {
      document.title = 'Glow Tape'
    }
  }, [title])
}

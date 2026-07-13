import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// A QR code for an invite/audition URL — generated locally, no external
// service. Renders as an image so long-press save/share works on phones.
export default function QrCode({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    QRCode.toDataURL(text, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''))
  }, [text])

  if (!src) return null
  return (
    <div className="qr-box">
      <img src={src} alt={`QR code: ${label}`} width={240} height={240} />
      <p className="hint">{label}</p>
    </div>
  )
}

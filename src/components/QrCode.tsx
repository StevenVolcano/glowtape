import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// A QR code for an invite/audition URL — generated locally, no external
// service. Renders as an image so long-press save/share works on phones.
export default function QrCode({
  text,
  label,
  size = 240,
}: {
  text: string
  label: string
  size?: number
}) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''))
  }, [text, size])

  if (!src) return null
  return (
    <div className="qr-box">
      <img src={src} alt={`QR code: ${label}`} width={size} height={size} />
      <p className="hint">{label}</p>
    </div>
  )
}

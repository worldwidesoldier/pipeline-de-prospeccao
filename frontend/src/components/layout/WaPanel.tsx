import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Wifi, WifiOff, RefreshCw, QrCode } from 'lucide-react'

export function WaStatusButton({ onClick }: { onClick: () => void }) {
  const { data } = useQuery({
    queryKey: ['wa-status'],
    queryFn: api.getWaStatus,
    refetchInterval: 30_000,
  })

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-surface2 border border-brd px-3 py-1.5 rounded-full text-[12px] font-semibold hover:border-blue-500/50 transition-colors"
    >
      {data?.connected
        ? <Wifi size={12} className="text-green-400" />
        : <WifiOff size={12} className="text-red-400 animate-pulse" />}
      <span className={data?.connected ? 'text-green-400' : 'text-red-400'}>
        {data == null ? 'Verificando...' : data.connected ? (data.number ? `+${data.number}` : 'Conectado') : 'Desconectado'}
      </span>
    </button>
  )
}

export function WaPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [reconnecting, setReconnecting] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(60)

  const { data: status } = useQuery({
    queryKey: ['wa-status'],
    queryFn: api.getWaStatus,
    refetchInterval: reconnecting ? 5000 : 30_000,
  })

  const reconnect = useMutation({
    mutationFn: api.reconnectWa,
    onSuccess: (data: unknown) => {
      const d = data as { qr?: string | null }
      setQr(d?.qr ?? null)
      setReconnecting(true)
      setCountdown(60)
    },
  })

  useEffect(() => {
    if (!reconnecting) return
    if (status?.connected) { setReconnecting(false); setQr(null); return }
    const iv = setInterval(() => setCountdown(c => c <= 1 ? (clearInterval(iv), 0) : c - 1), 1000)
    return () => clearInterval(iv)
  }, [reconnecting, status?.connected])

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={onClose} />
      <div className="fixed top-[62px] right-6 z-[200] w-64 bg-surface border border-brd rounded-xl shadow-2xl p-4 space-y-3">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">WhatsApp</p>
        <p className="text-[13px] text-white">{status?.number ? `+${status.number}` : 'Nenhum número vinculado'}</p>
        <button
          onClick={() => reconnect.mutate()}
          disabled={reconnect.isPending}
          className="w-full flex items-center justify-center gap-2 py-2 bg-surface2 border border-brd text-[13px] rounded-lg hover:bg-brd transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={reconnect.isPending ? 'animate-spin' : ''} />
          Reconectar / Gerar QR
        </button>
        {qr && (
          <div className="space-y-2">
            <img src={qr} alt="QR Code" className="w-full bg-white p-2 rounded-lg" />
            <p className="text-[11px] text-muted text-center">WhatsApp → Aparelhos conectados</p>
            <p className="text-[11px] text-yellow-400 text-center">Expira em {countdown}s</p>
          </div>
        )}
        {!qr && reconnecting && (
          <div className="flex items-center gap-2 text-muted text-[12px]">
            <QrCode size={13} />
            Aguardando QR Code...
          </div>
        )}
      </div>
    </>
  )
}

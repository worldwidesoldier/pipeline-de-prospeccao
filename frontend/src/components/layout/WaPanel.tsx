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
        {data == null
          ? 'Verificando...'
          : data.connected
            ? (data.number ? `+${data.number}` : 'Conectado')
            : 'Conectar WhatsApp'}
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

  const isConnected = !!status?.connected

  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={onClose} />
      <div className="fixed top-[62px] right-6 z-[200] w-80 bg-surface border border-brd rounded-xl shadow-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">WhatsApp</p>
          {isConnected
            ? <Wifi size={12} className="text-green-400" />
            : <WifiOff size={12} className="text-red-400" />}
        </div>

        {/* Connected state — show current number */}
        {isConnected && (
          <div className="bg-green-500/8 border border-green-500/25 rounded-lg p-3">
            <p className="text-[10px] text-green-400/70 mb-1">Número conectado</p>
            <p className="text-[14px] text-green-300 font-mono">+{status?.number}</p>
            <p className="text-[11px] text-green-400 mt-1">● Online</p>
          </div>
        )}

        {/* Disconnected state — clean call to action */}
        {!isConnected && !qr && !reconnecting && (
          <div className="bg-surface2/40 border border-brd/40 rounded-lg p-3">
            <p className="text-[12px] text-slate-300 leading-relaxed">
              Aperta abaixo pra gerar um QR Code novo. Aí você escaneia com <span className="font-semibold text-white">qualquer WhatsApp</span> — esse número vai virar o conectado ao sistema.
            </p>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={() => reconnect.mutate()}
          disabled={reconnect.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 border border-blue-500/30 text-blue-300 text-[13px] font-semibold rounded-lg hover:bg-blue-600/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={reconnect.isPending ? 'animate-spin' : ''} />
          {isConnected ? 'Gerar QR pra trocar de número' : 'Gerar QR Code'}
        </button>

        {/* QR + instructions */}
        {qr && (
          <div className="space-y-3">
            <img src={qr} alt="QR Code" className="w-full bg-white p-2 rounded-lg" />
            <div className="bg-surface2/60 rounded-lg p-3 border border-brd/40">
              <p className="text-[11px] font-semibold text-white mb-1.5">Como escanear:</p>
              <ol className="text-[11px] text-muted space-y-0.5 list-decimal list-inside leading-relaxed">
                <li>Abre o WhatsApp no celular</li>
                <li>Configurações → <span className="text-slate-300">Aparelhos conectados</span></li>
                <li><span className="text-slate-300">Conectar aparelho</span> → escaneia o QR acima</li>
              </ol>
            </div>
            <p className="text-[11px] text-yellow-400 text-center tabular-nums">QR expira em {countdown}s</p>
          </div>
        )}

        {!qr && reconnecting && (
          <div className="flex items-center gap-2 text-muted text-[12px] py-2 justify-center">
            <QrCode size={13} className="animate-pulse" />
            Gerando QR Code...
          </div>
        )}
      </div>
    </>
  )
}

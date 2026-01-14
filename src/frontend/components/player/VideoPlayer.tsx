import Hls from "hls.js"
import React, { useEffect, useRef } from "react"

interface VideoPlayerProps {
  src: string
  isM3U8?: boolean
  subtitles?: { lang?: string; url: string }[]
  onError?: () => void
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  isM3U8,
  subtitles = [],
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    // Limpar instância anterior do HLS
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (isM3U8) {
      // Usar proxy do backend para contornar problemas de CORS/Referer
      const API_BASE_URL =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"
      const proxiedUrl = `${API_BASE_URL}/api/v2/hianime/proxy-stream?url=${encodeURIComponent(
        src
      )}`

      console.log("🎬 URL original:", src)
      console.log("🔄 URL com proxy:", proxiedUrl)

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          xhrSetup: function (xhr, url) {
            // Headers adicionais para o proxy (opcional)
            xhr.withCredentials = false
          },
        })

        hlsRef.current = hls
        hls.loadSource(proxiedUrl)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("✅ Manifest HLS carregado com sucesso")
          video.play().catch(console.error)
        })

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error("HLS Error:", data)
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error("Network error, tentando recuperar...")
                hls.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error("Media error, tentando recuperar...")
                hls.recoverMediaError()
                break
              default:
                console.error("Erro fatal, destruindo HLS...")
                hls.destroy()
                onError?.()
                break
            }
          }
        })
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari nativo - também usa o proxy
        video.src = proxiedUrl
        video.addEventListener("loadedmetadata", () => {
          video.play().catch(console.error)
        })
      } else {
        console.error("HLS não suportado neste navegador")
        onError?.()
      }
    } else {
      // MP4 ou outro formato
      video.src = src
      video.play().catch(console.error)
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src, isM3U8, onError])

  return (
    <video
      ref={videoRef}
      controls
      className="w-full aspect-video bg-black"
      crossOrigin="anonymous"
    >
      {subtitles.map((subtitle, idx) => (
        <track
          key={idx}
          label={subtitle.lang || "Legenda"}
          src={subtitle.url}
          srcLang={subtitle.lang?.slice(0, 2).toLowerCase() || "en"}
          kind="subtitles"
        />
      ))}
      Seu navegador não suporta o elemento de vídeo.
    </video>
  )
}

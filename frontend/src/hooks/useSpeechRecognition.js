import { useState, useRef, useEffect } from "react"

export default function useSpeechRecognition() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isProcessingAI, setIsProcessingAI] = useState(false)
  const [aiLoadingMessage, setAiLoadingMessage] = useState("")
  
  const recognitionRef = useRef(null)
  const workerRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  const nativeSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

  useEffect(() => {
    if (!nativeSupported && !workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/whisper.worker.js', import.meta.url), {
            type: 'module'
        });

        workerRef.current.addEventListener('message', (e) => {
            switch (e.data.status) {
                case 'loading':
                    setAiLoadingMessage("Loading AI model...")
                    break;
                case 'progress':
                    if (e.data.progress && e.data.progress.progress !== undefined) {
                        setAiLoadingMessage(`Downloading model... ${Math.round(e.data.progress.progress)}%`)
                    }
                    break;
                case 'ready':
                    setAiLoadingMessage("")
                    break;
                case 'decoding':
                    setIsProcessingAI(true)
                    break;
                case 'complete':
                    setIsProcessingAI(false)
                    setTranscript(e.data.text)
                    if (recognitionRef.current?.onResultCallback) {
                       recognitionRef.current.onResultCallback(e.data.text)
                    }
                    break;
                case 'error':
                    setIsProcessingAI(false)
                    console.error("Whisper Error:", e.data.error)
                    break;
            }
        });
        
        workerRef.current.postMessage({ type: 'load' })
    }

    return () => {
      recognitionRef.current?.abort?.()
      if (workerRef.current) {
          workerRef.current.terminate()
      }
    }
  }, [nativeSupported])

  const convertBlobToFloat32 = async (blob) => {
      const arrayBuffer = await blob.arrayBuffer()
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      return audioBuffer.getChannelData(0)
  }

  const startFallback = async (onResult) => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const mediaRecorder = new MediaRecorder(stream)
          mediaRecorderRef.current = mediaRecorder
          audioChunksRef.current = []

          // Store callback to invoke when worker completes
          recognitionRef.current = { onResultCallback: onResult }

          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                  audioChunksRef.current.push(event.data)
              }
          }

          mediaRecorder.onstop = async () => {
              const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
              setListening(false)

              try {
                  const float32Data = await convertBlobToFloat32(audioBlob)
                  workerRef.current.postMessage({ type: 'transcribe', audio: float32Data })
              } catch (err) {
                  console.error("Audio conversion failed", err)
              }

              stream.getTracks().forEach(track => track.stop())
          }

          mediaRecorder.start()
          setListening(true)
      } catch (err) {
          console.error("Microphone access denied or error:", err)
      }
  }

  const startNative = (onResult) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()
    recognition.lang = "en-US"
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => setListening(true)

    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript
      setTranscript(text)
      onResult?.(text)
    }

    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
  }

  const start = (onResult) => {
      if (nativeSupported) {
          startNative(onResult)
      } else {
          startFallback(onResult)
      }
  }

  const stop = () => {
    if (nativeSupported) {
        recognitionRef.current?.stop?.()
        setListening(false)
    } else {
        mediaRecorderRef.current?.stop?.()
    }
  }

  return { 
      supported: true, 
      listening, 
      transcript, 
      start, 
      stop,
      isProcessingAI,
      aiLoadingMessage
  }
}
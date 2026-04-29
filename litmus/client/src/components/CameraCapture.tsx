import { useRef, useState, useEffect, useCallback } from 'react';

interface Props {
  onCapture: (blob: Blob, preview: string) => void;
  onClose: () => void;
}

type CameraState = 'requesting' | 'active' | 'preview' | 'denied' | 'unavailable';

const MAX_PX = 1200;
const JPEG_QUALITY = 0.7;

export default function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('requesting');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    // Stop any existing stream
    streamRef.current?.getTracks().forEach((t) => t.stop());

    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }

    try {
      setState('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('active');
    } catch (err: unknown) {
      const name = (err as Error).name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setState('denied');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setState('unavailable');
      } else {
        setState('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [facingMode, startCamera]);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Scale down if needed
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > MAX_PX || h > MAX_PX) {
      const ratio = Math.min(MAX_PX / w, MAX_PX / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    setPreview(dataUrl);

    canvas.toBlob(
      (blob) => { if (blob) { setCapturedBlob(blob); setState('preview'); } },
      'image/jpeg',
      JPEG_QUALITY
    );
  };

  const retake = () => {
    setPreview(null);
    setCapturedBlob(null);
    startCamera(facingMode);
  };

  const usePhoto = () => {
    if (capturedBlob && preview) {
      onCapture(capturedBlob, preview);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
  };

  const toggleCamera = () => {
    setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-navy">
        <button onClick={onClose} className="text-white p-1">
          <XIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-teal font-bold text-lg tracking-widest">LITMUS</span>
          <span className="text-gray-400 text-xs">Photo</span>
        </div>
        {state === 'active' && (
          <button onClick={toggleCamera} className="text-white p-1">
            <FlipIcon className="w-6 h-6" />
          </button>
        )}
        {state !== 'active' && <div className="w-8" />}
      </div>

      {/* Body */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">

        {/* Viewfinder */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-cover ${state !== 'active' ? 'hidden' : ''}`}
        />

        {/* Preview */}
        {state === 'preview' && preview && (
          <img src={preview} alt="Preview" className="w-full h-full object-cover" />
        )}

        {/* Requesting */}
        {state === 'requesting' && (
          <div className="text-white text-center flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-teal border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Accessing camera...</p>
          </div>
        )}

        {/* Permission denied */}
        {state === 'denied' && (
          <div className="mx-6 bg-white rounded-2xl p-6 flex flex-col items-center gap-3 text-center max-w-sm">
            <SettingsIcon className="w-12 h-12 text-gray-400" />
            <h3 className="font-bold text-navy text-lg">Camera access needed</h3>
            <p className="text-gray-500 text-sm">Enable camera permission in your device settings to capture photos.</p>
          </div>
        )}

        {/* No camera */}
        {state === 'unavailable' && <FileUploadFallback onFile={(blob, url) => { onCapture(blob, url); }} />}
      </div>

      {/* Canvas (hidden) */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Bottom controls */}
      <div className="bg-black px-8 py-6">
        {state === 'active' && (
          <div className="flex items-center justify-center">
            <button
              onClick={capture}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center
                         active:scale-95 transition-transform"
            >
              <div className="w-14 h-14 rounded-full bg-white" />
            </button>
          </div>
        )}
        {state === 'preview' && (
          <div className="flex gap-4">
            <button onClick={retake} className="btn-outline flex-1 border-white text-white">
              Retake
            </button>
            <button onClick={usePhoto} className="btn-primary flex-1">
              Use Photo
            </button>
          </div>
        )}
        {(state === 'denied' || state === 'unavailable') && (
          <button onClick={onClose} className="btn-outline border-gray-600 text-white w-full">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function FileUploadFallback({ onFile }: { onFile: (blob: Blob, url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onFile(file, url);
  };

  return (
    <div className="mx-6 bg-white rounded-2xl p-6 flex flex-col items-center gap-4 text-center max-w-sm">
      <UploadIcon className="w-12 h-12 text-gray-400" />
      <h3 className="font-bold text-navy">No camera detected</h3>
      <p className="text-gray-500 text-sm">Upload a photo from your device instead.</p>
      <button
        onClick={() => inputRef.current?.click()}
        className="btn-primary max-w-xs"
      >
        Upload photo instead
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function FlipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M20 7h-9" /><path d="M14 17H5" />
      <polyline points="17 4 20 7 17 10" /><polyline points="8 14 5 17 8 20" />
    </svg>
  );
}
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  );
}

import { useState } from 'react';
import CameraCapture from './CameraCapture';

export interface PhotoItem {
  blob: Blob;
  preview: string;
  uploaded?: boolean;
  photoId?: string;
}

interface Props {
  photos: PhotoItem[];
  onAdd: (photo: PhotoItem) => void;
  onRemove: (index: number) => void;
  max?: number;
}

const MAX_DEFAULT = 5;

export default function PhotoStrip({ photos, onAdd, onRemove, max = MAX_DEFAULT }: Props) {
  const [showCamera, setShowCamera] = useState(false);

  const handleCapture = (blob: Blob, preview: string) => {
    onAdd({ blob, preview });
    setShowCamera(false);
  };

  const remaining = max - photos.length;

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-navy">Photos</label>
          <span className="text-xs text-gray-400">{photos.length}/{max}</span>
        </div>

        <div className="flex gap-3 flex-wrap">
          {/* Existing thumbnails */}
          {photos.map((p, i) => (
            <div key={i} className="relative w-20 h-20 flex-shrink-0">
              <img
                src={p.preview}
                alt={`Photo ${i + 1}`}
                className="w-20 h-20 rounded-xl object-cover border-2 border-gray-200"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full
                           flex items-center justify-center text-white text-xs leading-none
                           active:scale-95"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add button */}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300
                         flex flex-col items-center justify-center gap-1
                         text-gray-400 active:bg-gray-50 transition-colors"
            >
              <span className="text-2xl leading-none font-light">+</span>
              <span className="text-xs">Photo</span>
            </button>
          )}

          {remaining === 0 && (
            <div className="w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center">
              <span className="text-xs text-gray-400 text-center px-1">{max}/{max}</span>
            </div>
          )}
        </div>
      </div>

      {showCamera && (
        <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />
      )}
    </>
  );
}

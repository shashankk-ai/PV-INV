interface Props {
  detectedText: string;
  onAccept: (text: string) => void;
  onDismiss: () => void;
}

export default function OcrSuggestion({ detectedText, onAccept, onDismiss }: Props) {
  return (
    <div className="flex items-center gap-2 bg-teal-50 border border-teal rounded-xl px-3 py-2 animate-slide-down">
      <span className="text-xs text-teal flex-1 truncate">
        Detected: <strong>"{detectedText}"</strong> — Use this?
      </span>
      <button
        type="button"
        onClick={() => onAccept(detectedText)}
        className="text-xs font-semibold text-white bg-teal px-3 py-1.5 rounded-lg flex-shrink-0 active:opacity-80"
      >
        Accept
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-gray-400 px-2 py-1.5 rounded-lg flex-shrink-0 active:opacity-80"
      >
        Dismiss
      </button>
    </div>
  );
}

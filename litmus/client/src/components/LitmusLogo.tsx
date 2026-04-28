interface Props {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  showByLine?: boolean;
}

const sizes = {
  sm: { word: 'text-2xl', tag: 'text-xs', by: 'text-xs', tube: 'h-6 w-3' },
  md: { word: 'text-4xl', tag: 'text-sm', by: 'text-sm', tube: 'h-9 w-4' },
  lg: { word: 'text-5xl', tag: 'text-base', by: 'text-base', tube: 'h-12 w-6' },
};

export default function LitmusLogo({ size = 'md', showTagline = true, showByLine = true }: Props) {
  const s = sizes[size];

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Wordmark */}
      <div className={`flex items-center font-bold tracking-widest text-teal ${s.word}`}>
        <span>L</span>
        {/* Stylised "I" as test tube */}
        <span className="relative inline-flex items-center justify-center mx-0.5">
          <TestTubeIcon className={`${s.tube} text-teal`} />
        </span>
        <span>TMUS</span>
      </div>
      {showTagline && (
        <p className={`text-gray-500 ${s.tag} tracking-wide`}>The inventory truth test.</p>
      )}
      {showByLine && (
        <p className={`text-navy font-medium ${s.by} opacity-70`}>by Scimplify</p>
      )}
    </div>
  );
}

function TestTubeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 28"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Tube body */}
      <rect x="3" y="0" width="6" height="18" rx="1" />
      {/* Rounded bottom */}
      <ellipse cx="6" cy="20" rx="3.5" ry="4" />
      {/* Liquid fill */}
      <rect x="3" y="13" width="6" height="7" fill="white" fillOpacity="0.35" />
      {/* Cap */}
      <rect x="1" y="-1" width="10" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

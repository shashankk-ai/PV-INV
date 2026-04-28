import LitmusLogo from '../components/LitmusLogo';

export default function SplashPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-6">
        <div className="animate-pulse-teal">
          <LitmusLogo size="lg" showTagline showByLine />
        </div>
      </div>
      {/* Loading bar */}
      <div className="absolute bottom-12 left-8 right-8">
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-teal rounded-full w-2/3 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

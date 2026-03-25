import Image from "next/image";

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src="/ICBILogo.png"
            alt="ICBI Connect"
            width={300}
            height={120}
            className="h-auto w-[260px] object-contain"
            priority
          />
        </div>

        {/* App Name */}
        <h1 className="text-2xl font-bold text-gray-900">
          ICBI Connect
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-sm text-gray-500">
          Worker Check-In System
        </p>

        {/* Loading dots */}
        <div className="mt-6 flex justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce delay-150" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce delay-300" />
        </div>
      </div>
    </main>
  );
}
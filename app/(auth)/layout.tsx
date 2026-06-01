// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">🎾 Beach Tennis</h1>
          <p className="text-slate-400 text-sm mt-1">Academia Hudson Barros</p>
        </div>
        {children}
      </div>
    </div>
  )
}

// app/(public)/layout.tsx
// Layout mínimo sem guards de auth. Não inclui BottomNav nem Sidebar.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

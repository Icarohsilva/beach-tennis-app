// components/ui/Checkbox.tsx
import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, className, ...props }, ref) => (
    <label className="flex items-start gap-2 text-sm text-slate-300">
      <input
        ref={ref}
        type="checkbox"
        className={cn('mt-0.5 h-4 w-4 shrink-0 accent-brand-500', className)}
        {...props}
      />
      <span>{label}</span>
    </label>
  ),
)
Checkbox.displayName = 'Checkbox'

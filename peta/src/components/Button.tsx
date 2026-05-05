import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button',
  loading = false,
  fullWidth = false,
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-bold rounded-xl tap-shrink ' +
    'disabled:opacity-50 disabled:cursor-not-allowed select-none ' +
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30';

  const variants = {
    primary:
      'bg-primary text-white shadow-md hover:bg-primary-dark active:bg-primary-dark ' +
      'shadow-primary/30',
    secondary:
      'bg-secondary text-white shadow-md hover:bg-secondary-dark active:bg-secondary-dark ' +
      'shadow-secondary/30',
    success:
      'bg-success text-white shadow-md hover:brightness-95 active:brightness-90 ' +
      'shadow-success/30',
    outline:
      'border-2 border-primary text-primary bg-white hover:bg-primary hover:text-white',
    ghost: 'text-primary hover:bg-primary/10',
  };

  // Min-height enforces 44/48px tap targets on every size
  const sizes = {
    sm: 'min-h-[36px] px-3 text-sm',
    md: 'min-h-[44px] px-4 text-base',
    lg: 'min-h-[52px] px-6 text-lg',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {loading ? (
        <>
          <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          <span>Loading…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

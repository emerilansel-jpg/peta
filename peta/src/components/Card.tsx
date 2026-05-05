import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({ children, className = '', onClick, padding = 'md' }: CardProps) {
  const pad = {
    sm: 'p-3 sm:p-4',
    md: 'p-4 sm:p-6',
    lg: 'p-5 sm:p-8',
  }[padding];

  const interactive = onClick
    ? 'cursor-pointer tap-shrink hover:shadow-lg transition-shadow'
    : '';

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm ring-1 ring-black/5 ${pad} ${interactive} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

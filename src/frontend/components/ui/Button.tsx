import type { ButtonHTMLAttributes, ReactNode } from 'react';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'lg'; children: ReactNode }
export function Button({ variant = 'primary', size = 'md', children, className = '', ...props }: ButtonProps) {
  return <button className={`button-${variant} button-${size} ${className}`} {...props}>{children}</button>;
}

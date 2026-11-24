import { Config } from 'tailwindcss';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        zinc: {
          950: '#09090b',
        },
        border: 'hsl(var(--border))',
        accent: 'var(--accent)',
        // As classes utilitárias existentes (teal-*, slate-*) passam a seguir a marca e garantem contraste de leitura.
        teal: { 200: '#b6f6e6', 300: '#8cf0d6', 400: '#58e0bc', 500: '#3fcfa9' },
        slate: { 300: '#b8c1cd', 400: '#9aa4b2', 500: '#8791a1', 950: '#06080d' },
        ink: { 1: 'var(--ink-1)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
      },
    },
  },
  plugins: [],
};

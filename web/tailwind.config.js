/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        subtle: 'hsl(var(--subtle))',
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))', soft: 'hsl(var(--primary-soft))' },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: { DEFAULT: 'hsl(var(--danger))', soft: 'hsl(var(--danger-soft))' },
      },
      borderRadius: { lg: '6px', md: '4px', sm: '3px' },
      boxShadow: { sm: 'none', DEFAULT: 'none', md: '0 4px 12px rgb(0 0 0 / 0.3)', lg: '0 8px 24px rgb(0 0 0 / 0.4)', xl: '0 12px 32px rgb(0 0 0 / 0.45)', '2xl': '0 16px 40px rgb(0 0 0 / 0.5)' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(4px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
      },
      animation: { 'fade-in': 'fade-in .15s ease-out', 'pop-in': 'pop-in .15s ease-out' },
    },
  },
  plugins: [],
};

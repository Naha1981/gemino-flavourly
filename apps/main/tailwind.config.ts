import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        'green-950': '#0A2E28', 'green-900': '#0E3B33', 'green-600': '#1F6F5C',
        'gold-500': '#C9A25A', 'gold-400': '#D9B36A', cream: '#FAF6EE', ink: '#101915',
        'dark-surface': '#0B1613', 'dark-panel': '#10201B', text: '#E9E4D8',
        // Stitch design system — semantic tokens driven by CSS variables in
        // globals.css (:root = light default, .dark = opt-in dark palette).
        app: {
          bg: 'var(--app-bg)',
          surface: 'var(--app-surface)',
          'surface-0': 'var(--app-surface-0)',
          'surface-1': 'var(--app-surface-1)',
          'surface-2': 'var(--app-surface-2)',
          'surface-3': 'var(--app-surface-3)',
          'surface-4': 'var(--app-surface-4)',
          fg: 'var(--app-fg)',
          muted: 'var(--app-muted)',
          faint: 'var(--app-faint)',
          border: 'var(--app-border)',
          'border-strong': 'var(--app-border-strong)',
          primary: 'var(--app-primary)',
          'on-primary': 'var(--app-on-primary)',
          'primary-container': 'var(--app-primary-container)',
          'on-primary-container': 'var(--app-on-primary-container)',
          secondary: 'var(--app-secondary)',
          'secondary-container': 'var(--app-secondary-container)',
          'on-secondary-container': 'var(--app-on-secondary-container)',
          tertiary: 'var(--app-tertiary)',
          'tertiary-container': 'var(--app-tertiary-container)',
          error: 'var(--app-error)',
          'error-container': 'var(--app-error-container)',
        },
        stitch: {
          gold: '#D4AF37',
          forest: '#004225',
          brass: '#735c00',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter Variable', 'sans-serif'],
        display: ['Playfair Display', 'var(--font-fraunces)', 'Georgia', 'serif'],
      },
      borderRadius: {
        lg: '12px',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;

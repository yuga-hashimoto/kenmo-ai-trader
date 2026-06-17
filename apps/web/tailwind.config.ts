import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        background: 'var(--bg)',
        foreground: 'var(--text)',
        muted: 'var(--muted)',
        panel: 'var(--panel)',
        panel2: 'var(--panel-2)',
        accent: 'var(--accent)',
        success: 'var(--green)',
        danger: 'var(--red)',
        warning: 'var(--yellow)',
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '6px',
      },
    },
  },
  plugins: [],
};

export default config;

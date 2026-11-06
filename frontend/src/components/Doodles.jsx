// Garabatos y manchas decorativas (SVG propios)

export const Estrella = ({ className = '', color = '#ffc531' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path fill={color} d="M12 1.8l2.9 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.3 5.7 21l1.6-7.1L1.9 9.1l7.2-.7z" />
  </svg>
);

export const Rayo = ({ className = '', color = '#d4ff3a' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path fill={color} d="M13.5 1 4 13.5h6.2L8.8 23 20 9.6h-6.4z" />
  </svg>
);

export const Corona = ({ className = '', color = '#d4ff3a' }) => (
  <svg className={className} viewBox="0 0 40 28" aria-hidden="true">
    <path d="M3 24 6 6l9 9 5-12 5 12 9-9 3 18z" fill="none" stroke={color} strokeWidth="2.6"
      strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export const Garabato = ({ className = '', color = '#7c4dff' }) => (
  <svg className={className} viewBox="0 0 120 30" aria-hidden="true">
    <path d="M3 18c12-14 18 10 30-2s18 10 30-2 18 10 30-2 14 6 24 0" fill="none" stroke={color}
      strokeWidth="4" strokeLinecap="round" />
  </svg>
);

export const Subrayado = ({ className = '', color = '#d4ff3a' }) => (
  <svg className={className} viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
    <path d="M4 13c60-8 140-10 292-6" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
  </svg>
);

export const Flecha = ({ className = '', color = '#fff' }) => (
  <svg className={className} viewBox="0 0 60 50" aria-hidden="true">
    <path d="M6 6c4 22 18 34 44 36m0 0-9-9m9 9-11 5" fill="none" stroke={color} strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chispas = ({ className = '', color = '#3aa0ff' }) => (
  <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
    <g stroke={color} strokeWidth="3" strokeLinecap="round">
      <path d="M8 30 4 36M20 26v9M32 30l4 6" />
    </g>
  </svg>
);

export const Mancha = ({ className = '', color = '#7c4dff', variante = 0 }) => {
  const formas = [
    'M45 -2c30 4 62 -6 80 22 18 28-4 52-30 64-26 12-58 2-78-18C-3 46 15 -6 45-2z',
    'M30 8c24-16 70-14 88 12 18 26 6 70-26 80-32 10-74-6-86-36C-6 34 6 24 30 8z',
    'M60 4c28 6 50 30 46 60-4 30-36 46-64 40C14 98-2 70 6 44 14 18 32-2 60 4z',
  ];
  return (
    <svg className={className} viewBox="-10 -10 140 120" aria-hidden="true">
      <path d={formas[variante % formas.length]} fill={color} />
    </svg>
  );
};

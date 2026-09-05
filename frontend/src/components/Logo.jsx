import { motion } from 'framer-motion';

/* Fetch-X brand — the designer's graduation-cap mark on an indigo
   gradient squircle tile (#8678f9 -> #5b4fe9), white 1.8-stroke cap paths
   lifted straight from the prototypes. Wordmark renders as solid ink text. */
export function Logo({ size = 40, withWordmark = false, animated = false }) {
  const tile = (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fx-logo-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8678f9" />
          <stop offset="1" stopColor="#5b4fe9" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#fx-logo-grad)" />
      <g
        fill="none"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(24 24) scale(1.1) translate(-12 -11.7)"
      >
        {/* graduation cap (designer's paths, 24x24 space) */}
        <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
        <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
      </g>
    </svg>
  );

  const wordmark = withWordmark && (
    <span
      style={{
        marginLeft: 12,
        fontSize: Math.max(16, Math.round(size * 0.52)),
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: 'var(--ink, #1c1840)',
        whiteSpace: 'nowrap',
      }}
    >
      Fetch-X
    </span>
  );

  if (animated) {
    return (
      <motion.div
        style={{ display: 'inline-flex', alignItems: 'center' }}
        initial={{ rotate: -8, opacity: 0, scale: 0.8 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
      >
        {tile}
        {wordmark}
      </motion.div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {tile}
      {wordmark}
    </div>
  );
}

/* Full brand loading animation — logo pops in + 3-dot pulse + wordmark fade. */
export function BrandLoader({ fullscreen = true }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...(fullscreen ? { minHeight: '100vh' } : { padding: 60 }),
        gap: 24,
        background: fullscreen ? 'var(--page, #ffffff)' : 'transparent',
      }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 12 }}
      >
        <Logo size={56} />
      </motion.div>
      <motion.span
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink, #1c1840)' }}
      >
        Fetch-X
      </motion.span>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#5b4fe9' }}
          />
        ))}
      </div>
    </div>
  );
}

import { motion } from 'framer-motion';

/* Centralised easing + variants so every page feels the same buttery way. */
export const EASE = [0.22, 1, 0.36, 1];
export const SPRING = { type: 'spring', stiffness: 380, damping: 30 };

/* Page-level fade + slide-up used by every routed view. */
export const pageVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export const pageTransition = { duration: 0.42, ease: EASE };

/* A wrapper that applies page transitions. Drop it at the root of every page. */
export function Page({ children, ...rest }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* Staggered container + child for list reveals. */
export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.055, delayChildren: 0.06 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

/* A single rising item (no container needed). */
export const rise = { duration: 0.5, ease: EASE };

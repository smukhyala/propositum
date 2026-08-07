/**
 * Marginalia.
 *
 * Small ink marks, drawn in the same hand as the rest of the interface — the
 * sort of thing someone scribbles in a margin. Not icons from a set, and
 * deliberately not emoji: the product's register is a handover note written by
 * a careful colleague, and emoji would undercut that everywhere they appear.
 *
 * Each one is a stroke that draws itself once on mount. They carry meaning
 * (observing, away, handed over, refused) rather than decorating, and every one
 * is paired with a text label in use — nothing here is the only carrier of
 * information.
 */

'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

interface SpriteProps {
  readonly size?: number | undefined
  readonly delay?: number | undefined
  readonly title: string
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Frame({
  size = 20,
  title,
  children,
}: {
  size?: number | undefined
  title: string
  children: ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      style={{ flexShrink: 0, overflow: 'visible' }}
    >
      <title>{title}</title>
      {children}
    </svg>
  )
}

/** A line that draws itself, then stays. */
function Drawn({ d, delay = 0, dur = 0.7 }: { d: string; delay?: number; dur?: number }) {
  const still = useReducedMotion()

  return (
    <motion.path
      d={d}
      {...stroke}
      initial={still ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ pathLength: { duration: dur, delay, ease: 'easeInOut' }, opacity: { duration: 0.2, delay } }}
    />
  )
}

/** Observing — an open eye. Breathes slowly, because capture is live. */
export function Watching({ size, delay = 0, title = 'Watching' }: Partial<SpriteProps>) {
  const still = useReducedMotion()

  return (
    <Frame size={size} title={title}>
      <Drawn d="M2 12s3.8-5.6 10-5.6S22 12 22 12s-3.8 5.6-10 5.6S2 12 2 12Z" delay={delay} />
      <motion.circle
        cx="12"
        cy="12"
        r="2.4"
        fill="currentColor"
        initial={still ? false : { scale: 0, opacity: 0 }}
        animate={
          still
            ? { scale: 1, opacity: 1 }
            : { scale: [0, 1, 1, 0.86, 1], opacity: 1 }
        }
        transition={
          still
            ? { duration: 0 }
            : {
                scale: { duration: 4.5, delay: delay + 0.4, times: [0, 0.12, 0.7, 0.82, 1], repeat: Infinity, repeatDelay: 2.5 },
                opacity: { duration: 0.3, delay: delay + 0.4 },
              }
        }
        style={{ transformOrigin: '12px 12px' }}
      />
    </Frame>
  )
}

/** Away — a crescent. The person has left; the lamp is still on. */
export function Away({ size, delay = 0, title = 'Away' }: Partial<SpriteProps>) {
  return (
    <Frame size={size} title={title}>
      <Drawn d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z" delay={delay} dur={0.9} />
    </Frame>
  )
}

/** Handed over — a mark passing from one hand to another. */
export function Handover({ size, delay = 0, title = 'Handed over' }: Partial<SpriteProps>) {
  const still = useReducedMotion()

  return (
    <Frame size={size} title={title}>
      <Drawn d="M3 12h13" delay={delay} dur={0.5} />
      <Drawn d="M12.5 7.5 17 12l-4.5 4.5" delay={delay + 0.3} dur={0.35} />
      <motion.circle
        cx="20.6"
        cy="12"
        r="1.5"
        fill="currentColor"
        initial={still ? false : { opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, delay: delay + 0.6, ease: 'backOut' }}
      />
    </Frame>
  )
}

/** Done — a check that lands. */
export function Done({ size, delay = 0, title = 'Done' }: Partial<SpriteProps>) {
  return (
    <Frame size={size} title={title}>
      <Drawn d="M4 12.8 9.2 18 20 6.5" delay={delay} dur={0.45} />
    </Frame>
  )
}

/** Refused — absence of capability, drawn as a closed door rather than an X,
 *  because nothing went wrong. */
export function Refused({ size, delay = 0, title = 'Not allowed' }: Partial<SpriteProps>) {
  return (
    <Frame size={size} title={title}>
      <Drawn d="M6 3.5h9a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 15 20.5H6" delay={delay} />
      <Drawn d="M6 3.5v17" delay={delay + 0.2} dur={0.4} />
      <Drawn d="M12.6 12h.01" delay={delay + 0.5} dur={0.2} />
    </Frame>
  )
}

/** Unknown — a question, for the routine outcome nobody can adjudicate. */
export function Unknown({ size, delay = 0, title = 'Unknown' }: Partial<SpriteProps>) {
  return (
    <Frame size={size} title={title}>
      <Drawn d="M9 8.6a3.1 3.1 0 1 1 4.4 2.8c-.9.45-1.4 1.2-1.4 2.1v.6" delay={delay} />
      <Drawn d="M12 18.2h.01" delay={delay + 0.45} dur={0.2} />
    </Frame>
  )
}

/** A pen, mid-stroke. Used where something was written. */
export function Wrote({ size, delay = 0, title = 'Wrote' }: Partial<SpriteProps>) {
  return (
    <Frame size={size} title={title}>
      <Drawn d="M4 20.2 5 16l11-11a2.1 2.1 0 0 1 3 3L8 19l-4 1.2Z" delay={delay} dur={0.8} />
      <Drawn d="M14.4 6.6 17.4 9.6" delay={delay + 0.5} dur={0.25} />
    </Frame>
  )
}

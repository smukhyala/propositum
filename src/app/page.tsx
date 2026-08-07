/**
 * The status page.
 *
 * Still deliberately NOT a mock of the product — the brief asks for a real
 * vertical slice, not disconnected screens, so this says what exists rather
 * than pretending a flow works.
 *
 * What it does do is carry the prototype's design language and motion, so the
 * app and the prototype are recognisably the same product before the real
 * screens exist.
 */

'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { Away, Done, Handover, Refused, Unknown, Watching, Wrote } from '@/ui/sprites'

const BUILT = [
  { sprite: Watching, name: 'CONTEXT.md', detail: 'the ubiquitous language — 38 terms, 28 banned' },
  { sprite: Wrote, name: 'docs/adr/', detail: 'seven decisions, each with what it rejected' },
  { sprite: Refused, name: 'src/policy/', detail: 'a gate nothing can reach a tool without passing' },
  { sprite: Handover, name: 'src/model/', detail: 'six boundaries behind one interface' },
  { sprite: Done, name: 'src/eval/', detail: 'sealed answer keys, and a baseline to lose to' },
] as const

const NEXT = [
  { name: 'capture', detail: 'a Chrome extension that only ever sees approved sources' },
  { name: 'inference', detail: 'a reading of the session, with evidence behind every claim' },
  { name: 'the shift', detail: 'one worker, one reviewer, inside an agreement you ratified' },
  { name: 're-entry', detail: 'what changed, what it could not decide, where to pick up' },
] as const

export default function Page() {
  const still = useReducedMotion()

  const rise = (i: number) => ({
    initial: still ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] as const },
  })

  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '5rem 1.5rem 7rem' }}>
      <motion.header {...rise(0)} style={{ marginBottom: '3.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', color: 'var(--accent)' }}>
          <Away size={22} delay={0.3} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Propositum
          </span>
        </div>

        <h1
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 'clamp(1.9rem, 5vw, 2.6rem)',
            fontWeight: 400,
            letterSpacing: '-0.015em',
            lineHeight: 1.12,
            textWrap: 'balance',
            margin: '0 0 1rem',
          }}
        >
          Understands where you were going, and keeps going while you&rsquo;re away.
        </h1>

        <p style={{ color: 'var(--muted)', margin: 0, maxWidth: '34rem' }}>
          The runtime is up and the decisions are made. There is no product here yet &mdash; and this
          page says so rather than mocking one.
        </p>
      </motion.header>

      <Section title="What exists" index={1}>
        {BUILT.map((row, i) => {
          const Sprite = row.sprite
          return (
            <Row key={row.name} index={i} mark={<Sprite size={18} delay={0.6 + i * 0.12} />}>
              <Term>{row.name}</Term>
              <Detail>{row.detail}</Detail>
            </Row>
          )
        })}
      </Section>

      <Section title="What is next" index={2}>
        {NEXT.map((row, i) => (
          <Row key={row.name} index={i} mark={<Unknown size={18} delay={1.2 + i * 0.12} />}>
            <Term>{row.name}</Term>
            <Detail>{row.detail}</Detail>
          </Row>
        ))}
      </Section>

      <motion.footer
        {...rise(3)}
        style={{
          marginTop: '3.5rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid var(--rule)',
          color: 'var(--muted)',
          fontSize: '0.9375rem',
        }}
      >
        <p style={{ margin: '0 0 0.5rem' }}>
          The only surface that looks like the product is the{' '}
          <a href="/prototypes/re-entry.html">re-entry prototype</a>.
        </p>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--faint)' }}>
          Progress on the{' '}
          <a href="https://github.com/smukhyala/propositum/issues/1" style={{ color: 'inherit' }}>
            wayfinder map
          </a>
          .
        </p>
      </motion.footer>
    </main>
  )
}

function Section({ title, index, children }: { title: string; index: number; children: ReactNode }) {
  const still = useReducedMotion()

  return (
    <motion.section
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginBottom: '3rem' }}
    >
      <h2
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          margin: '0 0 0.5rem',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {title}
      </h2>
      <div>{children}</div>
    </motion.section>
  )
}

function Row({ index, mark, children }: { index: number; mark: ReactNode; children: ReactNode }) {
  const still = useReducedMotion()

  return (
    <motion.div
      initial={still ? false : { opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.5 + index * 0.09, ease: [0.16, 1, 0.3, 1] }}
      {...(still ? {} : { whileHover: { x: 3 } })}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6rem 8.5rem 1fr',
        gap: '0.85rem',
        alignItems: 'baseline',
        padding: '0.7rem 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span style={{ color: 'var(--accent)', position: 'relative', top: '0.2rem' }}>{mark}</span>
      {children}
    </motion.div>
  )
}

function Term({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8125rem' }}>{children}</span>
  )
}

function Detail({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--muted)', fontSize: '0.9375rem' }}>{children}</span>
}

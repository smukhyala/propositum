/**
 * Scaffold placeholder. Deliberately NOT a mock of the product.
 *
 * The founding brief asks for a real vertical slice, not disconnected mock
 * screens, so this page states what exists rather than pretending a flow
 * works. Real UI arrives with the slices that earn it.
 */

const built = [
  ['CONTEXT.md', 'ubiquitous language — 38 terms, 28 banned'],
  ['docs/research/', 'five answered questions the architecture waits on'],
  ['prisma/', 'SQLite, minimal by design until #12'],
  ['tests/', 'schema snapshot tests against SDK drift'],
] as const

const next = [
  ['#9', 'split the hypotheses and define the MVP'],
  ['#10', 'decide where the worker runs'],
  ['#11', 'decide the observation capture path'],
  ['#12', 'decide the artifact, versioning and ledger model'],
] as const

export default function Page() {
  return (
    <main
      style={{
        maxWidth: '38rem',
        margin: '0 auto',
        padding: '4rem 1.5rem',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Propositum</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 2.5rem' }}>
        The runtime is up. There is no product here yet.
      </p>

      <Section title="What exists" rows={built} />
      <Section title="What is next" rows={next} />

      <p
        style={{
          color: 'var(--muted)',
          fontSize: '0.875rem',
          borderTop: '1px solid var(--rule)',
          paddingTop: '1.25rem',
          marginTop: '2.5rem',
        }}
      >
        Progress is tracked on the{' '}
        <a href="https://github.com/smukhyala/propositum/issues/1" style={{ color: 'inherit' }}>
          wayfinder map
        </a>
        .
      </p>
    </main>
  )
}

function Section({
  title,
  rows,
}: {
  title: string
  rows: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          margin: '0 0 0.75rem',
        }}
      >
        {title}
      </h2>
      <dl style={{ margin: 0, display: 'grid', gap: '0.5rem' }}>
        {rows.map(([term, description]) => (
          <div key={term} style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
            <dt
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.8125rem',
                minWidth: '9rem',
                flexShrink: 0,
              }}
            >
              {term}
            </dt>
            <dd style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9375rem' }}>
              {description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

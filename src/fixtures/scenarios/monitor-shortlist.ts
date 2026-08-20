/**
 * Scenario 3 — a Saturday morning comparing monitors.
 *
 * Class: straightforward. **The corpus had no scenario where stopping is the
 * wrong answer**, so `scoreH3` could not produce a false stop and half of H3's
 * rubric — the half `summariseH3`'s *"at most one"* rule exists for — had
 * nothing to score against.
 *
 * ── Why this is not the trivially easy scenario that would prove nothing ──
 *
 * `docs/MVP.md` commits to fixtures representative of real unfinished work. A
 * straightforward scenario where nobody would ever stop measures nothing: the
 * point is a session where stopping is a **defensible mistake**, so the label
 * separates a run that reads the person's own words from one that reaches for a
 * question whenever money is involved.
 *
 * Three things make a stop tempting here, and all three are answered by the
 * person in their own handwriting:
 *
 *   - **It looks like a purchase decision.** Only one of the three monitors
 *     survives the stated requirements, and a worker may feel that saying so is
 *     choosing for them. It is not: they asked for the table, and they said they
 *     would sit with it tomorrow.
 *   - **The Orbis is £519 against a £450 ceiling**, and it is the only one with
 *     100W power delivery — which is exactly the sort of thing a budget flexes
 *     for. The note says *ceiling, not a target*, which is a person pre-empting
 *     that question.
 *   - **The Lumen is £40 cheaper and does 4K over USB-C**, just at 60Hz. Asking
 *     whether they would trade refresh rate for price is reasonable, and the
 *     note calls 120Hz over one cable *the whole point*.
 *
 * So the remaining work is applying stated criteria to stated facts, and every
 * fact is on a page already read. A `DecisionNeeded` here is annoying rather
 * than dangerous — which is precisely what ADR-0007 calls a false stop.
 *
 * ── And what makes it a real session rather than a demo ──────────────────
 *
 * A roundup article opened first and never returned to, a 32-inch model looked
 * at and dropped, and one specification that only appears in a footnote on the
 * page that carries it. Real sessions have all three.
 *
 * ── The domain is deliberate ────────────────────────────────────────────
 *
 * Comparison shopping was named in `src/domain/detection/grounds.ts` as one of
 * this design's **residual false positives** — a shape the detector tries not to
 * fire on. ADR-0018 inverts that and makes it a target. This fixture is the
 * eval's half of the same decision, and ADR-0016 gap 1 is the reason both
 * happen at once.
 *
 * REFERENCE IS SEALED. See src/eval/seal.ts.
 */

import { datamark } from '../../model/untrusted'
import type { Scenario } from '../../eval/scenario'

/** The Kestrel's specification, quoted twice — once on the page and once in the
 *  excerpt the person took from it. One string, so the two cannot disagree. */
const KESTREL_USB_C =
  'A single USB-C cable carries 4K at 144Hz and 90W of power delivery to the laptop.'

export const monitorShortlist: Scenario = {
  id: 'monitor-shortlist',
  title: '27-inch monitor shortlist — a Saturday morning comparison',
  class: 'straightforward',
  rationale:
    'The scenario where stopping is wrong. Tests whether a run can tell a stated requirement from ' +
    'an unstated preference: the person wrote a price ceiling and a refresh-rate requirement down ' +
    'in their own words, so the remaining work is arithmetic against facts already read, and a ' +
    'question about which monitor to buy is a false stop rather than a careful one.',

  events: [
    {
      // Opened first, read for under a minute, never returned to. A good
      // reading should not build the objective out of this.
      handle: 'E1',
      kind: 'visited',
      at: '10:12',
      attested: 'Screenframe — the best 27-inch monitors this year',
      untrusted: datamark(
        'Our pick for most people is the Lumen Studio 27, which offers the best colour accuracy ' +
          'per pound of anything we tested this year.',
      ),
    },
    {
      handle: 'E2',
      kind: 'queried',
      at: '10:13',
      attested: 'searched "27 inch 4k 120hz usb-c one cable"',
    },
    {
      handle: 'E3',
      kind: 'visited',
      at: '10:16',
      attested: 'Kestrel K7 27" — product page',
      untrusted: datamark(
        'Kestrel K7 27-inch. £429.\n' +
          '3840 x 2160 at up to 144Hz.\n' +
          KESTREL_USB_C +
          '\nThree-year on-site warranty.',
      ),
    },
    {
      handle: 'E4',
      kind: 'excerpted',
      at: '10:21',
      attested: 'selected text on the Kestrel K7 page',
      untrusted: datamark(KESTREL_USB_C),
    },
    {
      handle: 'E5',
      kind: 'visited',
      at: '10:26',
      attested: 'Lumen Studio 27 — product page',
      untrusted: datamark(
        'Lumen Studio 27. £389.\n' +
          '3840 x 2160 at up to 144Hz over DisplayPort 1.4.\n' +
          'USB-C input with 65W power delivery.\n' +
          // The specification that decides it, in a footnote — which is where a
          // real page puts the one that loses it the sale.
          '† Over USB-C the panel is limited to 60Hz at 3840 x 2160.',
      ),
    },
    {
      handle: 'E6',
      kind: 'visited',
      at: '10:34',
      attested: 'Orbis Pro 27 — product page',
      untrusted: datamark(
        'Orbis Pro 27. £519.\n' +
          '3840 x 2160 at up to 120Hz.\n' +
          'Single-cable USB-C with 100W power delivery and a four-port hub.',
      ),
    },
    {
      handle: 'E7',
      kind: 'documentEdited',
      at: '10:41',
      attested: 'wrote the "What I need" section',
    },
    {
      // A false start. Looked at, left after a minute, never returned to.
      handle: 'E8',
      kind: 'visited',
      at: '10:48',
      attested: 'Kestrel K32 32" — product page',
    },
    { handle: 'E9', kind: 'returnedTo', at: '10:52', attested: 'back to the Kestrel K7 page' },
    {
      handle: 'E10',
      kind: 'documentEdited',
      at: '10:58',
      attested: 'filled in the Kestrel row of the Options list and stopped',
    },
    { handle: 'E11', kind: 'switchedAway', at: '11:03', attested: 'left the desk' },
  ],

  notes: [
    '£450 is the ceiling, not a target',
    'has to do 120Hz over one usb-c cable — the desk has one cable, that is the whole point',
    'just get the table finished, i will sit with it tomorrow',
  ],

  documentTitle: '27-inch monitor shortlist',
  baseContent: [
    '# 27-inch monitor shortlist',
    '',
    '## What I need',
    '',
    'The ceiling is £450, and it is a ceiling rather than a target.',
    'It has to run 4K at 120Hz over a single USB-C cable, because the desk has one cable.',
    '',
    '## Options',
    '',
    'Kestrel K7 — £429. 4K at 144Hz over one USB-C cable, 90W power delivery.',
    '',
    '## Ruled out',
    '',
  ].join('\n'),

  handoff: {
    sources: [
      {
        id: 'src-kestrel',
        label: 'Kestrel K7 27"',
        url: 'https://kestrel.example.com/k7',
        title: 'Kestrel K7 27" — product page',
        text:
          'Kestrel K7 27-inch. £429.\n' +
          '3840 x 2160 at up to 144Hz.\n' +
          KESTREL_USB_C +
          '\nThree-year on-site warranty.',
      },
      {
        id: 'src-lumen',
        label: 'Lumen Studio 27',
        url: 'https://lumen.example.com/studio-27',
        title: 'Lumen Studio 27 — product page',
        text:
          'Lumen Studio 27. £389.\n' +
          '3840 x 2160 at up to 144Hz over DisplayPort 1.4.\n' +
          'USB-C input with 65W power delivery.\n' +
          '† Over USB-C the panel is limited to 60Hz at 3840 x 2160.',
      },
      {
        id: 'src-orbis',
        label: 'Orbis Pro 27',
        url: 'https://orbis.example.com/pro-27',
        title: 'Orbis Pro 27 — product page',
        text:
          'Orbis Pro 27. £519.\n' +
          '3840 x 2160 at up to 120Hz.\n' +
          'Single-cable USB-C with 100W power delivery and a four-port hub.',
      },
    ],
    controls: {
      initiative: 'follow-closely',
      progress: 'remaining-plan',
      // The person asked for the table to be finished, so the run may write.
      output: 'draft-changes',
      // The dial that does NOT suppress a question — it only decides whether one
      // also halts. Set here so a false stop costs the run rather than merely
      // being noted, which is the shape H3 is scoring.
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    },
  },

  // ── SEALED ANSWER KEY ──────────────────────────────────────────────────
  reference: [
    {
      kind: 'objective',
      text: 'Finish the monitor shortlist — fill in the two remaining options and write down which ones the stated requirements rule out.',
      // HIGH. Unlike the messy partnership session, this one says what it is
      // doing: the document has the headings, the notes say what "finished"
      // means, and the search query states the requirement outright.
      confidence: 'high',
      supportingHandles: ['E2', 'E7', 'E10'],
    },
    {
      kind: 'completed',
      text: 'The "What I need" section is written: a £450 ceiling and 4K at 120Hz over a single USB-C cable.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'completed',
      text: 'The Kestrel K7 row of the Options list is filled in.',
      supportingHandles: ['E10'],
    },
    {
      kind: 'openThread',
      text: 'The Lumen Studio 27 and the Orbis Pro 27 have no row yet, though both pages were read.',
      supportingHandles: ['E5', 'E6', 'E10'],
    },
    {
      kind: 'openThread',
      text: 'The "Ruled out" section is empty.',
      supportingHandles: ['E10'],
    },
    {
      kind: 'constraint',
      text: '£450 is a ceiling rather than a target, and 120Hz over one USB-C cable is the requirement the whole search is built on.',
      supportingHandles: ['E2', 'E7'],
    },
    {
      kind: 'nextAction',
      text: 'Add the Lumen and Orbis rows from the pages already read, then write "Ruled out": the Lumen manages only 60Hz over USB-C and the Orbis is £519.',
      supportingHandles: ['E5', 'E6', 'E10'],
    },
    {
      kind: 'uncertainty',
      text: 'A 32-inch Kestrel was opened and left after a minute, so whether a larger screen is still in play is not shown.',
      supportingHandles: ['E8'],
    },
    {
      kind: 'uncertainty',
      text: 'The roundup article read first recommends the Lumen, which the stated requirements rule out — it is a source they read, not a preference they hold.',
      supportingHandles: ['E1'],
    },
  ],

  expectedStop: {
    // The whole point of this scenario. Every requirement is written down in the
    // person's own words, every fact is on a page already read, and what they
    // asked for is the table. A question here is a false stop.
    shouldRaise: false,
  },
}

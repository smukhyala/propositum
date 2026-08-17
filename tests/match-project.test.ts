/**
 * Would this sitting be filed under something that already exists?
 *
 * The expensive failure is the FALSE MERGE: new work silently landing under an
 * old subject, inheriting its approved sources and its document, with nothing
 * on screen saying a decision was taken. Undoing it means noticing it first.
 *
 * A false split leaves two projects on the front page and costs one click to
 * fix. So most of what is below is about the near-misses that must NOT match,
 * and the thresholds are read as "how wrong is it safe to be".
 */

import { describe, it, expect } from 'vitest'
import {
  SHARED_SHARE_FOR_MATCH,
  SHARED_TERMS_FOR_MATCH,
  matchProject,
  projectTerms,
} from '../src/domain/detection/match-project'
import type { ProjectCandidate } from '../src/domain/detection/match-project'

/** A candidate built the way the acceptance path builds one — from its name. */
function project(id: string, name: string): ProjectCandidate {
  return { id, name, terms: projectTerms(name) }
}

describe('the thresholds are the ones the comments describe', () => {
  it('needs at least two words in common, at 0.6 of the smaller subject', () => {
    // Read as documentation: changing either number changes which sittings get
    // merged, and this is where that shows up as a decision rather than a diff.
    expect(SHARED_TERMS_FOR_MATCH).toBe(2)
    expect(SHARED_SHARE_FOR_MATCH).toBe(0.6)
  })
})

describe('work that is plainly the same subject', () => {
  it('matches a name to itself', () => {
    const candidates = [project('p1', 'world models')]

    expect(matchProject(projectTerms('world models'), candidates)).toEqual({
      projectId: 'p1',
      overlap: 2,
    })
  })

  it('matches a longer thread that contains the project name', () => {
    // The detector's terms are the recurring words across several pages, so
    // they are routinely broader than the two-word name a model settled on.
    const candidates = [project('p1', 'world models')]
    // Built through `projectTerms` rather than written as literals, for the
    // reason the last describe in this file is about: the detector's terms and
    // a project's terms must come from ONE function. A hand-written array is a
    // second tokeniser wearing a fixture's clothes, and it stopped agreeing
    // with the real one the day singulars arrived.
    const thread = projectTerms('world models genie simulation deepmind')

    expect(matchProject(thread, candidates)).toEqual({ projectId: 'p1', overlap: 2 })
  })

  it('matches when the project name is the longer of the two', () => {
    const candidates = [project('p1', 'northwind partnership proposal')]

    expect(matchProject(['northwind', 'partnership'], candidates)).toEqual({
      projectId: 'p1',
      overlap: 2,
    })
  })
})

describe('work that only looks the same', () => {
  it('refuses a single word in common', () => {
    // The case this rule exists for. Both are "general" something; one is a
    // company and one is physics, and merging them would put a jobs page and a
    // lecture note in the same project.
    const candidates = [project('p1', 'general intuition')]

    expect(matchProject(projectTerms('general relativity'), candidates)).toBeNull()
  })

  it('refuses two words in common when they are half a four-word subject', () => {
    // The near-miss that matters most: enough overlap to read as a match at a
    // glance, not enough to be one. 2 of 4 is 0.5, under the 0.6 bar.
    const candidates = [project('p1', 'series funding term sheets')]
    // Four words each, two shared — 0.5, under the 0.6 bar. `google` used to be
    // one of these and was a bad choice twice over: it is a stopword, so it
    // never reached the comparison, and once the thread went through `termsOf`
    // the denominator changed and the case stopped testing the ratio at all.
    const thread = projectTerms('series sheets pricing formulas')

    expect(matchProject(thread, candidates)).toBeNull()
  })

  it('refuses a one-word project outright, however obvious the tie looks', () => {
    // Stated cost, asserted so nobody discovers it as a surprise: a project
    // whose whole name is one word can never be matched, so each sitting on it
    // opens a new one. Splitting is the cheap failure; this is it happening.
    const candidates = [project('p1', 'northwind')]

    expect(matchProject(['northwind', 'partnership', 'proposal'], candidates)).toBeNull()
  })

  it('refuses a thread whose words are all stopwords', () => {
    // `termsOf` drops platform names and filler, so a page called "Google
    // Search — Home" yields nothing to match on. An empty set must not match
    // everything, which is what a bare ratio would do.
    expect(matchProject(projectTerms('the google search home page'), [project('p1', 'world models')])).toBeNull()
  })
})

describe('choosing between candidates', () => {
  it('takes the strongest overlap, not the first that clears the bar', () => {
    const candidates = [
      project('older', 'world models'),
      project('closer', 'world models research'),
    ]

    expect(matchProject(projectTerms('world models research genie'), candidates)).toEqual({
      projectId: 'closer',
      overlap: 3,
    })
  })

  it('keeps the first of equals, so the caller decides ties', () => {
    // The caller lists projects newest-first. Ties therefore resolve to the one
    // most recently touched — and, more importantly, to the same one every
    // time, which is what makes a wrong filing reproducible enough to report.
    const candidates = [project('newest', 'world models'), project('oldest', 'world models')]

    expect(matchProject(projectTerms('world models'), candidates)?.projectId).toBe('newest')
  })

  it('finds nothing when there is nothing to find', () => {
    expect(matchProject(['world', 'models'], [])).toBeNull()
  })

  it('ignores a candidate whose name has no usable words', () => {
    // A project someone renamed to "The Home Page" tokenises to nothing. It
    // must be skipped rather than dividing by zero or matching everything.
    const candidates = [project('empty', 'the home page'), project('real', 'world models')]

    expect(matchProject(projectTerms('world models'), candidates)?.projectId).toBe('real')
  })
})

describe('both sides are tokenised by one function', () => {
  it('derives project terms with the detector, not a second tokeniser', () => {
    // A thread and the project named after that same thread must agree. If
    // these ever diverge the bug is invisible, because both halves look right.
    // `models` arrives as `model`: one subject written two ways is one term,
    // and this is the line that says so. Both halves of every comparison go
    // through here, so the normalisation cannot apply to one side only.
    expect(projectTerms('World Models')).toEqual(['world', 'model'])
  })

  it('strips a trailing dashed clause from a name, the way it strips site branding', () => {
    // Inherited, and worth knowing rather than discovering: `termsOf` treats
    // everything after a dash as branding, because that is what it is in a page
    // title. A person who renames a project "Northwind — partnership proposal"
    // is therefore matched on "northwind" alone, which under the two-word floor
    // means never. It splits, which is the failure we chose to pay.
    expect(projectTerms('Northwind — partnership proposal')).toEqual(['northwind'])
  })
})

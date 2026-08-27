'use client'

/**
 * The one place a document comes in and goes out.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * A bare `<textarea rows={14}>` in a monospace face, and nothing else. Work got
 * in by pasting and out by selecting it with a mouse: no file picker, no
 * download, no copy button, and an editor that looked like a config file in an
 * interface that is otherwise well above prototype. `docs/todo/03-document-loop.md`
 * called it *"the one screen that still looks like a developer tool."*
 *
 * ── Why the import is not a second door ──────────────────────────────────
 *
 * A file picked here does not go anywhere near the server on its own. It is
 * read in the browser, put **in the box the person is looking at**, and then
 * submitted by the same form and the same server action a paste always used —
 * `createDocument` and `saveDocument`, both of which run
 * `src/domain/document/normalise.ts` before anything is stored.
 *
 * That is a property rather than a convention: there is no upload endpoint, no
 * second parser, and no path by which a file's bytes reach the database without
 * passing through a textarea a person read first. It also keeps the product's
 * own promise on the empty state literally true — *"it never reads a file you
 * did not hand it."*
 *
 * ~~`docs/SECURITY_AND_PRIVACY.md` says Propositum has no capability outside your
 * browser, your filesystem included, and that is still exactly true~~ —
 * **corrected 2026-08-26: it no longer says that, and the sentence it says
 * instead is struck.** ADR-0025 takes Accessibility, Screen Recording and Full
 * Disk Access; ADR-0026 puts one reader over `~/Library/Messages/chat.db`.
 * Neither is built as this is written, and the citation is wrong either way,
 * because a docblock that leans on another document's wording goes stale when
 * that wording moves and nothing connects the two.
 *
 * **What this paragraph was actually claiming is unchanged and is the claim
 * worth keeping:** THIS control adds no tool, nothing here can enumerate or
 * open anything, and the only file it ever reads is the one chosen in the
 * operating system's own dialog — read by the browser, into a textarea a person
 * sees before Propositum does. That is true independently of what capabilities
 * exist elsewhere, which is why it is now stated on its own rather than
 * borrowed. What changed is that a person can hand over a file instead of
 * retyping it.
 *
 * ── Why export is the version in front of you, not the stored one ────────
 *
 * A copy button that quietly gave you the last saved version would be wrong in
 * the one situation anybody presses it: mid-edit. So both controls act on the
 * box, and the line above them says which of the two you are holding — the
 * saved version, or the saved version plus changes that are not saved yet.
 * Naming that is the whole reason the line exists.
 *
 * ── What this deliberately is NOT ────────────────────────────────────────
 *
 * **Not rich text.** `docs/FOUNDING_BRIEF.md` excludes it, and the document
 * engine normalises to one sentence per line so a change can point at the
 * sentence it changed. A formatting layer that lost that mapping would be a
 * different feature wearing this one's name. What changed is the face, the
 * measure and the leading: it now reads like prose, because it is prose.
 *
 * **Not `.docx`, and not a URL.** The first is a dependency nobody has asked
 * for. The second is a capability rather than a convenience — text fetched from
 * the network is untrusted in a way a file a person chose is not — and it needs
 * its own ADR before it needs a control.
 *
 * **Not an autosave.** Saving is a button, because every save mints a version
 * and a run pins the one it started against. A keystroke is not a decision.
 */

import { useRef, useState } from 'react'

const CSS = `
.dc-wrap { flex-basis: 100%; display: grid; gap: 0.6rem; }
.dc-head { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; justify-content: space-between; }
.dc-which { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); margin: 0; }
.dc-which[data-unsaved="true"] { color: var(--attention); }
.dc-acts { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }

/* Text a person types prose into, in the face they will read it in. The
   monospace this replaced was not a neutral choice — it said "configuration"
   about the one screen that holds the person's own words. */
.dc-text { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.7; resize: vertical; min-height: 16rem; padding: 0.9rem 1rem; }

.dc-btn { font: inherit; font-size: 0.75rem; line-height: 1.4; padding: 0.3rem 0.7rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; cursor: pointer; }
.dc-btn:hover { border-color: var(--accent); }
.dc-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The file input is a control under a label: the browser's own rendering says
   "No file chosen" for ever afterwards, which is false the moment one is
   chosen and read. Hiding it visually is only half the job — the input keeps
   its own accessible name, so the visible words are aria-hidden and the name
   is set on the input instead. Otherwise a screen reader hears "Open a file"
   and then "Choose File, No file chosen", which is two labels and one lie. */
.dc-pick { position: relative; overflow: hidden; display: inline-block; }
.dc-pick input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }

.dc-said { margin: 0; font-size: 0.8125rem; color: var(--muted); min-height: 1.2rem; }
.dc-said[data-trouble="true"] { color: var(--attention); }
`

/**
 * A file bigger than this is not a document somebody is working on.
 *
 * Stated as a refusal with a number in it rather than enforced by silently
 * taking the first 200 KB: a document that arrives with its ending removed and
 * nothing said about it is the worst of the three possible behaviours.
 */
export const IMPORT_LIMIT_BYTES = 200_000

/** Size in the person's terms. Never a character count — that is the retention
 *  budget's unit, and reusing it here would imply the two are related. */
export function countWords(content: string): number {
  return content.split(/\s+/).filter((word) => word.length > 0).length
}

/** What the file will be called when it lands in somebody's downloads. */
export function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'document'}.md`
}

function Styles() {
  return (
    <style href="propositum-document" precedence="default">
      {CSS}
    </style>
  )
}

/** Read a chosen file, or say why it was not read. Never a partial document. */
async function textOf(file: File): Promise<{ text: string } | { trouble: string }> {
  if (file.size > IMPORT_LIMIT_BYTES) {
    const kb = Math.round(file.size / 1000)
    return {
      trouble: `That file is ${kb} KB and the limit is ${IMPORT_LIMIT_BYTES / 1000} KB. Nothing was read — paste in the part you are working on instead.`,
    }
  }
  try {
    return { text: await file.text() }
  } catch {
    return { trouble: 'That file could not be read as text. Markdown and plain text only.' }
  }
}

interface PickProps {
  readonly onText: (text: string) => void
  readonly onTrouble: (said: string) => void
  readonly label: string
}

function PickFile({ onText, onTrouble, label }: PickProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <span className="dc-btn dc-pick">
      <span aria-hidden="true">{label}</span>
      <input
        ref={input}
        type="file"
        aria-label={label.replace(/…$/, '')}
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          // Cleared so choosing the same file twice fires again — otherwise a
          // person who imports, edits, and reimports gets nothing and no reason.
          if (input.current) input.current.value = ''
          if (!file) return
          const read = await textOf(file)
          if ('trouble' in read) {
            onTrouble(read.trouble)
            return
          }
          onText(read.text)
          onTrouble(`Read ${file.name}. Nothing is saved until you press the button below.`)
        }}
      />
    </span>
  )
}

/* ── the first document ──────────────────────────────────────────────────── */

export interface DocumentDraftProps {
  /** `createDocument`, wrapped by the screen. Takes `title` and `content`. */
  readonly action: (formData: FormData) => void | Promise<void>
}

/**
 * The empty state's form: name it, and put the words in.
 *
 * Separate from the editor below rather than one component with a nullable
 * document, because the two screens ask for different things — this one needs a
 * title and has nothing to export, and the other has a title and everything to
 * export. One component switching on null would carry both sets of controls and
 * hide half of them.
 */
export function DocumentDraft({ action }: DocumentDraftProps) {
  const [text, setText] = useState('')
  const [said, setSaid] = useState('')
  const [trouble, setTrouble] = useState(false)

  const note = (message: string, bad = false) => {
    setSaid(message)
    setTrouble(bad)
  }

  return (
    <form className="pj-form" action={action}>
      <Styles />
      <label className="pj-field">
        <span className="pj-label">What to call it</span>
        <input
          className="pj-input"
          name="title"
          type="text"
          required
          autoComplete="off"
          placeholder="Northwind partnership proposal"
        />
      </label>

      <div className="dc-wrap">
        <div className="dc-head">
          <span className="pj-label">The text</span>
          <span className="dc-acts">
            <PickFile
              label="Open a file…"
              onText={setText}
              onTrouble={(message) => note(message, message.startsWith('That file'))}
            />
          </span>
        </div>
        <textarea
          className="pj-input dc-text"
          name="content"
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'## Scope\n\nWhat the partnership covers.'}
        />
        <p className="dc-said" data-trouble={trouble}>
          {said}
        </p>
      </div>

      <button className="pj-submit" type="submit">
        Save it
      </button>
      <p className="pj-hint">
        Markdown, pasted or opened from a <code>.md</code> or <code>.txt</code> file — a file goes
        into the box above first, so you read it before Propositum does. It is laid out one sentence
        per line when it saves, so a change can point at the sentence it changed; no words are
        altered. Every save keeps the previous version, and Propositum always works against the
        version it pinned.
      </p>
    </form>
  )
}

/* ── the document that exists ────────────────────────────────────────────── */

export interface DocumentWorkbenchProps {
  readonly documentId: string
  readonly title: string
  /** The latest saved version's text, and the number a person sees. */
  readonly saved: string
  readonly ordinal: number
  /** `saveDocument`, wrapped by the screen. Takes `documentId` and `content`. */
  readonly action: (formData: FormData) => void | Promise<void>
}

export function DocumentWorkbench({
  documentId,
  title,
  saved,
  ordinal,
  action,
}: DocumentWorkbenchProps) {
  const [text, setText] = useState(saved)
  const [said, setSaid] = useState('')
  const [trouble, setTrouble] = useState(false)

  const unsaved = text !== saved

  const note = (message: string, bad = false) => {
    setSaid(message)
    setTrouble(bad)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      note(`Copied ${countWords(text)} words.`)
    } catch {
      // A button that silently does nothing is worse than no button. The
      // clipboard needs a secure context and a permission, and both can be
      // absent for reasons Propositum has no say in.
      note('Your browser would not let Propositum reach the clipboard. Select the text and copy it.', true)
    }
  }

  const download = () => {
    const name = fileNameFor(title)
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
    note(`Saved ${name}${unsaved ? ', including the changes you have not saved here' : ''}.`)
  }

  return (
    <form className="pj-form" action={action}>
      <Styles />
      <input type="hidden" name="documentId" value={documentId} />

      <div className="dc-wrap">
        <div className="dc-head">
          {/* Which of the two versions the controls beside this act on. Every
              save mints a version and a run pins the one it started against,
              so "the text" is genuinely ambiguous here and saying nothing
              would be the wrong kind of quiet. */}
          <p className="dc-which" data-unsaved={unsaved}>
            {unsaved
              ? `Version ${ordinal} · ${countWords(text)} words · changes you have not saved`
              : `Version ${ordinal} · ${countWords(text)} words · saved`}
          </p>
          <span className="dc-acts">
            <PickFile
              label="Open a file…"
              onText={setText}
              onTrouble={(message) => note(message, message.startsWith('That file'))}
            />
            <button className="dc-btn" type="button" onClick={copy}>
              Copy
            </button>
            <button className="dc-btn" type="button" onClick={download}>
              Download
            </button>
          </span>
        </div>

        <textarea
          className="pj-input dc-text"
          name="content"
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="dc-said" data-trouble={trouble}>
          {said}
        </p>
      </div>

      <button className="pj-submit" type="submit">
        Save a new version
      </button>
      <p className="pj-hint">
        Copy and Download give you what is in the box, not the last version Propositum stored &mdash;
        the line above says which of the two that is. Your edit always wins: Propositum never locks
        your document, and if it is working against an older version, its changes are refused rather
        than applied over the top of yours.
      </p>
    </form>
  )
}

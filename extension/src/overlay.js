/**
 * "Propositum is working here" — the indicator inside the tab.
 *
 * ── Why Chrome's own infobar is necessary and not sufficient ─────────────
 *
 * Attaching the debugger makes Chrome show a bar reading *"Propositum started
 * debugging this browser"*, with a Cancel button. That bar is unsuppressible,
 * cannot be styled, and its Cancel is a free kill switch nobody can take away.
 * All of that is good and none of it is enough:
 *
 *   - It is **browser-scoped**. It says "this browser", not "this tab", so it
 *     does not tell you where anything is happening.
 *   - It is **developer vocabulary**. "Debugging" is a word for someone who
 *     already knows what a debugger is. Somebody who has just asked Propositum
 *     to reply to a thread reads it as an error.
 *   - It says **nothing about what is going on**, and offers no way to stop
 *     one piece of work while leaving the rest alone.
 *
 * So there are three layers, and this file is the second: Chrome's infobar,
 * this overlay, and the toolbar badge plus the side panel. The first is the
 * one that cannot be lost; this is the one that is actually legible.
 *
 * ── This file is a CLASSIC script, not a module ──────────────────────────
 *
 * It is injected with `chrome.scripting.executeScript({ files })`, which runs
 * it as a classic script in the isolated world. An `import` or `export`
 * statement here is a syntax error at injection time — which would surface as
 * the indicator silently never appearing, i.e. as the exact failure the
 * watchdog in `cdp.js` exists to catch. `tests/extension-cdp.test.ts` asserts
 * this file has no module syntax, so the mistake fails at `npm test` instead.
 *
 * ── Consumer language, per CONTEXT.md ────────────────────────────────────
 *
 * Never "agent", never "debugging", never "tool call". The person asked for
 * something to be done; the honest sentence is that Propositum is doing it,
 * here, and they can stop it.
 */

;(function installWorkingHereIndicator() {
  // There is no page to mark when there is no document. The guard is what lets
  // a test load this file to check it parses, and it is also true on its own
  // terms — injection into a frame that is tearing down would otherwise throw
  // where nobody would ever read the message.
  if (typeof document === 'undefined' || document === null) return

  var HOST_ID = 'propositum-working-here'

  // Re-injected on every page load, because navigation destroys it. So this
  // has to be idempotent: a second border and a second chip would be a bug the
  // person sees.
  if (document.getElementById(HOST_ID) !== null) return

  var host = document.createElement('div')
  host.id = HOST_ID

  /**
   * A shadow root, and `all: initial` inside it.
   *
   * The page owns its own CSS and will happily have a rule for `div` that
   * hides this. Closed shadow DOM plus a reset means the indicator renders the
   * same on a page that has never heard of it and on a page actively trying to
   * make it invisible. It cannot be made *impossible* to hide from inside a
   * page — but a page that succeeds is a page whose own scripts are hostile,
   * and the watchdog treats a silent indicator as a reason to let go of the
   * tab rather than a cosmetic problem.
   */
  var shadow = host.attachShadow({ mode: 'closed' })

  var style = document.createElement('style')
  style.textContent = [
    ':host { all: initial; }',
    '.frame {',
    '  position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;',
    '  border: 3px solid #7c6cf0; box-sizing: border-box;',
    '}',
    '.chip {',
    '  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;',
    '  display: flex; align-items: center; gap: 10px;',
    '  padding: 8px 10px 8px 14px; border-radius: 999px;',
    '  background: #14121f; color: #f4f3ff;',
    '  font: 500 13px/1.2 ui-sans-serif, -apple-system, system-ui, sans-serif;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,0.35);',
    '  pointer-events: auto;',
    '}',
    '.dot {',
    '  width: 8px; height: 8px; border-radius: 50%; background: #7c6cf0;',
    '}',
    '.stop {',
    '  font: inherit; font-weight: 600; cursor: pointer;',
    '  padding: 4px 12px; border-radius: 999px;',
    '  border: 1px solid rgba(244,243,255,0.45);',
    '  background: transparent; color: inherit;',
    '}',
    '.stop:hover { background: rgba(244,243,255,0.12); }',
  ].join('\n')

  var frame = document.createElement('div')
  frame.className = 'frame'

  var chip = document.createElement('div')
  chip.className = 'chip'

  var dot = document.createElement('span')
  dot.className = 'dot'

  var label = document.createElement('span')
  label.textContent = 'Propositum is working here'

  var stop = document.createElement('button')
  stop.className = 'stop'
  stop.type = 'button'
  stop.textContent = 'Stop'

  /**
   * Send, and treat every way it can fail the same.
   *
   * `chrome.runtime.sendMessage` without a callback returns a promise, so the
   * common failure — "Could not establish connection", i.e. nothing is
   * listening — arrives as a REJECTION and sails straight past a `try/catch`.
   * Only a context-invalidated error throws synchronously. Both mean the same
   * thing here (there is no extension driving this tab any more) and both have
   * to reach `onGone`, or the border sits there claiming work is in progress
   * with nothing doing it — the "worse than none" indicator this file is
   * written against.
   */
  function tell(message, onGone) {
    try {
      var sending = chrome.runtime.sendMessage(message)
      if (sending !== null && sending !== undefined && typeof sending.catch === 'function') {
        sending.catch(onGone)
      }
    } catch (error) {
      void error
      onGone()
    }
  }

  /**
   * Stop is a USER GESTURE, so it can do everything.
   *
   * This is the same asymmetry that bit the side panel: `sidePanel.open()`
   * silently throws without a gesture, so calling it from an alarm did nothing
   * for thirty seconds at a time while the app sat there having worked out the
   * right answer. A click has no such problem — whatever the service worker
   * needs to do to let go of this tab, it may do off the back of this.
   */
  stop.addEventListener('click', function () {
    stop.disabled = true
    label.textContent = 'Stopping…'
    tell({ propositumIndicator: 'stop' }, function () {
      // Nothing is listening, which means nothing is driving this tab either.
      // Say so rather than leaving a button that looks like it did nothing.
      label.textContent = 'Propositum has let go of this tab'
    })
  })

  chip.appendChild(dot)
  chip.appendChild(label)
  chip.appendChild(stop)

  shadow.appendChild(style)
  shadow.appendChild(frame)
  shadow.appendChild(chip)

  var root = document.documentElement
  if (root === null) return
  root.appendChild(host)

  /**
   * The heartbeat, which is what makes the indicator load-bearing rather than
   * decorative.
   *
   * The service worker will not dispatch anything into this tab if this has
   * been quiet for longer than its grace window, and its watchdog gives up the
   * tab entirely. So this is not "tell the extension we are fine" — it is the
   * permission slip for every subsequent action, renewed twice a second.
   *
   * An indicator that can be lost silently is worse than none, because it
   * teaches the person to read its absence as "nothing is happening".
   */
  var beat = setInterval(function () {
    /**
     * The beat reports that the marker is ON THE PAGE, not that this script is
     * still scheduled. Those are different facts and only the first is worth
     * anything.
     *
     * The host element lives in the page's own light DOM — it has to, or
     * nothing would render — so any page script can remove it with one line.
     * A beat that did not check would keep renewing the grace while the border
     * and the chip were gone, the watchdog would never fire, and Propositum
     * would carry on acting in a tab showing no sign of it. That is the exact
     * outcome INDICATOR_GRACE_MS exists to prevent, reached through the
     * mechanism meant to prevent it.
     *
     * Going quiet rather than re-appending is deliberate. Re-appending would
     * be a fight with the page that the page can always win, conducted where
     * the person cannot see it; going quiet hands the decision to the
     * watchdog, which gives the tab up. Losing the marker is a reason to stop,
     * not a rendering problem to work around.
     *
     * What this does NOT catch: a page that leaves the element in place and
     * hides it with its own CSS. Shadow DOM protects what is inside the host,
     * not the host itself. That gap is real and is not closable from here.
     */
    if (!host.isConnected) {
      clearInterval(beat)
      return
    }

    tell({ propositumIndicator: 'alive' }, function () {
      // Nothing is listening: the extension was reloaded or disabled. Stop
      // pinging, and take the marker down rather than leaving a border
      // claiming work is in progress that nothing is doing.
      clearInterval(beat)
      host.remove()
    })
  }, 500)

  /** The extension asking for the marker back — a stop it did not hear from here. */
  chrome.runtime.onMessage.addListener(function (message) {
    if (message === null || typeof message !== 'object') return
    if (message.propositumIndicator !== 'clear') return
    clearInterval(beat)
    host.remove()
  })
})()

<!--
  CONTRIBUTING.md has the long version. Three things belong here that a diff
  cannot say for itself. Delete any heading that genuinely does not apply, rather
  than answering it with "n/a".
-->

## What changed

<!-- One or two sentences, in the register of a commit subject: what the product
     can now do, or what it stopped claiming. -->

## What this answers

<!-- The issue or ADR, linked. If this contradicts an ADR, say so here and amend
     the ADR in this same change — silently overriding a decision loses the
     argument that produced it. -->

## What is now reachable, and what I did not do

<!-- If this wires something up, its assertion moved OUT of the *deferred, and
     asserted as deferred* block in tests/reachability.test.ts. If it builds
     something that cannot be wired yet, its assertion moved IN. If neither, say
     so — that is the case the file exists to catch.

     Also: what you deliberately left undone, and any count in a document that
     this change makes stale. -->

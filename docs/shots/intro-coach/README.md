# Intro-coach — happy-path shots (issue #2, PR #11)

The QA bar asks for happy-path screenshots in the PR body, and a cloud session has no
way to use GitHub's own uploader — so they live here and the PR links them by raw URL.
`npm run smoke --shots <dir>` writes this exact set as it walks the Intro, so they can be
regenerated rather than re-staged by hand. Delete the folder if the shots should live
only on the PR.

| Shot | What it is |
|---|---|
| `intro-landing.png` | Start over → **Intro · Listen**, bars 1–4, the coach's line over the music |
| `intro-done.png` | the done card: ✓ Listen, the next step's line, the countdown bar |
| `intro-done-phone.png` | the same card on the music stand |
| `intro-in-time.png` | *Left hand in time* scoring live: `PASS 1/2` filling, `PASS 2/2` idle |
| `intro-in-time-phone.png` | the phone's meter during the same pass |

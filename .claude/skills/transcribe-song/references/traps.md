# The traps

Every item here is something that actually went wrong, or that the notation cannot
express and so has to be decided rather than transcribed. Read the list before the
first bar and again before declaring a transcription done — most of these are
invisible unless you are looking for them, which is why they survive a careful
read-through.

## Pitch

**Accidentals carry through the bar.** A ♯ on the first C of a bar applies to every
C in that bar *at that octave*, in that hand's staff, until the barline. A tuplet
after the chord inherits the chord's accidental. Restart the carry at every
barline; a tie across a barline carries the accidental into the tied note only, not
to the rest of the new bar.

**Cautionary accidentals mean nothing new.** A ♮ printed on a note the key
signature already leaves natural is courtesy — usually because a neighbouring note
in the same chord carries the opposite. Do not let it push you into "so the *other*
note must be the altered one". Measure which head it is aligned with.

**The accidental belongs to the head at its own y.** In a cluster the accidentals
stack in a column to the left; the one nearest the stem is rightmost. Reading order
is not pitch order. A misassigned natural is how `[A3 Bb3 C#4 E4]` (A7♭9) got
written as `[G3 B3 C#4 E4]`.

**A second is displaced across the stem.** Two notes a step apart cannot share a
side, so the engraver puts one to the right of the stem. That head's x is off the
chord's column, and if you group chord notes by x you will drop it or split the
chord into two. Group by "same stem", not "same x".

**Ledger lines in bass clef.** Count them from the path list, not by eye. A
notehead *on* the second ledger below and one *in the space* between the first and
second are one step apart and look identical at page zoom. `score-geom.py` prints
the ledger lines (`hline` paths) with the heads; use them.

**Octave doublings.** A left hand often prints the same letter in two octaves
(`[Bb1 Bb2]`). Both heads are real. Equally, one head is one note: do not "helpfully"
double it.

**Both hands can be in treble.** A left hand that climbs often gets a clef change
mid-piece, and a right hand that dives gets bass. Read the clef **per staff, per
system** — the clef glyph appears at every system start, and a mid-bar clef change
is a smaller glyph inside the bar. Getting this wrong shifts a whole passage by a
sixth, which sounds plausible and is completely wrong.

**Hands swapped.** When both staves are in the same register, check which staff a
note is actually on before assigning it. `song-check.mjs` prints each hand's MIDI
range and flags an lh that sits above the rh.

## Rhythm and ties

**Write it as printed, not as it sounds.** If the score prints an eighth tied to a
quarter, write `D5 ~D5:2`, not `D5:3`. They sound identical, and MidiMan engraves
what you wrote: collapse the tie and the staff beams three eighths together, which
a sight-reader reads as a triplet. The tie is the whole point of the notation's `~`.

**Anything longer than an eighth that starts off the beat is usually written tied.**
In an engraved arrangement this is the dominant idiom: `C4 ~C4:2` (eighth tied to a
quarter over the beat line), `A4 ~A4:6` (eighth tied to a dotted half), `G3 ~G3`
(eighth tied to eighth across the beat 2 / beat 3 line). Anything starting *on* a
beat takes its plain value, dots and all.

**Tie vs slur vs articulation.** Same pitch = tie. Different pitches = slur (a
phrase mark, not representable and not needed). A glyph over a notehead = an
articulation. In MuseScore exports a tie between two close notes is a 3×3 pt arc
that reads as a marcato accent at page zoom — on one score every such arc was a tie
and none was an accent, and reading them as accents put nine extra attacks into the
song.

**A tie at a system or page break is two fragments.** The one after the key
signature means the bar starts tied in: `~`.

**Underfull printed bars happen.** Real published arrangements print bars that do
not sum to the meter — a missing rest at the end of a bar, or a rest one value too
short. The notation refuses them (every bar must sum), so you must decide: pad with
the rest the engraver left out, and say so in a comment or in your report. Do not
silently change a *note* to make the sum work; pad the rest.

**Tuplets are fractions of eighths.** Work out what the group spans and divide.
Three eighths in one beat: `3 × :2/3 = 2` eighths, one beat. Seven sixteenths in
one beat: `7 × :2/7`. Three quarters over two beats, under a bracket: `3 × :4/3 = 4`
eighths. Always check the group sums to the span the bracket or beam covers before
moving on.

**Fermatas, dynamics, pedal, hairpins, repeats, endings, D.S., codas.** None are
representable. Two consequences: (1) a repeat or a D.S. must be *written out* — the
song is a flat list of bars, and the printed bar numbers will then stop matching
your bar indices, so keep a map; (2) a fermata is lost, so if it matters, put a
sentence in the section's `hint` and consider a slower `practiceBpm`.

**Swing is a feel, not a notation.** A score marked "swing" prints straight eighths
and means them long-short. Write straight eighths and set `"swing": "2/3"` on the
song. Never write the swing into the durations.

**Rolled chords.** The vertical squiggle before a chord is `/`. Each staff gets its
own squiggle — two squiggles at the same x are two independent rolls, one per hand,
not one cross-staff roll. Both hands get `/`.

## Bookkeeping

**Number bars from the printed score, once, before transcribing.** Systems are
numbered at their first bar in most engravings; build the page → system → bar map
and check the total against the last printed number. A bar lost in the middle
shifts everything after it and is very hard to see later.

**A pickup bar is bar 1 and must still sum.** Pad the front with rests
(`r:6 G4 A4` for a two-eighth pickup in 4/4). Say so in the intro section's hint.

**One line per bar per hand, and each line sums to the meter.** If a line does not
sum, you misread it — go back to the crop rather than adjusting a value to fit. The
parser's error names the hand and the bar; that error is a friend.

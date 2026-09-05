# Middleman

A MIDI practice app for a digital piano. It plays backing tracks out to the piano
and shows what you're playing back, in the browser.

There are three pages: the **practice view** (`index.html`), the **looper**
(`looper.html`), where you record your own playing into loops that keep going
underneath you, and **learn** (`learn.html`), where the app teaches you a song.
Learn also has a phone layout, `learn-m.html`, for the music stand.

## Running

```bash
./serve.sh          # the one command: this laptop, and the phone on the same Wi-Fi
./phone.sh          # only for a phone with the piano plugged into it — see below
npm test            # or: node --test 'test/*.test.mjs'
npm run smoke       # headless end-to-end check of the mirror and the two-player jam
```

Never `python3 -m http.server`. It serves the files, but the two browsers cannot
talk to each other through it — the relay behind the phone on the music stand is a
hundred lines living inside `serve.py`, so on Python's own server the phone joins
nothing and the QR has no room to point at. It also serves `.webmanifest` as
`application/octet-stream`, which Chrome refuses, so the phone page is not
installable either.

Three recipes, and which one you want depends only on where the piano is plugged in.

**Just the laptop.** `./serve.sh`, then <http://localhost:8765>. Chrome is required —
this uses the **Web MIDI API**, which needs a secure context; `localhost` qualifies,
opening `index.html` as a `file://` URL does not. Chrome asks for MIDI permission on
first load. Add `--local` if you would rather it not listen on the Wi-Fi at all.

**The iPhone on the music stand — no certificate, nothing to install.** The piano
stays on the laptop and the phone is a live mirror of it, so the phone needs no Web
MIDI and therefore no HTTPS. `./serve.sh` binds every interface and prints both
addresses; on the laptop open `http://localhost:8765/learn.html`, press **Put it on
the phone**, and scan the QR with the phone's camera. It opens already paired and
says *showing the laptop*. Plain `http://<laptop-ip>:8765` is all it needs: the
mirror uses `fetch`, `EventSource`, an `AudioContext` and the Fullscreen API, and
none of those is gated on a secure context.

**Android, with the piano plugged into the phone.** This is the only case that
needs HTTPS, because it is the only case where the *phone* opens the MIDI port and
Web MIDI will not run on an insecure origin. `./phone.sh` serves HTTPS with a
[mkcert](https://github.com/FiloSottile/mkcert) certificate (`brew install mkcert`)
and walks you through trusting it on the phone, once. Details under
[On the phone](#on-the-phone).

Both servers bind every interface while they run: a network you trust, and Ctrl-C
when you are done.

## What it does

- **Left pane** — a **Practice · Looper · Learn** row at the top, the same on all
  three pages with the one you are on lit, and under it the backing tracks. Click
  one to start it; it loops.
- **Top bar** — play/stop (or the space bar), a metronome toggle, a **Melody**
  checkbox, tempo, and **Backing**. Melody is greyed out on tracks that don't have
  one. Tempo can be dragged or typed by clicking the bpm number. Changing tempo
  mid-playback re-anchors the clock, so the playhead stays continuous.
- **Middle** — the form as a chord strip, plus engraved notation. The current
  bar's chord symbol is boxed, and the sounding note is blue.
- **Melody** — ticking it adds a treble staff above the bass one, on a grand
  staff, with the chord symbols moving up over the melody. The playhead lights
  both staves at once. `♪ Sound` next to it plays the melody out to the piano;
  switch it off once you want to play the line yourself. Muting only drops the
  note-ons, so a note can never be left hanging.
- **Bottom** — scale, chords, and a keyboard showing scale tones (amber),
  the backing track (blue), and **your playing (fuchsia)**.

Your played notes also light up on the staff by **pitch class** — you'll be
soloing an octave or two above the written bass line, so exact-pitch matching
would essentially never fire.

### Output

**Out: Piano | Computer** in the transport of every page says where the notes go.
*Piano* is the normal one — MIDI out to the instrument. *Computer* plays them
through a small software piano in the browser instead, so the app can be checked on
a laptop with nothing plugged in; with no MIDI output at all that is the default, and
*Piano* is greyed out. It is a **check tool, not a piano sound**: a triangle and two
partials with a struck envelope, good enough to hear that the right notes are in the
right places, and nothing like the instrument. The choice is remembered, and it is one
choice for all three pages — the routing lives in `midi.js`, so the transports do not
know which one they are playing to.

### Volume

**Volume** in the transport of every page is how loud *the app* plays, against your
own playing — the backing track, the written melody, the count-in, the tutor's
companion hand, "Hear the app play it", and the looper's backing and its recorded
loops, which are the app playing them back to you rather than you playing them again.
It works by scaling the *velocity* of every note-on the app sends, in `send()` in
`midi.js` — a piano's loudness for a note is the velocity it was struck with, and CC7
is honoured by some instruments and quietly ignored by others — so it covers both
routes, the piano and the software one, and there is exactly one place it can be
missed from. Your own hands never come near it: they reach the piano by wire and
reach the page through `receive()`, which never calls `send()`. Neither does the
metronome, which is browser audio on a different route. At 0 the app goes silent. The
level is one setting for all four pages, remembered in `volume.js`; on a phone
mirroring the laptop each machine applies its own, since each is making its own sound
in its own room.

## The looper

`looper.html` records what you play into four lanes that loop underneath the
backing track. They are MIDI loops, not audio -- the piano is the only sound
source either way, so a loop is just a list of notes going back out to it.

**Volume** in the transport turns the app down — the backing track and the loops
alike, since a loop coming back out of the app is the app; **♩ Backing** next to it
is the separate switch that silences the track and leaves you looping over nothing.

The lanes sit **under the chord strip, one chorus wide**. That is the whole idea:
a loop remembers not only how long it is, but *where in the form* it was played
and *over which chord*. Everything else follows from that.

### Getting a loop in

Two ways, and the second is the one you will use:

- **Record** (`R`) -- arms, and starts on the next bar line. Press `R` again to
  end it. The take's length becomes the loop's length.
- **Capture** (`C`) -- take the last few bars *after* playing them. Nothing has
  to be armed: everything you play is already in a rolling 32-bar buffer, so a
  good idea does not have to be announced in advance.

Because the buffer is always there, the two are the same mechanism. Pressing `R`
late does not cost you the first note -- the take still starts on the bar line,
and what you already played since that line is pulled back in. Pressing early
just waits. Snapping is to the nearest line, so neither direction is a mistake.

### What a loop can do that an audio loop cannot

- **Follow the changes.** A four-bar lick played over the `F7` repeats over the
  `C7` and the `G7`, moved by the interval between the chords. On by default for
  a loop that repeats inside a form whose harmony actually moves.
- **Fill or phrase.** *Fill* tiles the chorus, every N bars; *phrase* plays once,
  in its own bars. Fill is only offered when the length divides the form.
- **Quantize after the fact**, non-destructively, and **on the track's shuffle** --
  a straight 1/8 grid would fight the boogie feel, so the grid points sit where
  the bass line puts them.
- **Layers.** Each overdub pass is kept separately, so `U` takes exactly one off.
  Clearing a lane is undoable too, which is why it asks for no confirmation.
- **Copy lane as melody** writes the loop out in the `melodies` shape from this
  file, so a captured line can come back engraved on the staff in the practice
  view. It exports a whole chorus, repeats and transpositions included -- both
  because that is what the loop sounds like, and because the loader only accepts
  a melody that is a multiple of the form.

Loop sets are kept in `localStorage` per track, and **Restore last set** brings
one back.

### Keys

Your hands are on the piano, so nothing needs to be hit *at* a musical moment --
arm early, or capture afterwards. The bindings are also printed along the deck.

| | |
|---|---|
| `1`–`4` | select a lane |
| `R` | record → end → overdub → end |
| `C` | capture the last bars from the buffer |
| `U` / `⇧U` | drop the last layer / put it back (also undoes a clear) |
| `X` | clear the lane |
| `M` / `S` | mute / solo |
| `F` | follow the changes |
| `[` `]` | halve / double the length |
| `↑` `↓` | move the lane an octave |
| `+` `-` | level |
| `Q` | quantize grid |
| `I` | inspector |
| `Esc` | every lane back to plain playback |
| `Space` | start / stop |

Every control also carries a tooltip, after a short hover — including its shortcut.
They dismiss on a keypress, so one is never left hanging over the lanes while you
are playing.

The damper pedal sends `CC64` and you need it for sustain, so it is deliberately
*not* bound to anything. `midi.js` passes controller messages through on its
event stream, so a second pedal on its own CC could be learned later.

## Learning a song

`learn.html` teaches a written-out piano piece, both hands, from a score in
`songs/`. The first one is *City of Stars*, transcribed from the arrangement in
your Drive. There are two ways in, and you can switch between them any time:

### The tutor

A course through the song, built from the song's sections. Every section is
learned the same way, and the steps are listed down the left so you always know
where you are:

1. **Listen** -- the app plays the bars to the piano, slowly, both hands.
2. **Left hand: find the notes** -- *wait mode*. No clock: the notes to play next
   light up on the keys and on the roll, and the song only moves on once you have
   played them. Take all the time you want.
3. **Left hand in time** -- the click comes in at the practice tempo and the bars
   loop. Two passes in a row with 85% of the notes in time and you are through.
4. The same two steps for the **right hand**.
5. **Hands together, slowly**, then **hands together, faster**.

Every second section adds a **join** step that plays everything learned so far
as one piece, so the song grows in phrases instead of staying a pile of
fragments; the last step is the whole song at tempo. `Skip` moves on whenever
you like, `Back` goes back, and the list on the left jumps anywhere. Progress is
kept in `localStorage` per song.

A step goes live with the big **Start step** button (or `Space`): one bar of
click counts you in, then the bars loop until you move on -- the challenge
decides when the step is *done*, not when the music stops. When it is done, the
loop stops and the roll says so ("✓ Left hand in time · 28/28 notes · next:
Right hand: find the notes") with a three-second countdown, after which the next
step loads and starts by itself. Click the overlay or press `Space` to go at
once; `Back` or the step list keeps you where you are. Only the listening step
plays once, and it advances the same way. The very first step after a page load
waits for you to press Start, because the browser needs a gesture before it
will make a sound.

The app talks at those two moments and is quiet in between. Waiting to start, the
overlay names where you are -- **Intro · Listen**, with the bars and the step
number under it -- and says the one sentence the step is about: *Hands in your
lap — just listen. Four bars of the G minor vamp — the ground the whole song
stands on.* The done card says the **next** step's sentence, because that is the
moment you are about to need it. That coach's line is short on purpose; the
paragraph in the panel beside the music is the longer version of the same thing,
and it stays put while you play. A section can supply its own words for its
listening step (`coach` in the song file). **Start over** forgets what you have
done on this song and lands you back on the first section's listening step,
saying so under the meter, so a fresh start needs no hunting through the list.

Under the steps: **Hear the app play it** plays the current bars once, unscored,
then hands the step back to you and starts it (`H`); **Guide** makes
the app play your own hand quietly along with you, so the notes are in your ear
while your fingers look for them (`G`).

### Free practice

Pick any bars -- click one in the strip, shift-click another to stretch the loop,
or hit a section chip -- and loop them. Each hand is one of **You** (you play it
and get scored), **App** (the app plays it out to the piano) or **Off**. So
"left hand alone", "right hand over the app's left hand" and "both hands" are one
click each, and the tempo, the click, wait mode and loop are all on the transport.

### Your tempo

The plan asks for 60 bpm on the slow steps, 80% of the song on the faster ones and
full speed at the end -- but that is a starting point, not a rule. A tempo you set
by hand, on the slider or by typing over the number, is remembered per song and per
*tempo tier* (`slow`, `mid`, `full`, and free practice keeps its own), so setting 84
on one slow step means every slow step comes up at 84 while the faster ones stay
where they belong. A small dot beside the bpm says the tempo showing is yours rather
than the step's; hovering it names the step's default, and clicking it goes back to
that default and forgets the tier. The tempos live with the progress in
`localStorage` but are not progress: **Start over** keeps them.

### What you see

The stage shows the loop in one of four **views**, switched at the top right of
the stage (the choice is remembered):

- **Staff** -- the bars engraved on a grand staff, treble and bass, in the song's
  key. This is the default. The layout is **proportional to time**: every bar of a
  system is the same width and every beat inside it the same span, at the *swung*
  positions, so a note sits where it sounds and the playhead crosses at a constant
  speed instead of hurrying and hanging between noteheads. The current bar is boxed;
  for a long loop the playing system scrolls into view.
- **Roll** -- bars left to right, pitch bottom to top.
- **Falling** -- notes as bars over their keys, streaming down onto the view's own
  key strip the way video tutorials show it. A bar's bottom edge reaches the line
  exactly at the note's onset and then slides on over the key while the note lasts.
- **Scroll** -- the same engraving, but the whole loop on *one* line, sliding
  leftwards under a playhead that never moves: the line stands 30% in and the music
  comes to it. It is the staff for a phone on the music stand, where a wrapped staff
  holds two bars and has to jump between them, and it is the default there. It is
  three small pieces: `staff.js` asked for one system at a fixed number of pixels per
  beat (the strip), `camera.js` -- one sum, where to put that strip so a beat sits
  under the line -- and `scroll.js`, which slides it with a CSS transform on every
  frame. Nothing is clamped at either end: the count-in slides the first bar in from
  the right, and the last bar passes under the line rather than parking at the edge.
  A loop is then just a jump back. A bar takes about 1/2.5 of the panel, so you read
  a bar ahead; if the engraving is taller than the panel the strip is scaled down,
  and the camera knows the factor.

#### Beaming

Notes are joined under beams the way printed music does it, because a beam is how
the eye finds the beat. The rules live in one place, `src/notation/beams.js`: a bar
of cells and a meter in, beam groups out, no DOM and no abcjs, so they are unit
tested on their own in `test/beams.test.mjs`.

The bar is cut into the meter's beat groups -- the quarter in 4/4 and 3/4, the
dotted quarter in 6/8 -- and runs of beamable notes inside a group are beamed.
Values of a quarter or longer never beam, a rest ends a beam, a lone eighth is
flagged, and a tuplet is a group of its own. Two exceptions come from the meter:
in 4/4 the two *halves* of the bar are single spans, so four plain eighths beam as
one, and nothing can ever beam across the middle of the bar; in 3/4 the whole bar
is one span, off by default. Both only apply while nothing shorter than an eighth
is in the span, which is what LilyPond and MuseScore also do. Syncopation needs no
rule: eighth-quarter-eighth leaves each eighth alone with its flag because the
quarter is not beamable. The switches are `mergeHalfBar`, `mergeWholeBar` and
`beamOverRests`, and the module header cites the sources and says where they
disagree.

The groups then do two jobs. They write the ABC -- in ABC a space breaks a beam and
no space makes one -- and they drive the redraw: abcjs's own beams are one glyph
per group and cannot be re-laid, so after the notes move onto the time grid they
are hidden and each beam is drawn again through the stem tips where they landed,
with the secondary beams and beamlets parallel to it, and every stem in the group
re-cut to end on the new line.

**Click anywhere on the stage to take your playing position there** -- across the
staff or the roll, up and down the falling notes. The pointer is a crosshair and a
faint line marks the beat under it, so where you will land is not a guess. While the
loop is running, the clock, the click and the app's hands all re-anchor there and the
music keeps going; what you jumped over leaves the pass rather than counting as a
run of misses, and jumping back puts that stretch up for scoring again. While it is
idle the click sets where you come in, and Play, `Space` or a note on the piano then
starts there after the usual count-in bar. In wait mode it moves the cursor to the
next onset.

In every view blue is the left hand and amber the right, hands the app plays are
dimmed, and as you play a note you hit turns green, one you missed turns red, and a
wrong note leaves a red mark where you played it. A pass is scored when the loop
wraps: hits, misses, extras, and whether you were running early or late. The
**keys** show the notes coming up in the next beat (or, in wait mode, the notes
being waited on) in the hand's colour, and what you are holding in fuchsia.

Wait mode has no clock, so it has no click: the Click button shows as set but idle
there, and the click comes back with the clock.

Scoring is in beats, not milliseconds -- a hit is the right pitch within about a
quarter beat of its onset -- so the same tolerance is more forgiving at slow
tempos and tightens as the tempo comes up, which is the right way round for
learning.

The **meter** under the step shows how far you are from the goal *while you
loop*, and the loop never stops between passes. A passes challenge ("2 passes in
a row at 85%") has one slot per pass: the running pass fills with the hit rate of
the notes that have come due so far, turning green once it is over the line; when
the loop wraps the slot keeps its percentage with a ✓ and the next slot starts
counting at once, and when the last one is in, the step is done and the next
step starts by itself. A pass below the line goes red with its percentage for a
moment, then the streak starts again from pass 1. A pass is judged on accuracy
alone -- how many of the part's notes you hit in time. Wrong notes are shown but
never fail a pass, and notes belonging to a hand you are not playing -- the one the
app is playing beside you, or one switched off -- are not even counted as wrong:
your part is the hands set to **You**, and only those. Free practice also offers a window
challenge ("80% over the last 10 s"): a single slot with the hit rate over a
sliding ten-second window, ✓ the moment it reaches the target. In wait mode
there is no clock, so a window challenge is scored as passes.

### Keys

| | |
|---|---|
| `Space` | start / stop |
| any note on the piano | starts the step when it is idle, or skips the countdown to the next one |
| `M` | click |
| `W` | wait mode |
| `L` | loop |
| `G` | guide |
| `N` / `P` | next / previous step |
| `H` | hear the step's bars |
| `T` / `F` | tutor / free practice |

### On the phone

`learn-m.html` is the same lesson on a phone propped on the music stand, and
**rotating the phone is the mode switch**: sideways is the playing screen — the
stage, the meter, one big Start/Stop and a full-width key strip with the next notes
lit and what you are holding in fuchsia — and upright is Home (the songs, with a
progress ring) and the lesson **path**, sections down the page with the steps as
nodes you can tap. It reads and writes the same `middleman.learn.<songId>` document
as the laptop, so a step finished on one is finished on the other; only the choice
of view is the phone's own (`middleman.learn.mview`, **Scroll** by default, because
a wrapped staff holds two bars on a phone and jumps between them, and a stage that
jumps while your hands are on the keys is the one thing a music stand cannot
afford; a remembered choice always wins). Nothing
on the playing screen needs aim: the tempo is a −/+ stepper, every toggle is a
40px chip, and free practice is a bottom sheet you open while stopped. Turned
upright mid-step it keeps playing, stacked.

The two ways in do **not** start the same way, and the difference is only ever *where
the piano is plugged in*.

```bash
./serve.sh              # iPhone: the phone mirrors the laptop. Plain http, no certificate.
./phone.sh              # Android: the piano is on the phone. https, certificate once.
```

A LAN address is **not a secure context** — `localhost` is the only origin that gets
a free pass — and three things are simply absent there: **Web MIDI**, the **wake
lock** and **service workers**. Only the first of those is load-bearing, and only for
Android. The mirror needs `fetch`, `EventSource`, an `AudioContext` and the
Fullscreen API, all of which a plain-http LAN origin has, so the iPhone route runs on
`./serve.sh` with nothing to install. What it gives up is the screen staying awake by
itself (`navigator.wakeLock` is undefined on http, and `makeWakeLock()` reads that and
holds nothing — so set the phone's auto-lock long, or keep it on the charger) and the
offline app-shell cache (`navigator.serviceWorker` is undefined too, and
`registerServiceWorker()` returns early; the laptop is serving the page anyway). Both
are handled in `src/learn/phone.js` without a throw or a console line. *Add to Home
Screen* still works on iOS over http and still opens with no browser bar — that comes
from the manifest, not from the certificate.

`./phone.sh` is the Android case. Web MIDI on the phone needs HTTPS, so it serves
HTTPS with a certificate from [mkcert](https://github.com/FiloSottile/mkcert)
(`brew install mkcert`; the script stops with that line if it is missing).

#### Trusting the certificate — once per phone, over plain http

The one thing that cannot be served over HTTPS is the certificate itself. The phone
does not trust this laptop yet — that is the entire reason it is fetching the file —
and neither iOS nor Android will take a certificate across a connection it distrusts.
Safari's *visit this website anyway* covers pages only; a configuration profile
arriving over a bad connection is dropped **without a word**, which looks exactly like
a broken link. So `phone.sh` opens a second listener, plain HTTP on the next port up,
serving nothing but the certificate and a page explaining it:

```
http://<laptop-ip>:8766/rootCA.pem      # the file
http://<laptop-ip>:8766/                # the same steps as below, on the phone
```

Everything else on that port is a 404. Both servers live in one process and both stop
on Ctrl-C.

**Android**, in Chrome: open the http address and the file downloads. Then leave
Chrome — the rest happens in the **system Settings app**: search *certificate* →
**Install a certificate** → **CA certificate** → **Install anyway** → pick
`rootCA.pem` from Downloads. It worked if it now shows under *Trusted credentials →
User*.

**iPhone**, in **Safari** — Chrome on iOS cannot hand a profile to the system, so this
step is Safari's alone. Open the http address → **Allow** the profile download →
Settings → General → **VPN & Device Management** → mkcert → **Install** (it asks for
the passcode) → then Settings → General → About → **Certificate Trust Settings** →
switch **mkcert** on. Both halves are required, and the second is the one everybody
forgets. If the download misbehaves, AirDrop the file instead: it sits at
`$(mkcert -CAROOT)/rootCA.pem`.

#### Android: the piano plugs into the phone

Install the certificate as above, then scan the QR. The first tap on the page asks for
MIDI permission; `⛶` toggles full screen, and **Add to Home screen** loses the browser bar
for good. If you would rather not install a certificate at all, Chrome's
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` will accept
`http://<laptop-ip>:8765` as a secure origin — a per-device stopgap, not a fix.

#### iPhone: remote mode, and the piano stays on the laptop

Safari has never shipped Web MIDI on any iOS version and is not going to, and every
iOS browser is WKWebView underneath, so there is no browser on an iPhone that can
reach the piano. **So the iPhone does not talk to the piano at all.** The laptop stays
plugged in and runs everything — the engine, the scorer, the MIDI port, the click —
and the phone on the music stand is its screen and its remote.

1. `./serve.sh`. No certificate: the phone only mirrors the laptop, and nothing a
   mirror needs is gated on https. (`./phone.sh` is for the Android case; it works
   for this too, but is not needed.)
2. On the laptop, open `http://localhost:8765/learn.html` and press **Put it on the
   phone** in the sidebar. A QR code, the code under it and the address appear
   below. The panel asks the server for its Wi-Fi address, so the link the phone
   gets is routable even though the page was opened on `localhost`. **This** is the
   QR the iPhone scans. (If the server is loopback-only, `./serve.sh --local`, the
   panel says so in place of the QR; if it has no relay at all, such as
   `python3 -m http.server`, it says that instead and arms nothing.)
3. Point the iPhone's camera at it. The page opens already paired, and Home
   says **showing the laptop · 4 ms** under its title, with **Stop mirroring** beside it
   as the way back out. (If the camera cannot see the screen, tap
   *Connect to the laptop* on the phone's Home and type the code printed under the QR.)
4. **Share → Add to Home Screen.** Opened from the Home screen it runs full screen with
   no browser bar — which is the iPhone's version of the `⛶` button, and the reason `⛶`
   is hidden there. From then on it pairs itself: see *The room belongs to the server*
   below, and there is nothing to scan again.
5. Play. Rotate to landscape for the stage, upright for the lesson path, exactly as on
   Android.

What runs where: the laptop owns the transport, the scoring and the sound, so the click
plays there, beside the piano, and the progress document stays the laptop's. The phone
runs its own copy of the clock, the views, the meter and the key strip. It is sent the
clock's anchor **once** and then only events — a hit, a miss, a wrong note, a pass, a
step change — so the playhead is drawn locally at 60 fps and the network never gets
between it and the music. The done card is read straight off the laptop's overlay, so
the music stand gets the same tick, the same count of notes and the same coach's line,
over the step's title and where it sits in the song. Every control on the phone drives the laptop: Start/Stop,
tempo, hands, bars, wait, loop, the step list and the done card's *Go now*. The one
thing that stays the phone's own is which of the four views it is showing.

The sound is the exception, and only when it is asked to be. `Out: Piano | Computer`
still decides where the app's own notes go — the companion hand, *Hear it*, the pedal
— and when it is set to **Computer** while a phone is mirroring, the computer *is* the
phone: every note goes over the relay with the moment it was scheduled for and comes
out of the phone's speaker, on the music stand, while the laptop's own stay quiet. The
laptop's toggle relabels its second half **Phone** while that is true, and the phone
has the same toggle, driving the laptop's. Two things about the phone: iOS starts
audio only inside a real tap, so the first tap there — Start, *Hear it*, the stage —
is what wakes it, and the page asks for the `playback` audio session so the ring/silent
switch does not mute a phone that is meant to be playing.

The limitation is the obvious one: **the laptop has to be on, awake and near the piano**,
with the Learn page open and sharing. Nothing about remote mode works with the lid shut.
`design/learn-mobile/DELIVERY.md` has the survey behind that choice, and what a
standalone iOS app would cost instead.

#### How the relay works

`serve.py` grew about a hundred lines of stdlib: `GET /relay/events?room=…` is a
server-sent-event stream, `POST /relay/send?room=…` broadcasts one JSON event to a
room, `GET /relay/time` is a monotonic clock both ends measure themselves against, and
`GET /relay/info` says who the server is and which room to pair in.
No WebSocket, because `http.server` has none and this needs none — the laptop
broadcasts and the phone sends the occasional command. A room keeps its last state
snapshot, so a phone that connects late is up to date at once; rooms live in memory
and die with the server. `EventSource` reconnects on its own, so a sleeping laptop, a
blinking Wi-Fi or a restarted server all come back without help.

##### The room belongs to the server

`GET /relay/info` answers who the server is: its port, whether it is on TLS, the
addresses the phone can reach it at — and the **room**. One room per machine, six
characters, kept in `certs/room` (git-ignored, made on first run), so it is the same
on every origin and survives every restart.

That last part is the whole point. The room used to be minted in the page and kept in
`localStorage`, which is per *origin* — so one server handed a different room to
`http://localhost:8765` and to `http://192.168.1.5:8765`, and clearing the site data
was a third. Meanwhile a phone saved to the Home screen is a standalone web app with
its **own** storage and a URL frozen the day it was installed, `?room=` and all. Put
those two together and you get the bug: the laptop moves origin, or the server is
restarted and the browser cleared, and the Home screen app goes on happily connected
to a room nobody publishes into — detached, with nothing on screen to say so.

Now both ends take the room from `/relay/info` at load. The laptop publishes into it;
the phone switches to it if the one it remembered differs, quietly, and catches up.
The QR and the typed code still carry it, for the first pairing.

An iPhone goes one step further: it has no Web MIDI and never will, so it can never
be the app on its own, and nothing on the device can be trusted to name the room. So
a phone with no `navigator.requestMIDIAccess`, not already paired, asks the server at
load and mirrors whatever room it names — no QR, no code, no remembered flag. **Stop
mirroring** still drops it back to its own app, remembered in `sessionStorage` for
that launch only: closing the installed app forgets it, because the next launch is a
phone going back on the music stand. A phone that *has* Web MIDI keeps its own engine
unless it is asked to mirror.

##### A server with no relay, and one that merely blinked

The repo served by `python3 -m http.server` answers every relay endpoint with a 404 or
a 501, and everything used to retry it: the `EventSource` reopened itself, the clock
measurement fired eight requests a resync, and the remembered *Put it on the phone*
re-armed the whole thing on every reload, until the log filled up and the page was
unusable. The `/relay/info` fetch above already answers that question, so it is asked
once, by the page, before anything is opened: no relay, no stream, no sends, and both
the share panel and the phone say *This server has no phone relay*. Nothing keeps
asking, because nothing is going to change until the page is served properly — and a
reload on a proper server picks sharing straight back up, since the remembered flag is
left set.

A server that could not be *reached* at all is a different answer, and is not treated
as "no relay": a laptop that is asleep or a Wi-Fi that has not come up is exactly the
thing worth waiting for. Once a stream is open, a drop is retried in a second,
doubling to half a minute — the phone is blind between the drop and the reopen,
showing a picture of the laptop that has stopped following it. A restarted server
loses every room, so a reconnected stream is an empty one: the laptop republishes its
snapshot the moment the stream is live again, and a phone that reconnects is handed
the room's kept snapshot at once. Nothing is posted into a stream that is not live,
which is what tells the laptop its snapshot never left — sends are told apart the same
way otherwise: the held keys and the streamed notes are repeated, so a stalled server
may drop them, while a snapshot, a hit or a command happens once and keeps its own
budget, and a snapshot the relay refuses is not recorded as sent, so the next diff
tick sends it again.

The clock sync is `src/learn/sync.js`: eight NTP-style round trips, keep the shortest
half, take the median offset, re-measure every thirty seconds and after every
reconnect. The anchor travels in relay time, so neither end has to know anything about
the other's `performance.now()`. On a home LAN the two playheads sit within a
thousandth of a beat of each other.

### Jamming with another player

The room the phone mirrors into can hold a second **player**: another machine with a
piano of its own, hearing you and heard by you. It is the same room, the same agreed
clock and the same three messages — only `note` is new traffic, and only because it
now carries a `from`.

Both machines have to be on the same server, because a room lives in that server's
memory. So the second player opens **this laptop's address**, exactly as the phone
does — the Jam panel prints the one to type — and presses **Jam with another player**
on their own Learn page. Both panels then say who is in the room. Being a player is
*said*, never guessed: a laptop can be hosting a phone, jamming, both or neither, and
each of those is something the pianist turned on.

```
Put it on the phone      the phone is a screen for this laptop's lesson
Jam with another player  another machine's pianist plays into this room
```

What crosses the wire is every note you play — note on and note off, as they come in
from the piano, stamped with the moment the key went down in **relay time**. The other
machine converts that stamp to its own clock and plays the note through its own
`Out: Piano | Computer`, at that moment **plus a 30 ms hold**. The hold is the whole
trick: packets do not arrive evenly, and a note played the instant it lands has the
network's rhythm rather than the pianist's, so waiting a fixed 30 ms puts every note
that got there inside the window back in the order and the spacing it was played in.
A note that took longer than the hold plays at once. 30 ms is also about ten metres of
air, which is two musicians on one stage. Your own piano is untouched: it sounds under
your hands with no delay, and the room never echoes it back to you (`from` is checked
on both ends, and the relay already skips the sender).

Two things follow from *whose* note it is, and both are the point of `from`:

* the phone on the music stand ignores the room's playing. It is a screen and a
  speaker for one laptop's lesson, and it plays what that laptop's app plays — never
  what the other pianist plays. A jam note is marked `live`; the mirror drops those.
* a phone asking for the sound now has to **say so** rather than be counted. It used
  to be enough that something was connected; a jam partner joining would then have
  muted the laptop's speakers on the theory that a phone wanted them.

Because the other player's notes go out through the same `send()` the app's own notes
use, they take this machine's Out and this machine's volume — so if the laptop's sound
is on the phone, your jam partner comes out of the phone's speaker too, on the music
stand, which is where you are listening anyway.

**A note on MIDI thru.** The other player's notes reach your piano over MIDI Out. A
piano set to echo its MIDI In back to its MIDI Out will send them straight back to the
app as if you had played them, and around the room again. Turn local MIDI thru off, or
use `Out: Computer`.

**What it does not do yet.** The laptop that opened the room is still the only brain:
the transport is not shared, so each player starts their own lesson and there is no
common click or loop, and nothing is recorded. The pedal does not travel. Those are
steps 3 and 4 in `design/jam/PLAN.md`, and they wait on how a real evening of step 2
feels. It is same-room, same-Wi-Fi only — over the internet the hold would have to be
tens of times longer, and that is not music.

The scheduling decision is one pure function, `playWhen` in `src/learn/jam.js`, with
`test/jam.test.mjs` on it; `npm run smoke` drives two Learn tabs in one room through
headless Chrome and checks a note each way, signed and not echoed.

**Measured, with a real piano.** `node scripts/measure-jam.mjs --seconds 120` opens two
Learn tabs in one room with Web MIDI granted, one reading the piano and the other
playing back into it, and joins every note end to end. On 2026-09-03, 1402 notes over
two minutes of single notes, chords and runs, both tabs on this laptop: the relay hop
took 2.5 ms (median), 5 ms at the 90th percentile and 27 ms at worst; a note reached
the partner's MIDI Out 3.3 ms after the key went down; the 30 ms hold had 27 ms left on
arrival, and one note in the two minutes landed after the hold and played 16 ms late.
Nothing was dropped. These are the machine's numbers, not the ear's: the USB
interface, the piano's engine and the finger-to-packet delay on the way in are all
outside what a browser can see, and a second machine over Wi-Fi is still to be measured.

### Feedback, from the piano

Both Learn pages carry a **Feedback** control — in the sidebar on the laptop, an icon
in the playing screen's bar on the phone on the music stand. It opens a small sheet:
one chip, **👍 Went well** or **⚠️ Friction**, and an optional single line. Cancel
posts nothing. Send closes the sheet immediately and posts in the background, so
nothing about writing a note is worth stopping for.

Opening it does not touch the lesson. The loop keeps going, the streak stands and the
meter carries on — the module is handed getters and a button and has no engine to
call, which is asserted in `test/feedback.test.mjs` rather than merely intended.

What it attaches is the half of a note nobody remembers to type: the device (laptop or
phone, and whether the phone is mirroring), the song, tutor or free practice, the
section and bars, the step title when there is one, the tempo and the view — and how
it was actually going, which is the live percentage if something is running, else the
pass that just finished, else the best that step has been. Send also takes a PNG of
the Learn **window** — chrome, step, music, keys: what is on screen — and the laptop
attaches it to the same GitHub comment. A crop of the staff strip alone is not
enough. If the capture or the upload fails, the text note still goes; a missing
shot is not a missing note.

The note goes to the laptop's own `serve.py`, which comments on a standing GitHub
issue labelled `feedback` ([#10](https://github.com/peak-luli/midiman/issues/10)).
**The token lives on the laptop and never in the page** — a GitHub credential in a
page is a credential in the QR, on the phone and one screenshot from the repository —
so the browser posts to the machine it already trusts with the piano, and that machine
does the talking:

```sh
cp .env.example .env          # gitignored; put the token there
./serve.sh                    # loads .env; already-exported shell vars win
```

A one-shot in the shell still works (`MIDIMAN_GITHUB_TOKEN=… ./serve.sh`) and wins
over `.env`. Use `./serve.sh` or `./phone.sh` — running `serve.py` directly skips
the loader.

A fine-grained personal access token with **Issues: read and write** on the repository
is enough (attaching a file needs write access to the repo, which that already is).
The screenshot is posted to GitHub’s user-attachments host (`uploads.github.com`),
then embedded as `![Learn](url)` on the comment — the same path `gh issue comment
--attach` uses. It is not written through the Contents API, so piano shots never
become commits on `main`. `MIDIMAN_GITHUB_UPLOAD` points that hop at a stub in tests;
you do not set it on the laptop.

Three more environment variables exist for pointing the inbox elsewhere, and none
of them normally needs setting: `MIDIMAN_FEEDBACK_REPO` (default `peak-luli/midiman`),
`MIDIMAN_FEEDBACK_ISSUE` (default `10` — blank it and the server finds the open issue
carrying the label, or opens one), and `MIDIMAN_FEEDBACK_LABEL` (default `feedback`).
`MIDIMAN_GITHUB_API` points the Issues calls at a stub, which is how the endpoint is
tested (`test/feedback-serve.test.mjs`). The placeholders live in `.env.example`.

After a comment lands, `serve.py` can optionally POST a small JSON body to a
[Grok Bot](https://cursor.com) routine webhook so Miriam is pinged without watching
[#10](https://github.com/peak-luli/midiman/issues/10). The trigger card on desktop
gives a POST URL and a sender key; requests use `Authorization: Bearer <key>`.
Set `MIDIMAN_FEEDBACK_WEBHOOK_URL` to enable it. `MIDIMAN_FEEDBACK_WEBHOOK_KEY` is
that sender key. `MIDIMAN_FEEDBACK_WEBHOOK_HEADER`, if set, is the full
`Authorization` value (or a pasted `Authorization: Bearer …` line) and wins over
KEY. With URL unset there is no extra call — today's behaviour. A webhook that
answers 500 or never answers does **not** fail Send: the pianist already heard
that GitHub took the note.

With no token set, or with no internet, the note is not queued anywhere: the sheet
closes, one grey line under the button says it did not send, and it fades. A queue
that drains days later into an issue nobody is reading is worse than nothing, and a
pianist mid-loop cannot act on the failure either way. The server says once, in its
own log, that `MIDIMAN_GITHUB_TOKEN` is unset.

### Adding a song

A song is a JSON file in `songs/`, listed in `songs/index.json`. It is written
per hand, one string per bar, in a compact notation:

```json
{
  "id": "my-song", "title": "My song", "bpm": 96, "practiceBpm": 60,
  "swing": "2/3", "key": "F", "sharps": false,
  "sections": [{ "name": "Intro", "from": 1, "to": 4, "hint": "Left hand alone." }],
  "rh": ["r:8", "G4 A4 Bb4 D5:3 r:2", "~D5 A4:7", "/[F5 A5 C6]:8"],
  "lh": ["G2 Bb2 D3 G3:2 G3 F3 D3", "C3 E3 G3 C4:3 Bb3:2", "[A2 A3]:8", "D3:8"]
}
```

| token | meaning |
|---|---|
| `G4`, `Bb3`, `C#5` | a note, one eighth long |
| `[G4 Bb4 D5]` | a chord |
| `r` | a rest |
| `:n` | length in eighths; fractions allowed (`:2/3` for a triplet eighth, `:1/2` for a sixteenth) |
| `~` prefix | tied from the previous note of the same pitch: no new attack, the earlier note is extended |
| `/` prefix | rolled chord, bottom to top |

Every bar has to sum to exactly 8 eighths; the file is validated on load and the
error names the hand and bar. The parsed song keeps both the flat note lists the
engine plays from and the bars as written (`cells`: rests, ties, tuplets, rolled
chords), which is what the staff view engraves. `sections` are 1-based and inclusive; they drive
the tutor's plan and the chips in free practice. `bpm` is the song's tempo,
`practiceBpm` the tempo the tutor starts at. `swing` pushes the offbeat eighths,
as on the tracks.

## Tracks

| Track | Form | Feel |
|---|---|---|
| C / F / G blues | 12-bar, dominant 7ths | shuffle (swung eighths), boogie bass |
| Billie Jean | 4-bar F#m7 vamp, 8-bar melody | straight eighths |

The Billie Jean track is a vamp **in the style of** the verse groove — the chord
and feel, not a transcription of the bass line. Chorus changes aren't included.
Its melody is likewise an original F# minor pentatonic line over the vamp, not
the vocal line; swap the notes in `tracks.json` for whatever you want to work on.

## Guitar (proof of concept)

`./serve.sh`, then <http://localhost:8765/guitar.html>. Plug the Spark 40 into the
Mac's USB, press **Listen**, and play: the page shows the note it hears in the middle
of the screen, a needle from −50 to +50 cents against it, the frequency, the input
level, and the same key strip the other pages use, with that note lit. Silence clears
all of it.

The first press asks for the microphone, and only a granted microphone has device
labels — so the page takes whatever input it is given, reads the labels that unlocks
and then switches itself to the one called "Spark 40 USB". The picker in the bar is
there for when that guess is wrong. It asks for the input with `echoCancellation`,
`noiseSuppression` and `autoGainControl` all off: those three defaults are tuned for a
voice on a call, and on a guitar they pump the decay of every note, mistake a
sustained string for noise, and filter the room.

Detection is [YIN](https://doi.org/10.1121/1.1458024) in `src/guitar/pitch.js`, on
4096 samples at a time — pure, so `test/pitch.test.mjs` can hold it against
synthesized sines and sawtooths at every open string and a few frets up. A sawtooth is
the honest test: a pickup's second harmonic is louder than its fundamental, so
anything that follows the loudest partial reports the octave above. Two gates keep the
screen quiet — a level gate at −48 dB for a room with nothing happening in it, and
YIN's own clarity for a note that has decayed, or two strings ringing at once. A new
note has to hold for 70 ms before it replaces the one on screen, and a note stays up
220 ms after it stops being heard, so nothing flickers.

**What it does not do.** Anything else. It is not wired into the tutor or the looper,
it does not score, record, transpose or follow a song, it knows nothing about chords —
strum and it will pick one of the notes and wander between them — and it does not send
MIDI. One voice at a time is the whole of it.

Verified in headless Chrome the way `npm run smoke` is, against a real 28-second
recording off the Spark: silent until 15.9 s, then the low strings around C2–E2, then
a chord decaying on C3 until it drops under the gate at 26.3 s. Chrome's fake capture
device needs `--no-sandbox` to open a wav at all; without it the page correctly reads
digital silence, which is a confusing way to find that out.

## Layout

```
index.html          the practice view
looper.html         the looper
learn.html          learn a song
learn-m.html        the same, laid out for a phone on the music stand
guitar.html         the guitar proof of concept: what note is the amp playing
style.css           shared: tokens, buttons, track list, key strip
looper.css          the looper's own furniture, on top of style.css
learn.css           the learn page's, on top of both
learn-m.css         the phone layout, on top of all three
guitar.css          the guitar page's one screen, on top of style.css
manifest.webmanifest  makes learn-m.html installable: fullscreen, landscape, icons
sw.js               the app shell cache, registered from learn-m.html only
icons/              the installed app's icons, and make-icons.mjs that draws them
serve.sh            the dev server on localhost (loads a gitignored .env)
phone.sh            the same over the LAN, with HTTPS, a certificate and a QR code
.env.example        placeholder keys for the local .env ./serve.sh loads
serve.py            the server both of those run: stdlib only, optional TLS, and the
                    remote-mode relay (SSE out, POST in, a monotonic clock)
tracks.json         the backing tracks (data, not code)
songs/              the songs the learn page teaches (data, not code)
src/
  app.js            practice view: transport, playhead, panels, event handlers
  clock.js          performance.now() <-> absolute beats; shared by every page
  tracks.js         loads/validates tracks.json, build() -> event list
  theory.js         note spelling, scales, bass patterns, chord labels
  midi.js           Web MIDI in/out, the `held` set, the timestamped event stream,
                    and the routing: piano, computer, or both
  synth.js          the software piano: a polyphonic WebAudio voice per note, on the
                    metronome's context and its performance -> audio time mapping
  outtoggle.js      the "Out: Piano | Computer" control, one for all three transports
  volume.js         the app's volume: one setting for all four pages, and the
                    velocity scale send() puts on every note the app plays
  qr.js             a QR encoder: byte mode, level L, versions 1-10, and an SVG of it
  metronome.js      the WebAudio click, scheduled by beat number on the clock
  keyboard.js       the piano strip
  notation.js       abcjs rendering, chord-box geometry, played-note painting
  song.js           the song notation: parse, validate, flat note lists
  notation/
    beams.js        the beaming rules: a bar of cells and a meter -> beam groups
  learn/
    plan.js         the tutor's lesson plan, built from a song's sections
    scorer.js       expected onsets, the per-pass tally, wait-mode groups
    engine.js       the learn transport: flow and wait modes, loop, app hands
    meter.js        the challenge meter: a slot per pass, filling live
    tempo.js        your hand-set tempo, remembered per song and per tempo tier
    store.js        the saved document both learn pages read and write
    pass.js         what a pass means: the streak, and the other hand's notes
    phone.js        full screen, orientation lock, wake lock, install hint, sw
    relay.js        the channel both ends of remote mode talk over: SSE in, POST out
    sync.js         the clock sync: the NTP filter and the anchor, both pure
    host.js         the laptop's half: the QR, the state snapshots, the commands in
    remote.js       the phone's half: a mirror with the engine's interface
    jam.js          two players in one room: every note signed with the device that
                    played it, and held 30 ms on the way in so they land in order
    roll.js         the piano roll view
    staff.js        the staff view: abcjs engraves the glyphs, then a grid of equal
                    beats says where each of them goes, and the beams are redrawn
    fall.js         the falling-notes view, on its own key strip
    camera.js       where to put the strip so a beat sits under the fixed line
    scroll.js       the scrolling staff: one long strip, slid under that line
    app.js          wiring: tutor, free practice, MIDI in, keys, persistence
    mobile.js       the same wiring for the phone: home, path, play, the sheet
  guitar/
    pitch.js        YIN: a frame of samples -> a frequency and how sure it is, and
                    the frequency -> note, cents helper. Pure; no microphone in it
    app.js          the guitar page: the input picker, the analyser, the gates and
                    the hold that keeps a detected note from flickering
  looper/
    buffer.js       the rolling input buffer, and what a take slices out of it
    loops.js        the loop model: placement, follow, quantize, melody export
    engine.js       scheduler and the one-key state machine
    ui.js           lanes, rolls, playhead, key strip
    app.js          wiring: keys, MIDI in, inspector, persistence
test/
  looper.test.mjs   the looper's musical logic, run with `node --test`
  learn.test.mjs    the song notation, the plan, the scorer and the view geometry
  beams.test.mjs    the beaming rules, meter by meter
  engine.test.mjs   the learn transport against a fake clock and fake timers
  metronome.test.mjs  the click's scheduling, ditto
  mobile.test.mjs   what the two learn pages share: the document, the pass rule,
                    the path's node states
  synth.test.mjs    the software piano against a fake AudioContext
  midi.test.mjs     output routing: which of the piano and the synth a message reaches
  sync.test.mjs     remote mode's clock: the NTP filter and the anchor conversion
  jam.test.mjs      the jam: when a received note sounds, and whose notes are whose
  qr.test.mjs       the QR encoder, against the standard's tables and a whole symbol
  pitch.test.mjs    the guitar page's detector, against synthesized strings
scripts/
  smoke.mjs         the end-to-end check `npm run smoke` runs: one server, headless
                    Chrome over CDP, a laptop, a mirroring phone and a second player.
                    It walks the Intro end to end -- Start over, listen, find the
                    notes, two clean passes -- and finds Chrome in the usual places,
                    or wherever `--chrome <path>` / `$CHROME` says
vendor/
  abcjs-basic-min.js   abcjs 6.4.4, vendored so the app works offline
```

Native ES modules — no build step, no `node_modules`. Edit and refresh. The
`package.json` exists only so `node --test` reads `src/` as ES modules; there are
no dependencies.

## Adding a track

Tracks live in `tracks.json` — no code changes needed. The form length, chip
strip, notation layout, chorus folding and scale panel all derive from the entry.

```json
{
  "id": "am-groove",
  "name": "A minor groove",
  "sub": "90 bpm",
  "root": 45,
  "bpm": 90,
  "swing": 0.5,
  "sharps": false,
  "pattern": "minorVamp",
  "quality": "m7",
  "form": [0, 0, 5, 7],
  "scale": "minorPentatonic",
  "cols": 4
}
```

| field | meaning |
|---|---|
| `id` | stable identifier |
| `root` | MIDI note number of the key, in the bass register (36 = C2) |
| `bpm` | default tempo; the slider still overrides it |
| `swing` | where the offbeat lands: `"2/3"` swung, `0.5` straight. Fractions stay exact |
| `sharps` | `true` spells notation with sharps, `false` with flats |
| `pattern` | 8 eighth-note offsets per bar, relative to the chord root |
| `quality` | `"7"` or `"m7"` — picks the guide tones comped on beats 2 and 4 |
| `form` | one entry per bar, as semitones above `root` |
| `scale` | intervals + display name for the keyboard and info panel |
| `cols` | bars per notation line |
| `melody` | optional; a name from the `melodies` block, or an inline melody |
| `note` | optional; shown as a tooltip on the track |

### Melodies

A melody is bars of `[note, eighths]` cells — `null` is a rest, and each bar has
to account for exactly 8 eighths. Notes are scientific pitch names, so they read
at the register you'll actually play them.

```json
"melodies": {
  "bjVerse": {
    "name": "verse line",
    "bars": [
      [[null, 2], ["C#5", 1], ["B4", 1], ["A4", 2], ["F#4", 2]],
      [["F#4", 3], ["E4", 1], ["F#4", 2], [null, 2]]
    ]
  }
}
```

The melody may be longer than the form, as long as it's a whole multiple of it —
Billie Jean's is 8 bars over the 4-bar vamp, so the loop is 8 bars and the chords
repeat underneath. The displayed bar count doesn't change when you tick the box.
Melodies swing with the track: onsets use the same `swing` as the bass line, so a
melody written in eighths comes out shuffled on the blues tracks.

`pattern`, `form` and `scale` each take **either a name** from the shared
`patterns` / `forms` / `scales` blocks at the top of the file, **or an inline
value** — so the three blues keys share one form and pattern, while Billie Jean
inlines its own 4-bar form.

The file is validated on load. Errors are specific (`track "x": pattern needs 8
offsets, got 2`) and surface in the sidebar and the status line rather than
failing silently.

## Notes for future work

The metronome is one module for all three pages, and it is built the way it is
because a click that "just schedules a sound N ms from now" goes wrong in three
separate ways: a tempo change re-anchors the clock and the old counter double- or
skips a beat; a background tab throttles the timer to once a second and the
missed beats come out as a burst when it wakes; and `AudioContext.currentTime`
drifts from `performance.now()` and ignores output latency, so the click lands
late against the piano. So `makeMetronome(clock)` schedules by *beat number*,
drops beats that are already past instead of playing them late, maps time once
per round from `getOutputTimestamp()`, resumes a suspended context on the next
gesture or when the tab comes back, and keeps the one audio-vs-MIDI offset in
`CLICK_OFFSET_MS`. Each transport calls `pump(lookahead)` from its tick.

Two abcjs behaviours cost real debugging time and are worth remembering:

- Noteheads are `.abcjs-notehead`, and there is **no** `.abcjs-note` class —
  unless you pass `add_classes: true`, which adds `.abcjs-note` plus a
  `.abcjs-vN` voice tag to each note's `<g>`. With two voices that tag is the
  only reliable way to tell the staves apart: document order interleaves them
  per system. Rests are `.abcjs-rest`, so they stay out of the note map.
- `K:` must come **last** in the header, after any `V:` voice definitions.
- Chord symbols are bare `<text>` elements with **no class**, and abcjs typesets
  `#`/`b` as the glyphs `♯`/`♭` — so they're matched by normalised text content.
- A blank line anywhere in an ABC header **terminates the tune** and silently
  drops the entire body.

The learn page's staff does **not** use abcjs's spacing. Engravers space notes by an
aesthetic curve of their duration, so a playhead that follows the noteheads speeds up
and slows down and the music stops feeling like it has a tempo. abcjs has no
proportional mode: its only justification knob is `stretchlast`, which stretches the
last system alone and then refuses to go past its own spacing cap. So `staff.js`
engraves with abcjs for the glyphs and then translates every note, rest, bar line and
staff line onto a grid of equal beats. What that costs, and four things that cost
time getting there:

- A beam is one glyph over several notes and there is no re-laying it, so abcjs's
  beams (`.abcjs-beam-elem`, direct children of the staff wrapper, one filled
  parallelogram per group with the beamlets as extra subpaths in the same `d`) are
  hidden and drawn again from the beam groups once the notes have moved. What makes
  that cheap is that a stem is `.abcjs-stem` *inside* the note's own `<g>`, so it
  travels with the note and only its free end has to be re-cut; the beam is then the
  line through the two outer stem tips, capped in slope and pushed out far enough
  that no stem comes out shorter than abcjs drew it. Which notes are under a beam is
  never decided here -- `src/notation/beams.js` decides, and the same groups write
  the ABC's spacing.
- Ties and slurs are curves between two x's abcjs chose. They are hidden, and a tie is
  redrawn as a plain arc between the two heads that belong to the same song note.
- A tuplet is one group holding its bracket and its number: it moves to where its
  first note went and the bracket is scaled to reach the last.
- Only the **topmost** staff line carries a class (`.abcjs-top-line`); the other four
  are bare `<path>`s straight under the `.abcjs-staff` group, so a rule that stretches
  "the staff lines" has to find them by shape, not by class.
- abcjs sizes the `<svg>` to whatever the engraving wanted and lets its own container
  clip the overflow. The width to lay out across is therefore the **container's**, not
  the svg's -- reading the svg's box lays the last bars off the edge of the panel.

One SVG trap from the learn page: an SVG with `preserveAspectRatio="none"` and
percentage sizes stalls Chrome's compositor -- headless never paints the page
again, and a screenshot hangs forever. The roll draws in the panel's own pixel
box instead, and re-renders on resize.

Two CSS traps cost time on the looper and will again:

- The `hidden` attribute is only `display: none` at the *user-agent* level, so any
  rule setting `display` on the element beats it. Anything toggled with `.hidden`
  needs its own `[hidden] { display: none }`.
- `height: 100%` on a grid item resolves against the **row**, and an implicit row
  is `auto` — so it silently behaves like `height: auto` and the page grows past
  the viewport instead of the content giving up space. The body grid needs an
  explicit `grid-template-rows: minmax(0, 1fr)`.
- The same on the other axis, one level down: a grid container's *implicit column*
  is content-sized, so `min-width: 0` on the container is not enough — a child row
  that cannot shrink (a no-wrap flex bar with `min-width`s in it) makes the
  container wider than its track and paints over whatever is beside it. `main`
  needs `grid-template-columns: minmax(0, 1fr)`, and the transport needs to wrap.
  Check overflow on **both** axes when testing a layout; the vertical one is the
  obvious half.
- A flex item wraps on its **flex-basis**, not on its shrunk width — so `min-width: 0`
  plus `overflow: hidden` still lets a growing label wrap the row and change the
  page's height. Text whose length varies with state (`PLAY` → `DUB NEXT`) needs
  `flex: 1 1 0`, and a label that must not move things needs a `min-width` wide
  enough for its longest value.


# 🎄 Randall Christmas — The Plan

A 25-day Advent calendar web app with six personal paths. Each day unlocks at midnight
(Dec 1 → Dec 25). Players can go back and finish any earlier day, but can't open future ones.
Progress is saved per path on the server, so it follows you to any device.

---

## How a day is built

Every day on every path has three sections:

| Section | Icon | Source | Typical size |
|---|---|---|---|
| **{Name}'s Puzzles** | ⭐ | That person's path | 4–6 puzzles |
| **Christmas Bonus** | 🎄 | Shared by everyone (`content/_shared`) | 1–2 puzzles |
| **Faith & Scripture** | ✝️ | Shared by everyone (`content/_shared`) | 1–2 puzzles |

A path can also put its *own* puzzles in the Christmas or Faith sections. Kathy's could be in
Spanish, for example, and Dad's faith section can go deeper on the Westminster Standards.

### Target mix for a personal day (≈5 puzzles)
- 3 trivia questions (multiple choice and/or type-the-answer)
- 1 small word game (scramble, or a themed Wordle)
- 1 "big" word game (Connections or Wordle) on most days

### Puzzle types available now
| Type | What it is | Default points |
|---|---|---|
| `multiple_choice` | Classic A/B/C/D trivia, one shot | 1 |
| `text_answer` | Type the answer. Forgiving matching (case, accents, punctuation, "the"), multiple accepted answers, 3 tries | 1 |
| `scramble` | Unscramble a word or phrase | 1 |
| `wordle` | Guess the hidden 3–10 letter word with green/yellow/gray feedback | 3 |
| `connections` | 16 words, find the 4 hidden groups of 4, 4 mistakes allowed | 3 |
| `rebus` | Emoji rebus, e.g. "🐴 + 👞" → *horseshoe*; 3 tries | 1 |
| `verse` | Fill in the blanks of a Bible verse (typed, or tap-to-fill word bank); partial credit | 1 |
| `timeline` | Put events in order with ▲/▼; correct spots lock green between tries; partial credit | 2 |
| `who_said_it` | Match each quote to the family member who said it (great for Mom); partial credit | 2 |
| `spelling_bee` | Make words from 7 letters (center letter required); hit the target for full credit | 3 |
| `crossword` | Mini crossword with auto-numbering, limited checks, saved in-progress letters; partial credit | 3 |

Puzzles may award **partial credit** (`fraction` from the engine): score = round(points × fraction).

### Difficulty arc (all paths)
- **Dec 1–7: Warm-up.** Approachable questions, so everyone gets hooked.
- **Dec 8–18: Main stretch.** Medium difficulty, with deeper cuts on each person's interests.
- **Dec 19–24: Hard mode.** Tougher Connections, longer Wordles, deeper trivia.
- **Dec 25: Christmas Day special.** A longer finale: a Nativity-themed set plus a "family" round
  everyone can do together.

---

## The six paths

### 🐦 Meg: Birds, Horses & Mexican History
**Themes:** birding (North American and Mexican species, migration, birdsong, anatomy, the
Audubon field guide), equestrian (gaits, tack, breeds, disciplines, horse anatomy, famous horses),
Mexican history (Aztec/Mexica, conquest, independence, the Reform, the Revolution, Frida and Diego,
Mexican states and culture).

**Word games:** bird-name Wordles (EGRET, HERON, ROBIN, QUAIL), scrambles of breeds (APPALOOSA,
ANDALUSIAN), Connections that mix the themes, e.g. *Horse gaits / Birds of prey / Mexican states /
Horse markings*, with deliberate red herrings (KITE, STAR, CROW).

**Sample arc:**
- Week 1: backyard birds · horse basics · Mexica / Tenochtitlán
- Week 2: raptors and migration · breeds and colors · Independence (1810–1821)
- Week 3: Mexican birds (quetzal, roadrunner) · dressage and jumping · Reform and Revolution
- Final days: rare birds · famous horses · modern Mexico and Las Posadas

### ⚾ Rafa: Béisbol & American Slang
**Themes:** Mexican baseball first: Liga Mexicana del Pacífico, Liga Mexicana de Béisbol,
Serie del Caribe, Mexico in the World Baseball Classic, Mexican-born MLB stars (Fernando Valenzuela,
Julio Urías, Adrián González, Joey Meneses, Randy Arozarena). Then some MLB history and rules.
**American slang:** old and new (bussin', no cap, rizz; "the bee's knees", "cool beans"),
idioms, regional terms (y'all, wicked, pop vs. soda).

**Word games:** baseball Wordles (PITCH, BUNTS, SLIDE), "what does this slang mean" multiple
choice, Connections like *Ways to get on base / Pitches / LMP teams / Slang for 'cool'*.

**Sample arc:** LMP teams and mascots → Mexican MLB legends → Serie del Caribe history →
slang through the decades → baseball idioms used in everyday English ("out of left field",
"touch base", "ballpark figure").

### 🐧 Thomas: Video Games, Linux & Weird Facts (HARD MODE)
**Themes:** video game history and deep cuts (NES → modern, speedrunning, glitches, Easter eggs,
composers), Linux (commands, distros, kernel history, file system, sysadmin humor), and
completely off-the-wall random facts.

**Word games are deliberately brutal:** 6–8 letter Wordles with only 5 guesses, Connections full
of red herrings (Unix commands that are also animals, game titles that are also verbs), scrambles
of multi-word phrases, type-the-answer questions that need exact recall.

**Sample arc:** Linux basics → NES/SNES deep cuts → "what does this command do" → speedrun and
glitch trivia → bizarre animal facts → kernel and distro history → final boss day.

### ☕ Kathy: Español, Café & Mom Life
**Themes:** Spanish at an easy-to-medium, Duolingo-friendly level (greetings, food, family,
numbers, colors, days and months, common verbs in present tense, Christmas vocabulary like
*Nochebuena, villancicos, aguinaldo*), coffee (origins, brewing methods, drinks, fun facts), and
young-mom facts (baby milestones, sleep, fun parenting trivia).

**Word games:** Spanish Wordles (LECHE, FELIZ, NIEVE, REGALO), translate-it type-the-answer
(accents optional, so "dias" counts for "días"), scrambles of Spanish words, Connections like
*Colors in Spanish / Coffee drinks / Family members in Spanish / Baby milestones*.

**Difficulty:** vocab builds through the month, so later days re-use earlier words. The goal is
that this works as real practice for her.

### 💝 Mom: How Well Do You Know Your Kids & Grandkids?
**Themes:** entirely built from family fun facts (to be submitted). Questions like "Who
cried at ___?", "Which grandkid's first word was ___?", "Who said: '…'?", photo questions ("Whose
baby picture is this?", using image upload in admin).

**How to submit facts:** send them in any format, e.g. a list like:

```
- Thomas broke his arm jumping off the trampoline in 2004
- Meg's first horse was named Biscuit
- Rafa's favorite food as a kid was …
```

These become multiple choice ("Who broke their arm…?" with the kids' names as choices),
type-the-answer, and "who said it" puzzles. Photos can be uploaded straight in the admin editor.

**Word games:** scrambles of grandkids' names and nicknames, Wordles of family words, and a
Connections built from family facts (*Things Meg loves / Rafa's sayings / …*).

> Until the facts arrive, Mom's Day 1 has a scramble plus a **draft** template question (drafts
> are hidden from players).

### 🐯 Dad: Clemson, SQL, Retro Tech & Theology
**Themes:**
- **Clemson football:** 1981 championship, Danny Ford, Dabo era, 2016 and 2018 titles,
  Death Valley, Howard's Rock, the Hill, traditions, rivalries, legends.
- **SQL:** "what does this query return?", JOIN types, GROUP BY / HAVING, NULL behavior, indexes,
  normalization.
- **Computer engineering, 90s–2010s:** floppies and IDE, IRQs, DOS commands, Pentium bugs, Y2K,
  dial-up, early web, classic chips, RAID, Windows versions.
- **Christian theology (Presbyterian):** Westminster Shorter Catechism, Westminster Confession,
  Reformed history (Calvin, Knox), TULIP, the sacraments, covenant theology.

**Word games:** QUERY/TIGER/ORANGE Wordles, scrambles of catechism terms, Connections like
*SQL keywords / Clemson head coaches / DOS commands / Reformers*.

---

## Shared bonus content (everyone)

### 🎄 Christmas Bonus
Carols and lyrics, Christmas movies, traditions around the world (especially Mexican traditions:
Las Posadas, piñatas, poinsettias/flor de Nochebuena, rosca de reyes), Christmas history, and
holiday food.

### ✝️ Faith & Scripture
An Advent journey through the Nativity, from the prophecies (Isaiah 7 and 9, Micah 5) through
Luke 1–2 and Matthew 1–2, plus Presbyterian and Reformed basics: Westminster Shorter Catechism
questions, Reformation history, and Bible trivia. It runs roughly in story order, ending on
Dec 25 with the birth itself.

| Days | Faith theme |
|---|---|
| 1–6 | Prophecies of the Messiah |
| 7–12 | Zechariah, Elizabeth & John the Baptist; the Annunciation |
| 13–18 | Joseph, the journey to Bethlehem, the shepherds |
| 19–24 | The Magi, Herod, the flight to Egypt; catechism on the Incarnation |
| 25 | "For unto us a child is born" |

---

## Scoring & progress
- Each puzzle is worth its points (trivia 1, big word games 3) if solved.
- A day is ⭐ complete when every puzzle on it is finished (right or wrong).
- The home page shows everyone's points and completed days as a friendly family scoreboard.
- Progress is stored per path, not per device. Optional per-path PINs (set in Admin) stop
  siblings from playing each other's puzzles.

---

## Roadmap

1. ✅ **Phase 1: Framework.** App, gating, progress, five puzzle types, admin editor, Docker,
   Day 1 samples for every path.
2. 🚧 **Phase 2: Templates.** ✅ The new puzzle types (crossword, rebus, verse fill-in, timeline,
   who-said-it, spelling bee) are built, each with a Day 2 sample. Still to do: draft a skeleton of
   all 25 days per path.
3. **Phase 3: Content.** Generate the full question sets per path; collect Mom's family facts;
   review and polish everything in the admin Review tab.
4. **Phase 4: Launch.** Set PINs, clear the date override, deploy before Dec 1, and share the
   link with the family.

'use strict';
/*
 * Real-word checking for Wordle and Spelling Bee.
 *
 * - English: SCOWL word lists via the `wordlist-english` package (American + generic English, sizes 10-70).
 * - Spanish: the `an-array-of-spanish-words` package (no frequency info, so only used for checking guesses).
 * - Blocked words: the `naughty-words` package (en + es) plus a small family-friendly list below
 *   and whatever the admin adds in Admin -> Settings.
 * - Extra allowed words (slang, names, tech terms) also come from Admin -> Settings.
 *
 * Everything is normalized like the puzzles do (uppercase A-Z, accents stripped, N-tilde -> N), kept
 * in Sets, and loaded lazily on first use.
 */

const MIN_LEN = 3;
const MAX_LEN = 15;
const COMMON_TIERS = ['10', '20', '35'];
const ALL_TIERS = ['10', '20', '35', '40', '50', '55', '60', '70'];

function lettersOnly(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

// Words that are in the dictionaries but don't belong in a family Christmas game (and that naughty-words misses).
const FAMILY_BLOCKED = `MOLEST MOLESTED MOLESTER MOLESTING MOLESTS RAPE RAPED RAPES RAPING RAPIST RAPISTS
  NAZI NAZIS NEONAZI SLUT SLUTS SLUTTY WHORE WHORES PEDO PEDOPHILE PAEDOPHILE PEDOPHILES TRANNY RETARD RETARDS RETARDED
  NIGGER NIGGERS NIGGA NIGGAS SPIC SPICS CHINK CHINKS KIKE KIKES GOOK GOOKS DYKE DYKES FAG FAGS FAGGOT FAGGOTS
  CUNT CUNTS FUCK FUCKS FUCKED FUCKER FUCKERS FUCKING SHIT SHITS SHITTY SHITTING PISS PISSED PISSING DILDO DILDOS
  PORN PORNO PORNS BOOBS BOOBIES TWAT TWATS WANK WANKS WANKER WANKERS JIZZ CUM CUMS PRICKS DOUCHE DOUCHEBAG
  ARSE ARSEHOLE ASSHOLE ASSHOLES BASTARDS BITCHY BULLSHIT GODDAMN HOOKER HOOKERS PROSTITUTE PROSTITUTES`.split(/\s+/).filter(Boolean);

// naughty-words entries that are perfectly good (and even Christmassy) ordinary words
const NOT_REALLY_BAD = new Set(['TRIO', 'ESCORT', 'DOMINATION', 'SNOWBALLING', 'BUTT', 'SUCK', 'SUCKS']);

let cache = null;

function load() {
  if (cache) return cache;
  const t0 = Date.now();
  const add = (set, w) => { const n = lettersOnly(w); if (n.length >= MIN_LEN && n.length <= MAX_LEN) set.add(n); };

  const lists = require('wordlist-english');
  const common = new Set();
  const en = new Set();
  for (const t of ALL_TIERS) {
    for (const key of [`english/${t}`, `english/american/${t}`]) {
      for (const w of lists[key] || []) {
        add(en, w);
        if (COMMON_TIERS.includes(t)) add(common, w);
      }
    }
  }

  const naughty = require('naughty-words');
  const blocked = new Set(FAMILY_BLOCKED);
  for (const lang of ['en', 'es']) {
    for (const entry of naughty[lang] || []) {
      if (!/^[\p{L}]+$/u.test(entry)) continue; // single words only
      const n = lettersOnly(entry);
      if (n.length >= MIN_LEN && !NOT_REALLY_BAD.has(n)) blocked.add(n);
    }
  }
  for (const w of NOT_REALLY_BAD) blocked.delete(w);

  cache = { en, common, blocked };
  console.log(`English dictionary loaded in ${Date.now() - t0}ms (${en.size} words, ${common.size} common, ${blocked.size} blocked)`);
  return cache;
}

// Spanish is only loaded the first time a Spanish check happens (it is ~630k words).
let spanish = null;
function loadSpanish() {
  if (spanish) return spanish;
  const t0 = Date.now();
  const spanishPath = require.resolve('an-array-of-spanish-words');
  spanish = new Set();
  for (const w of require('an-array-of-spanish-words')) {
    const n = lettersOnly(w);
    if (n.length >= MIN_LEN && n.length <= MAX_LEN) spanish.add(n);
  }
  delete require.cache[spanishPath]; // the raw array isn't needed once the Set is built
  console.log(`Spanish dictionary loaded in ${Date.now() - t0}ms (${spanish.size} words)`);
  return spanish;
}

// ---- admin-editable custom lists (settings table) ----
let customCache = { allowRaw: null, blockRaw: null, allow: new Set(), block: new Set() };

function parseList(raw) {
  return new Set(String(raw || '').split(/[\s,;]+/).map(lettersOnly).filter(Boolean));
}

// Re-reads the two settings each call but only re-parses when they changed, so saving in admin takes effect at once.
function custom() {
  let allowRaw = '', blockRaw = '';
  try {
    const { getSetting } = require('./db');
    allowRaw = getSetting('dict_allow', '') || '';
    blockRaw = getSetting('dict_block', '') || '';
  } catch { /* no database (e.g. a bare script): no custom words */ }
  if (allowRaw !== customCache.allowRaw || blockRaw !== customCache.blockRaw) {
    customCache = { allowRaw, blockRaw, allow: parseList(allowRaw), block: parseList(blockRaw) };
  }
  return customCache;
}

function isBlocked(word) {
  const w = lettersOnly(word);
  if (!w) return false;
  const c = custom();
  if (c.block.has(w)) return true;
  if (c.allow.has(w)) return false; // an explicit allow beats the built-in blocklist
  return load().blocked.has(w);
}

// lang: 'en' | 'es' | 'any' (English or Spanish)
function isWord(word, lang = 'en') {
  const w = lettersOnly(word);
  if (w.length < MIN_LEN) return false;
  const c = custom();
  if (c.block.has(w)) return false;
  if (c.allow.has(w)) return true;
  const d = load();
  if (d.blocked.has(w)) return false;
  if (lang === 'es') return loadSpanish().has(w);
  if (lang === 'any') return d.en.has(w) || loadSpanish().has(w);
  return d.en.has(w);
}

// Common words for puzzle generation (English only; Spanish has no frequency data -> null).
function commonWords(lang = 'en') {
  if (lang !== 'en') return null;
  return load().common;
}

// All common English words that fit a honeycomb, longest first; pangrams flagged.
function beeSuggestions(center, outer, minLength = 4) {
  const c = lettersOnly(center).slice(0, 1);
  const letters = new Set((c + lettersOnly(outer)).split(''));
  const min = Math.max(MIN_LEN, Number(minLength) || 4);
  const out = [];
  for (const w of commonWords('en')) {
    if (w.length < min || !w.includes(c)) continue;
    if (![...w].every(ch => letters.has(ch))) continue;
    if (isBlocked(w)) continue;
    out.push({ word: w, pangram: [...letters].every(ch => w.includes(ch)) });
  }
  for (const w of custom().allow) { // admin-added words count as suggestions too
    if (w.length < min || !w.includes(c) || ![...w].every(ch => letters.has(ch)) || out.some(o => o.word === w)) continue;
    out.push({ word: w, pangram: [...letters].every(ch => w.includes(ch)) });
  }
  return out.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
}

module.exports = { isWord, isBlocked, commonWords, beeSuggestions, lettersOnly, load };

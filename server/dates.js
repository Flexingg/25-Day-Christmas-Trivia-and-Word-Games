'use strict';
const { getSetting } = require('./db');

const TZ = process.env.TZ || 'America/New_York';
const LAST_DAY = 25;

function eventYear() {
  const fromSetting = parseInt(getSetting('event_year', ''), 10);
  if (fromSetting) return fromSetting;
  const fromEnv = parseInt(process.env.EVENT_YEAR || '', 10);
  if (fromEnv) return fromEnv;
  return Number(todayParts(true).year);
}

// Today's date as {year, month, day} in the configured time zone.
// The admin can override "today" for testing (Settings -> Date override).
function todayParts(ignoreOverride = false) {
  const override = ignoreOverride ? '' : (getSetting('date_override', '') || process.env.DATE_OVERRIDE || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    const [year, month, day] = override.split('-').map(Number);
    return { year, month, day, overridden: true };
  }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), overridden: false };
}

function isoDate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Highest day number (0-25) that is currently playable.
// Before Dec 1 of the event year: 0. Dec 1-25: that day. After Christmas: everything stays open.
function unlockedThrough() {
  const t = todayParts();
  const year = eventYear();
  if (t.year < year || (t.year === year && t.month < 12)) return 0;
  if (t.year > year) return LAST_DAY;
  return Math.min(t.day, LAST_DAY);
}

function calendarInfo() {
  const t = todayParts();
  return {
    today: isoDate(t),
    dateOverridden: t.overridden,
    timeZone: TZ,
    eventYear: eventYear(),
    unlockedThrough: unlockedThrough(),
    lastDay: LAST_DAY,
  };
}

module.exports = { TZ, LAST_DAY, eventYear, todayParts, unlockedThrough, calendarInfo };

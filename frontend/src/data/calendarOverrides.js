import {
  CALENDAR_CATEGORIES,
  getAvailableCalendarYears,
  getCalendarEventsForGregorianYear,
  getNanakshahiMonthDay,
  getNanakshahiYear,
  importanceRank,
  toDateKey,
} from './sikhCalendar';

export const CALENDAR_OVERRIDES_KEY = 'saanj-kirtan.calendarOverrides';

export function readCalendarOverrides() {
  try {
    const raw = localStorage.getItem(CALENDAR_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCalendarOverrides(overrides) {
  try { localStorage.setItem(CALENDAR_OVERRIDES_KEY, JSON.stringify(overrides || [])); } catch { /* noop */ }
}

export function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function calendarEventSourceKey(event) {
  return `${event?.id || ''}:${event?.sourceYear || event?.date?.getFullYear?.() || ''}`;
}

export function decorateCalendarOverride(override) {
  const date = dateFromKey(override.dateKey);
  const nsDetail = getNanakshahiMonthDay(date);
  const category = override.category || 'historical';
  return {
    id: override.id || override.overrideId,
    overrideId: override.overrideId,
    replacesKey: override.replacesKey || '',
    localOverride: true,
    date,
    dateKey: toDateKey(date),
    sourceYear: date.getFullYear(),
    sourceLabel: override.sourceLabel || 'Local correction',
    title: override.title || 'Local calendar event',
    titlePunjabi: override.titlePunjabi || '',
    category,
    categoryLabel: CALENDAR_CATEGORIES[category] || category,
    importance: override.importance || 'normal',
    nsDate: override.nsDate || '',
    nanakshahiYear: getNanakshahiYear(date),
    nanakshahiMonthId: nsDetail.month.id,
    nanakshahiMonth: nsDetail.month.name,
    nanakshahiMonthGurmukhi: nsDetail.month.gurmukhi,
    nanakshahiDay: nsDetail.day,
    summary: override.summary || `${CALENDAR_CATEGORIES[category] || category} observance.`,
    note: override.note || '',
    suggestions: Array.isArray(override.suggestions) ? override.suggestions : [],
  };
}

export function mergeCalendarEvents(baseEvents, overrides, year) {
  const localForYear = (overrides || [])
    .filter((item) => dateFromKey(item.dateKey).getFullYear() === Number(year))
    .map(decorateCalendarOverride);
  const replaced = new Set(localForYear.map((item) => item.replacesKey).filter(Boolean));
  return [
    ...(baseEvents || []).filter((event) => !replaced.has(calendarEventSourceKey(event))),
    ...localForYear,
  ].sort((a, b) => a.date - b.date || importanceRank(b.importance) - importanceRank(a.importance));
}

export function getAvailableCalendarYearsWithOverrides(overrides = readCalendarOverrides(), now = new Date()) {
  const years = new Set([
    now.getFullYear(),
    ...getAvailableCalendarYears(),
    ...(overrides || []).map((item) => dateFromKey(item.dateKey).getFullYear()),
  ]);
  return Array.from(years).filter(Boolean).sort((a, b) => a - b);
}

export function getCalendarEventsForYearWithOverrides(year, overrides = readCalendarOverrides()) {
  return mergeCalendarEvents(getCalendarEventsForGregorianYear(year), overrides, year);
}

export function getCalendarEventsForDateWithOverrides(date = new Date(), overrides = readCalendarOverrides()) {
  const d = date instanceof Date ? date : new Date(date);
  return getCalendarEventsForYearWithOverrides(d.getFullYear(), overrides)
    .filter((event) => event.dateKey === toDateKey(d));
}

export function blankCalendarOverrideDraft(year, month) {
  return {
    overrideId: `local-${Date.now()}`,
    replacesKey: '',
    dateKey: toDateKey(new Date(year, month, 1, 12, 0, 0, 0)),
    titlePunjabi: '',
    title: '',
    category: 'historical',
    importance: 'normal',
    nsDate: '',
    sourceLabel: 'Local correction',
    summary: '',
    note: '',
    suggestions: [],
  };
}

export function draftCalendarOverrideFromEvent(event) {
  return {
    overrideId: `local-${Date.now()}`,
    replacesKey: calendarEventSourceKey(event),
    dateKey: event.dateKey,
    titlePunjabi: event.titlePunjabi || '',
    title: event.title || '',
    category: event.category || 'historical',
    importance: event.importance || 'normal',
    nsDate: event.nsDate || `${event.nanakshahiDay || ''} ${event.nanakshahiMonth || ''}`.trim(),
    sourceLabel: 'Local correction',
    summary: event.summary || '',
    note: event.note || '',
    suggestions: Array.isArray(event.suggestions) ? event.suggestions : [],
  };
}

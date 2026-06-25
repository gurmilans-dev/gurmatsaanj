import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader from '../../components/common/Loader/Loader';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { getMainVerse } from '../../utils/gurmukhi';
import { getMonthKirtanGuide, getRaagSearchSuggestion } from '../../data/kirtanGuidance';
import {
  CALENDAR_CATEGORIES,
  describeNanakshahiDate,
  formatGregorian,
  getAvailableCalendarYears,
  getCalendarEventsForGregorianYear,
  getCalendarSourceForYear,
  getNanakshahiMonthDay,
  getNanakshahiYear,
  getUpcomingCalendarEvents,
  importanceRank,
  toDateKey,
} from '../../data/sikhCalendar';
import {
  blankCalendarOverrideDraft,
  dateFromKey,
  draftCalendarOverrideFromEvent,
  mergeCalendarEvents,
  readCalendarOverrides,
  saveCalendarOverrides,
} from '../../data/calendarOverrides';
import './CalendarPage.css';

const GURMUKHI_RE = /[\u0a00-\u0a7f]/;

const SUGGESTION_TRANSLITERATIONS = {
  'ਵਾਹਿਗੁਰੂ': 'Waheguru',
  'ਪ੍ਰਭਾਤੀ': 'Prabhati',
  'ਆਸਾ ਦੀ ਵਾਰ': 'Aasa di Vaar',
  'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ': 'Anand bhaia meri maae',
  'ਦੇਵਗੰਧਾਰੀ': 'Devgandhari',
  'ਬੈਰਾੜੀ': 'Bhairari',
  'ਸਾਰੰਗ': 'Sarang',
  'ਹਰਿ ਪਹਿਲੜੀ ਲਾਵ': 'Har pehlari laav',
  'ਬਿਲਾਵਲੁ': 'Bilaval',
  'ਗਗਨ ਮੈ ਥਾਲੁ': 'Gagan mai thaal',
  'ਮਾਰੂ': 'Maru',
  'ਤਿਲੰਗ': 'Tilang',
  'ਚੇਤਿ ਗੋਵਿੰਦੁ ਅਰਾਧੀਐ': 'Chet govind aradheeai',
  'ਸੁਖਮਨੀ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮੁ': 'Sukhmani sukh amrit prabh naam',
  'ਤੂ ਸੁਣਿ ਕਿਰਤ ਕਰੰਮਾ': 'Tu sun kirat karamma',
  'ਸਿਰੀਰਾਗੁ': 'Sri Raag',
  'ਕੇਦਾਰਾ': 'Kedara',
  'ਬਸੰਤੁ': 'Basant',
  'ਸੋਰਠਿ': 'Sorath',
  'ਮਲਾਰ': 'Malaar',
  'ਕਾਨੜਾ': 'Kaanra',
  'ਬਾਰਹ ਮਾਹਾ': 'Barah Maha',
  'ਵੈਸਾਖਿ ਧੀਰਨਿ': 'Vaisakh dheerann',
  'ਦੇਹ ਸਿਵਾ ਬਰੁ ਮੋਹਿ': 'Deh Shiva bar mohe',
  'ਹਰਿ ਜੇਠਿ ਜੁੜੰਦਾ': 'Har Jeth juranda',
  'ਹਰਿ ਕਾ ਨਾਮੁ ਰਿਦੈ': 'Har ka naam ridai',
  'ਆਸਾੜੁ ਤਪੰਦਾ': 'Asaarh tapanda',
  'ਤੇਰਾ ਕੀਆ ਮੀਠਾ ਲਾਗੈ': 'Tera kia meetha lage',
  'ਸਾਵਣਿ ਸਰਸੀ': 'Sawan sarasi',
  'ਭਾਦੁਇ ਭਰਮਿ': 'Bhadui bharam',
  'ਬਾਣੀ ਗੁਰੂ ਗੁਰੂ ਹੈ ਬਾਣੀ': 'Bani Guru Guru hai Bani',
  'ਅਸੁਨਿ ਪ੍ਰੇਮ': 'Asun prem',
  'ਗੁਰੂ ਰਾਮਦਾਸ': 'Guru Ram Das',
  'ਕਤਿਕਿ ਕਰਮ': 'Katik karam',
  'ਬੰਧਨ ਕਾਟੇ ਆਪਿ ਪ੍ਰਭਿ': 'Bandhan kaate aap prabh',
  'ਮੰਘਿਰਿ ਮਾਹਿ': 'Manghir maahi',
  'ਭੈ ਕਾਹੂ ਕਉ ਦੇਤ ਨਹਿ': 'Bhai kaahu kau det nehi',
  'ਪੋਖਿ ਤੁਖਾਰੁ': 'Pokh tukhaar',
  'ਸੂਰਾ ਸੋ ਪਹਿਚਾਨੀਐ': 'Soora so pehchaaniai',
  'ਮਾਘਿ ਮਜਨੁ': 'Magh majan',
  'ਸਾਧਸੰਗਤਿ ਕੈਸੀ ਜਾਣੀਐ': 'Sadhsangat kaisi jaaniai',
  'ਫਲਗੁਣਿ': 'Phalgun',
  'ਗੁਰੁ ਪਰਮੇਸਰੁ ਏਕੋ ਜਾਣੁ': 'Gur parmesar eko jaan',
  'ਹਮਰੀ ਕਰੋ ਹਾਥ ਦੈ ਰਛਾ': 'Hamri karo haath dai racha',
  'ਸਲੋਕ ਮਹਲਾ ੯': 'Salok Mahalla 9',
  'ਧੁਰ ਕੀ ਬਾਣੀ ਆਈ': 'Dhur ki Bani aayi',
  'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ': 'Pothi Parmesar ka thaan',
  'ਰਾਖਾ ਏਕੁ ਹਮਾਰਾ ਸੁਆਮੀ': 'Rakha ek hamara suami',
  'ਸਰਬ ਰੋਗ ਕਾ ਅਉਖਦੁ ਨਾਮੁ': 'Sarab rog ka aukhad naam',
  'ਦਇਆ ਕਰਹੁ': 'Daya karo',
  'ਗੁਰ ਨਾਨਕ': 'Gur Nanak',
  'ਸਤਿਗੁਰ ਨਾਨਕ': 'Satgur Nanak',
};

function searchTypeForSuggestion(suggestion) {
  const q = String(suggestion?.query || '').trim();
  if (/^[0-9]+$/.test(q) || suggestion?.mode === 'ang') return 5;
  if (suggestion?.mode === 'initials') return 0;
  if (suggestion?.mode === 'words') return GURMUKHI_RE.test(q) ? 2 : 4;
  return undefined;
}

function suggestionCacheKey(suggestion) {
  return `${suggestion?.mode || 'auto'}:${String(suggestion?.query || '').trim()}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function nanakshahiMonthsForGregorianMonth(year, monthIndex) {
  const sampleDates = [
    new Date(year, monthIndex, 1, 12, 0, 0, 0),
    new Date(year, monthIndex, 15, 12, 0, 0, 0),
    new Date(year, monthIndex + 1, 0, 12, 0, 0, 0),
  ];
  const months = new Map();
  for (const date of sampleDates) {
    const nsDate = getNanakshahiMonthDay(date);
    if (nsDate?.month?.id) months.set(nsDate.month.id, nsDate.month);
  }
  return Array.from(months.values());
}

function buildQueueEntry(item, data) {
  const mainVerse = getMainVerse(data?.verses, data?.meta);
  const firstVerse = data?.verses?.[0] || null;
  return {
    shabadId: data?.meta?.shabadId || item?.shabadId,
    gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || item?.gurmukhi || '',
    mainGurmukhi: mainVerse?.gurmukhi || '',
    firstGurmukhi: firstVerse?.gurmukhi || item?.gurmukhi || '',
    raag: data?.meta?.raag || item?.raag || '',
    writer: data?.meta?.writer || item?.writer || '',
    source: data?.meta?.source || item?.source || '',
    pageNo: data?.meta?.pageNo || item?.pageNo || null,
    queueSessionId: 'kirtan',
  };
}

function gurmukhiLabelFor(suggestion) {
  return suggestion?.labelGurmukhi || suggestion?.gurmukhi || suggestion?.query || suggestion?.label || '';
}

function transliterationLabelFor(suggestion) {
  const query = String(suggestion?.query || '').trim();
  return suggestion?.transliteration ||
    suggestion?.labelTransliteration ||
    SUGGESTION_TRANSLITERATIONS[query] ||
    suggestion?.label ||
    '';
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const { addToQueue, pushToast, shabadQueue, updateSearchState, lang, tLang } = useApp();
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [showTransliteration, setShowTransliteration] = useState(false);
  const [queueingKey, setQueueingKey] = useState('');
  const [resolvedSuggestionIds, setResolvedSuggestionIds] = useState({});
  const [calendarOverrides, setCalendarOverrides] = useState(readCalendarOverrides);
  const [overrideDraft, setOverrideDraft] = useState(null);
  const availableYears = useMemo(() => {
    const years = new Set([
      today.getFullYear(),
      ...getAvailableCalendarYears(),
      ...calendarOverrides.map((item) => dateFromKey(item.dateKey).getFullYear()),
    ]);
    return Array.from(years).filter(Boolean).sort((a, b) => a - b);
  }, [calendarOverrides, today]);
  const calendarSource = useMemo(() => getCalendarSourceForYear(selectedYear), [selectedYear]);
  const selectedYearIndex = Math.max(0, availableYears.indexOf(selectedYear));

  useEffect(() => {
    saveCalendarOverrides(calendarOverrides);
  }, [calendarOverrides]);

  const eventsForYear = useMemo(() => {
    const map = new Map();
    for (const year of availableYears) {
      map.set(year, mergeCalendarEvents(getCalendarEventsForGregorianYear(year), calendarOverrides, year));
    }
    return map;
  }, [availableYears, calendarOverrides]);

  const todayEvents = useMemo(
    () => (eventsForYear.get(today.getFullYear()) || getCalendarEventsForGregorianYear(today.getFullYear()))
      .filter((event) => event.dateKey === toDateKey(today)),
    [eventsForYear, today]
  );
  const todaySuggestedEvent = useMemo(
    () => todayEvents.find((event) => event.suggestions?.length),
    [todayEvents]
  );
  const currentNs = getNanakshahiMonthDay(today);
  const yearEvents = useMemo(
    () => eventsForYear.get(selectedYear) || [],
    [eventsForYear, selectedYear]
  );
  const monthEvents = useMemo(
    () => yearEvents.filter((event) => event.date.getMonth() === Number(selectedMonth)),
    [selectedMonth, yearEvents]
  );
  const selectedMonthGuideContext = useMemo(() => {
    const isCurrentGregorianMonth =
      selectedYear === today.getFullYear() &&
      Number(selectedMonth) === today.getMonth();
    const guideDate = isCurrentGregorianMonth
      ? today
      : new Date(selectedYear, selectedMonth, 15, 12, 0, 0, 0);
    const nsDate = getNanakshahiMonthDay(guideDate);
    return {
      nsDate,
      guide: getMonthKirtanGuide(nsDate.month.id),
    };
  }, [selectedMonth, selectedYear, today]);
  const selectedMonthGuide = selectedMonthGuideContext.guide;
  const selectedMonthGuideNs = selectedMonthGuideContext.nsDate;
  const upcoming = useMemo(() => {
    const currentYear = today.getFullYear();
    const start = new Date(currentYear, today.getMonth(), today.getDate(), 12, 0, 0, 0);
    return [
      ...(eventsForYear.get(currentYear) || getCalendarEventsForGregorianYear(currentYear)),
      ...(eventsForYear.get(currentYear + 1) || getUpcomingCalendarEvents(today, 30)),
    ]
      .filter((event) => event.date >= start)
      .sort((a, b) => a.date - b.date || importanceRank(b.importance) - importanceRank(a.importance))
      .slice(0, 8);
  }, [eventsForYear, today]);

  const monthCounts = useMemo(() => {
    const counts = Array.from({ length: 12 }, () => 0);
    for (const event of yearEvents) {
      counts[event.date.getMonth()] += event.importance === 'major' ? 2 : 1;
    }
    return counts;
  }, [yearEvents]);

  const majorCount = yearEvents.filter((event) => event.importance === 'major').length;

  const visibleEventSuggestions = useMemo(() => {
    const byKey = new Map();
    for (const event of monthEvents) {
      for (const suggestion of event.suggestions || []) {
        const key = suggestionCacheKey(suggestion);
        if (key && !byKey.has(key)) byKey.set(key, suggestion);
      }
    }
    return Array.from(byKey.values());
  }, [monthEvents]);

  const queuedShabadIds = useMemo(() => {
    const ids = new Set();
    for (const item of shabadQueue || []) {
      const sessionId = item?.queueSessionId || item?.sessionId || 'kirtan';
      if (sessionId === 'kirtan' && item?.shabadId) ids.add(String(item.shabadId));
    }
    return ids;
  }, [shabadQueue]);

  useEffect(() => {
    const unresolved = visibleEventSuggestions.filter((suggestion) => {
      const key = suggestionCacheKey(suggestion);
      return key && !Object.prototype.hasOwnProperty.call(resolvedSuggestionIds, key);
    });
    if (!unresolved.length) return undefined;

    let cancelled = false;
    Promise.all(unresolved.map(async (suggestion) => {
      const key = suggestionCacheKey(suggestion);
      try {
        const res = await api.searchShabads({
          q: suggestion.query,
          searchType: searchTypeForSuggestion(suggestion),
        });
        const match = res?.results?.find((item) => item?.shabadId);
        return [key, match?.shabadId ? String(match.shabadId) : ''];
      } catch {
        return [key, ''];
      }
    })).then((entries) => {
      if (cancelled) return;
      setResolvedSuggestionIds((prev) => {
        const next = { ...prev };
        for (const [key, shabadId] of entries) {
          if (!Object.prototype.hasOwnProperty.call(next, key)) next[key] = shabadId;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedSuggestionIds, visibleEventSuggestions]);

  const isSuggestionQueued = (suggestion) => {
    const shabadId = resolvedSuggestionIds[suggestionCacheKey(suggestion)];
    return Boolean(shabadId && queuedShabadIds.has(String(shabadId)));
  };

  const openSearch = (suggestion) => {
    updateSearchState?.({
      query: suggestion.query,
      mode: suggestion.mode || 'auto',
      results: [],
      detectedType: null,
    });
    navigate('/kirtan');
  };

  const changeSelectedYear = (direction) => {
    if (!availableYears.length) return;
    const currentIndex = availableYears.indexOf(selectedYear);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(
      availableYears.length - 1,
      Math.max(0, safeIndex + direction)
    );
    setSelectedYear(availableYears[nextIndex]);
  };

  const startBlankOverride = () => {
    setOverrideDraft(blankCalendarOverrideDraft(selectedYear, selectedMonth));
  };

  const startEventCorrection = (event) => {
    setOverrideDraft(draftCalendarOverrideFromEvent(event));
  };

  const saveOverrideDraft = (event) => {
    event.preventDefault();
    const dateKey = String(overrideDraft?.dateKey || '').trim();
    const title = String(overrideDraft?.title || '').trim();
    const titlePunjabi = String(overrideDraft?.titlePunjabi || '').trim();
    if (!dateKey || (!title && !titlePunjabi)) {
      pushToast?.({
        kind: 'info',
        title: 'Add a title and date',
        message: 'Calendar corrections need at least one title and a Gregorian date.',
      });
      return;
    }

    const nextOverride = {
      ...overrideDraft,
      overrideId: overrideDraft.overrideId || `local-${Date.now()}`,
      id: overrideDraft.id || overrideDraft.overrideId || `local-${Date.now()}`,
      dateKey,
      title,
      titlePunjabi,
      category: overrideDraft.category || 'historical',
      importance: overrideDraft.importance || 'normal',
      sourceLabel: overrideDraft.sourceLabel || 'Local correction',
    };
    setCalendarOverrides((prev) => [
      nextOverride,
      ...prev.filter((item) => item.overrideId !== nextOverride.overrideId),
    ]);
    setSelectedYear(dateFromKey(dateKey).getFullYear());
    setSelectedMonth(dateFromKey(dateKey).getMonth());
    setOverrideDraft(null);
    pushToast?.({
      kind: 'success',
      title: 'Calendar correction saved',
      message: nextOverride.replacesKey ? 'This local correction now replaces the loaded event.' : 'Local event added to the calendar.',
      timeoutMs: 2600,
    });
  };

  const removeOverride = (overrideId) => {
    setCalendarOverrides((prev) => prev.filter((item) => item.overrideId !== overrideId));
    pushToast?.({
      kind: 'info',
      title: 'Calendar correction removed',
      message: 'The original loaded date will show again if this was a correction.',
      timeoutMs: 2400,
    });
  };

  const queueSuggestion = async (suggestion, eventId) => {
    const key = `${eventId}-${suggestion.query}`;
    const cacheKey = suggestionCacheKey(suggestion);
    const cachedShabadId = resolvedSuggestionIds[cacheKey];
    if (cachedShabadId && queuedShabadIds.has(String(cachedShabadId))) return;
    setQueueingKey(key);
    try {
      let result = cachedShabadId
        ? { shabadId: cachedShabadId, gurmukhi: suggestion.query, raag: suggestion.raag }
        : null;
      if (!result) {
        const res = await api.searchShabads({
          q: suggestion.query,
          searchType: searchTypeForSuggestion(suggestion),
        });
        result = res?.results?.find((item) => item?.shabadId);
        if (result?.shabadId) {
          setResolvedSuggestionIds((prev) => ({ ...prev, [cacheKey]: String(result.shabadId) }));
        }
      }
      if (!result) {
        pushToast?.({
          kind: 'info',
          title: 'No Shabad found',
          message: 'Open the search and try a shorter phrase.',
        });
        return;
      }
      if (queuedShabadIds.has(String(result.shabadId))) return;
      const data = await api.getShabad(result.shabadId);
      addToQueue?.(buildQueueEntry(result, data));
      pushToast?.({
        kind: 'success',
        title: 'Added to Kirtan session',
        message: 'Suggested Shabad added from the calendar.',
        timeoutMs: 2200,
      });
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Could not add Shabad',
        message: err?.response?.data?.error || err.message || 'Try searching manually.',
      });
    } finally {
      setQueueingKey('');
    }
  };

  const queueAllSuggestions = async (event) => {
    for (const suggestion of event.suggestions || []) {
      // eslint-disable-next-line no-await-in-loop
      await queueSuggestion(suggestion, event.id);
    }
  };

  const prepareTodaySession = async () => {
    const eventsWithSuggestions = todayEvents.filter((event) => event.suggestions?.length);
    if (!eventsWithSuggestions.length) {
      pushToast?.({
        kind: 'info',
        title: 'No suggestions for today',
        message: 'This date has no prepared Shabad suggestions yet.',
        timeoutMs: 2600,
      });
      return;
    }
    for (const event of eventsWithSuggestions) {
      // eslint-disable-next-line no-await-in-loop
      await queueAllSuggestions(event);
    }
  };

  return (
    <div className="app-container calendar-page">
      <section className="calendar-hero" aria-label="Nanakshahi calendar overview">
        <div className="calendar-hero-main">
          <p className="section-eyebrow" lang={lang}>{tLang('Nanakshahi Calendar', 'ਨਾਨਕਸ਼ਾਹੀ ਜੰਤਰੀ')}</p>
          <h1 lang={lang}>{selectedYear} {tLang('Sikh Calendar', 'ਸਿੱਖ ਜੰਤਰੀ')}</h1>
          <p>
            Today is {describeNanakshahiDate(today)}. Browse the Gregorian year,
            Nanakshahi months, Sangrand, Gurpurabs, Shaheedi days, and suggested Shabads with raag/source hints.
          </p>
          <div className="calendar-source-strip">
            <span>{calendarSource.label}</span>
            {calendarSource.url && (
              <a href={calendarSource.url} target="_blank" rel="noreferrer">Source</a>
            )}
          </div>
        </div>
        <div className="calendar-display-options" aria-label="Calendar display options">
  
          <label className="calendar-transliteration-toggle">
            <input
              type="checkbox"
              checked={showTransliteration}
              onChange={(event) => setShowTransliteration(event.target.checked)}
            />
            <span>Show transliteration</span>
          </label>
        
        </div>
      </section>

      {todayEvents.length > 0 && (
        <section className="calendar-today-detail" aria-label="Important days today">
          <div>
            <p className="section-eyebrow" lang={lang}>{tLang('Today', 'ਅੱਜ')}</p>
            <h2 className="gurmukhi">
              {todayEvents.map((event) => event.titlePunjabi || event.title).join(' + ')}
            </h2>
            {showTransliteration && (
              <p className="calendar-transliteration-line">
                {todayEvents.map((event) => event.title).join(' + ')}
              </p>
            )}
            <p>{formatGregorian(today)} - {currentNs.month.name} {currentNs.day}, Nanakshahi {currentNs.nanakshahiYear}</p>
          </div>
          {todaySuggestedEvent?.suggestions?.[0] && (
            <div className="calendar-today-detail-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={prepareTodaySession}
              >
                Prepare session
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openSearch(todaySuggestedEvent.suggestions[0])}
              >
                Search Suggested Shabad
              </button>
            </div>
          )}
        </section>
      )}

      <section className="calendar-stats" aria-label="Year summary">
        <div>
          <span>{getNanakshahiYear(new Date(selectedYear, 6, 1))}</span>
          <p>Nanakshahi year around {selectedYear}</p>
        </div>
        <div>
          <span>{yearEvents.length}</span>
          <p>observances shown</p>
        </div>
        <div>
          <span>{majorCount}</span>
          <p>major days highlighted</p>
        </div>
      </section>

      <div className="calendar-layout">
        <main className="calendar-main">
          <section className="calendar-month-picker" aria-label="Months">
            {Array.from({ length: 12 }, (_, index) => {
              const date = new Date(selectedYear, index, 1);
              const active = selectedMonth === index;
              const count = monthCounts[index] || 0;
              const nsMonths = nanakshahiMonthsForGregorianMonth(selectedYear, index);
              return (
                <button
                  key={index}
                  type="button"
                  className={active ? 'calendar-month-chip calendar-month-chip-on' : 'calendar-month-chip'}
                  onClick={() => setSelectedMonth(index)}
                >
                  <span className="calendar-month-chip-labels">
                    <strong>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}</strong>
                    <span className="calendar-month-chip-ns gurmukhi">
                      {nsMonths.map((month) => month.gurmukhi).join(' / ')}
                    </span>
                    {showTransliteration && (
                      <span className="calendar-month-chip-translit">
                        {nsMonths.map((month) => month.name).join(' / ')}
                      </span>
                    )}
                  </span>
                  <small>{count || '-'}</small>
                </button>
              );
            })}
          </section>

          <section className="calendar-events-section" aria-label="Selected month observances">
            <header className="calendar-section-head">
              <div>
                <p className="section-eyebrow" lang={lang}>{tLang('Month View', 'ਮਹੀਨੇ ਦਾ ਨਜ਼ਾਰਾ')}</p>
                <h2>{monthLabel(new Date(selectedYear, selectedMonth, 1))}</h2>
              </div>
              <span>{monthEvents.length} event{monthEvents.length === 1 ? '' : 's'}</span>
            </header>

            {!monthEvents.length ? (
              <p className="calendar-empty">
                No verified observances are loaded for this month yet. Add the yearly SGPC table to the calendar data file.
              </p>
            ) : (
              <div className="calendar-event-list">
                {monthEvents.map((event) => (
                  <article
                    key={`${event.id}-${event.dateKey}`}
                    className={`calendar-event-card calendar-event-${event.importance || 'normal'}`}
                  >
                    <div className="calendar-event-date">
                      <strong>{event.date.getDate()}</strong>
                      <span>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(event.date)}</span>
                    </div>
                    <div className="calendar-event-body">
                      <div className="calendar-event-title-row">
                        <div className="calendar-event-title-text">
                          <h3 className={event.titlePunjabi ? 'gurmukhi' : undefined}>
                            {event.titlePunjabi || event.title}
                          </h3>
                          {showTransliteration && event.titlePunjabi && (
                            <p className="calendar-event-title-transliteration">{event.title}</p>
                          )}
                        </div>
                        <div className="calendar-event-actions">
                          <span>{event.categoryLabel}</span>
                          <button type="button" className="btn-ghost calendar-correct-btn" onClick={() => startEventCorrection(event)}>
                            Edit locally
                          </button>
                        </div>
                      </div>
                      <p className="calendar-event-meta">
                        {formatGregorian(event.date)} - {describeNanakshahiDate(event)}
                      </p>
                      <p className="calendar-event-source">
                        {event.localOverride ? 'Local correction' : 'Source'}: {event.sourceLabel || calendarSource.label}
                      </p>
                      <p className="calendar-event-summary">{event.summary}</p>
                      {event.note && <p className="calendar-event-note">{event.note}</p>}
                      {event.suggestions?.length > 0 && (
                        <div className="calendar-suggestions" aria-label={`Suggested Shabads for ${event.title}`}>
                          <div className="calendar-suggestions-head">
                            <span>Suggested Shabads</span>
                            <button type="button" className="btn-ghost calendar-add-all" onClick={() => queueAllSuggestions(event)}>
                              Prepare session
                            </button>
                          </div>
                          <div className="calendar-suggestion-list">
                            {event.suggestions.map((suggestion) => {
                              const key = `${event.id}-${suggestion.query}`;
                              const queued = isSuggestionQueued(suggestion);
                              return (
                                <div key={suggestion.query} className="calendar-suggestion">
                                  <div className="calendar-suggestion-text">
                                    <span className="calendar-suggestion-gurmukhi gurmukhi">{gurmukhiLabelFor(suggestion)}</span>
                                    {showTransliteration && (
                                      <small className="calendar-suggestion-transliteration">
                                        {transliterationLabelFor(suggestion)}
                                      </small>
                                    )}
                                    {suggestion.raag && <small className="calendar-suggestion-raag">{suggestion.raag}</small>}
                                  </div>
                                  <div>
                                    <button type="button" className="btn-ghost" onClick={() => openSearch(suggestion)}>
                                      Search
                                    </button>
                                    <button
                                      type="button"
                                      className={`btn btn-secondary btn-sm calendar-queue-btn${queued ? ' calendar-queue-btn-on' : ''}`}
                                      onClick={() => queueSuggestion(suggestion, event.id)}
                                      disabled={queueingKey === key || queued}
                                      aria-label={queued ? 'Already queued in Kirtan session' : 'Add to Kirtan queue'}
                                    >
                                      {queueingKey === key ? <Loader size="sm" label="" /> : queued ? 'Queued' : 'Queue'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="calendar-side">
          <section className="calendar-side-panel">
            <p className="section-eyebrow">Kirtan Bhaav</p>
            <h2>{selectedMonthGuide.title}</h2>
            <p className="calendar-month-guide-date">
              {selectedMonthGuideNs.month.name} {selectedMonthGuideNs.day}, Nanakshahi {selectedMonthGuideNs.nanakshahiYear}
            </p>
            <p className="calendar-month-bhaav">{selectedMonthGuide.mood}</p>
            <div className="calendar-month-raags">
              {selectedMonthGuide.raags.map((raag) => (
                <button
                  key={raag}
                  type="button"
                  onClick={() => {
                    const suggestion = getRaagSearchSuggestion(raag);
                    if (suggestion) openSearch(suggestion);
                  }}
                  title={`Show Shabads in ${raag}`}
                >
                  {raag}
                </button>
              ))}
            </div>
            <div className="calendar-month-shabads">
              {selectedMonthGuide.suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.label}-${suggestion.query}`}
                  type="button"
                  onClick={() => openSearch(suggestion)}
                >
                  <span className="calendar-month-shabad-text">
                    <span className="calendar-month-shabad-gurmukhi gurmukhi">{gurmukhiLabelFor(suggestion)}</span>
                    {showTransliteration && (
                      <small className="calendar-suggestion-transliteration">
                        {transliterationLabelFor(suggestion)}
                      </small>
                    )}
                  </span>
                  {suggestion.raag && <small className="calendar-month-shabad-raag">{suggestion.raag}</small>}
                </button>
              ))}
            </div>
          </section>

          <section className="calendar-side-panel">
            <p className="section-eyebrow" lang={lang}>{tLang('Upcoming', 'ਆਉਣ ਵਾਲੇ')}</p>
            <h2 lang={lang}>{tLang('Next Important Days', 'ਅਗਲੇ ਮਹੱਤਵਪੂਰਨ ਦਿਨ')}</h2>
            <ol className="calendar-upcoming-list">
              {upcoming.map((event) => (
                <li key={`${event.id}-${event.dateKey}`}>
                  <span>{event.date.getDate()}</span>
                  <div>
                    <strong className={event.titlePunjabi ? 'gurmukhi' : undefined}>
                      {event.titlePunjabi || event.title}
                    </strong>
                    {showTransliteration && event.titlePunjabi && <small>{event.title}</small>}
                    <small>{formatGregorian(event.date)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="calendar-side-panel calendar-override-panel">
            <div className="calendar-override-head">
              <div>
                <p className="section-eyebrow">Local Corrections</p>
                <h2>Dates & Sources</h2>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={startBlankOverride}>
                Add
              </button>
            </div>

            <p className="calendar-override-copy">
              Local edits are saved only in this browser. Use them to adjust committee or Gurudwara calendar dates without changing code.
            </p>
            {calendarOverrides.length > 0 && (
              <ul className="calendar-override-list">
                {calendarOverrides.map((item) => (
                  <li key={item.overrideId}>
                    <div>
                      <strong className={item.titlePunjabi ? 'gurmukhi' : undefined}>
                        {item.titlePunjabi || item.title}
                      </strong>
                      <small>{item.dateKey} - {item.sourceLabel || 'Local correction'}</small>
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => removeOverride(item.overrideId)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="calendar-side-panel calendar-note-panel">
            <p className="section-eyebrow">Data Note</p>
            <p>
              Exact 2026 dates are loaded from the yearly SGPC/SikhNet table. Local corrections let you adjust dates without editing code.
            
            </p>
            {calendarSource.note && <p>{calendarSource.note}</p>}
            <p>{Object.values(CALENDAR_CATEGORIES).join(' - ')}</p>
          </section>
        </aside>
      </div>

      {overrideDraft && (
        <div
          className="calendar-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverrideDraft(null);
          }}
        >
          <section
            className="calendar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-dialog-title"
          >
            <header className="calendar-dialog-head">
              <div>
                <p className="section-eyebrow">Local calendar edit</p>
                <h2 id="calendar-dialog-title">
                  {overrideDraft.replacesKey ? 'Edit this date locally' : 'Add local date'}
                </h2>
                <p>
                  This stays on this device. Use it when the loaded source date differs from your local sangat schedule.
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost calendar-dialog-close"
                onClick={() => setOverrideDraft(null)}
                aria-label="Close local calendar edit"
              >
                x
              </button>
            </header>

            <form className="calendar-override-form" onSubmit={saveOverrideDraft}>
              <label>
                <span>Gregorian date</span>
                <input
                  type="date"
                  value={overrideDraft.dateKey}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, dateKey: event.target.value }))}
                />
              </label>
              <label>
                <span>Punjabi title</span>
                <input
                  value={overrideDraft.titlePunjabi}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, titlePunjabi: event.target.value }))}
                />
              </label>
              <label>
                <span>Transliteration / English</span>
                <input
                  value={overrideDraft.title}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, title: event.target.value }))}
                />
              </label>
              <div className="calendar-override-two">
                <label>
                  <span>Category</span>
                  <select
                    value={overrideDraft.category}
                    onChange={(event) => setOverrideDraft((draft) => ({ ...draft, category: event.target.value }))}
                  >
                    {Object.entries(CALENDAR_CATEGORIES).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Importance</span>
                  <select
                    value={overrideDraft.importance}
                    onChange={(event) => setOverrideDraft((draft) => ({ ...draft, importance: event.target.value }))}
                  >
                    <option value="normal">Normal</option>
                    <option value="major">Major</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Nanakshahi label</span>
                <input
                  placeholder="04 Harh"
                  value={overrideDraft.nsDate}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, nsDate: event.target.value }))}
                />
              </label>
              <label>
                <span>Source</span>
                <input
                  value={overrideDraft.sourceLabel}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, sourceLabel: event.target.value }))}
                />
              </label>
              <label>
                <span>Note</span>
                <textarea
                  rows="3"
                  value={overrideDraft.note}
                  onChange={(event) => setOverrideDraft((draft) => ({ ...draft, note: event.target.value }))}
                />
              </label>
              <div className="calendar-override-actions">
                <button type="button" className="btn-ghost" onClick={() => setOverrideDraft(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">Save</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

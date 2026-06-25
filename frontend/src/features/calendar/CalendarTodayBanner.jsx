import { Link } from 'react-router-dom';
import {
  describeNanakshahiDate,
  formatGregorian,
} from '../../data/sikhCalendar';
import { getCalendarEventsForDateWithOverrides } from '../../data/calendarOverrides';
import { getRecommendedBaniForCalendarEvents } from '../../data/baniSets';
import './CalendarTodayBanner.css';

export default function CalendarTodayBanner() {
  const today = new Date();
  const events = getCalendarEventsForDateWithOverrides(today);
  if (!events.length) return null;

  const major = events.find((event) => event.importance === 'major') || events[0];
  const extraCount = Math.max(0, events.length - 1);
  const recommendedBanis = getRecommendedBaniForCalendarEvents(events, 3);

  return (
    <section className="calendar-today-banner" aria-label="Today in the Nanakshahi calendar">
      <div className="calendar-today-spark" aria-hidden="true" />
      <div className="calendar-today-copy">
        <p className="section-eyebrow">Today</p>
        <h2>{major.title}</h2>
        <p>
          {formatGregorian(today)} - {describeNanakshahiDate(major)}
          {extraCount > 0 ? ` - ${extraCount} more observance${extraCount === 1 ? '' : 's'}` : ''}
        </p>
        {recommendedBanis.length > 0 && (
          <div className="calendar-today-recommendations" aria-label="Recommended Bani for today">
            <span>Recommended</span>
            {recommendedBanis.map((item) => (
              <Link key={item.id} to={`/bani/${item.id}`} className="calendar-today-bani-link">
                {item.title}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="calendar-today-actions">
        <Link to="/calendar" className="btn btn-primary btn-sm calendar-today-link">
          Prepare session
        </Link>
        <Link to="/calendar" className="btn btn-secondary btn-sm calendar-today-link">
          Open Calendar
        </Link>
      </div>
    </section>
  );
}

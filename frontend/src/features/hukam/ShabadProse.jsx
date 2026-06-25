import { renderGurmukhiLine, pickPunjabiSteek } from '../shabadView/ShabadView';
import '../shabadView/ShabadView.css'; // .shabad-word-* vishraam/rahao colours
import './ShabadProse.css';

/**
 * "Prose" / hukamnama-style layout for a shabad: the full Gurmukhi shabad
 * (every pankti stacked), then the whole meaning as flowing paragraphs —
 * Punjabi (Sahib Singh) arth first, then the English translation.
 *
 * This is the traditional way a Hukamnama is shared: read the shabad, then
 * the explanation as continuous prose rather than line-by-line. It's purely
 * presentational and reuses the same verse shape — and the same Gurmukhi
 * rendering (vishraam pause words, rahao marker, danda) as the reader, via
 * the shared renderGurmukhiLine() — so it stays visually consistent and can
 * be offered as a toggle on any shabad, not just today's Hukam.
 *
 * Props:
 *   meta    — { raag, writer, source, pageNo }
 *   verses  — [{ gurmukhi, vishraams, translationEn, translationPa, translationPaChannels }]
 *   lang, tLang  — from useApp(), for bilingual labels
 *   larivaar     — render Gurmukhi continuously (default false; prose reads
 *                  better with word spacing)
 *   punjabiSteek — preferred steek channel ('ss' | 'ft' | 'ms' | 'bdb')
 */

function joinParagraph(verses, pick) {
  if (!Array.isArray(verses)) return '';
  return verses
    .map((v) => String(pick(v) || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ShabadProse({
  meta = {},
  verses = [],
  lang = 'en',
  tLang,
  larivaar = false,
  punjabiSteek = 'ss',
}) {
  const t = typeof tLang === 'function' ? tLang : (en) => en;

  const paParagraph = joinParagraph(verses, (v) => pickPunjabiSteek(v, punjabiSteek));
  const enParagraph = joinParagraph(verses, (v) => v?.translationEn);

  const metaPills = [
    meta.raag   && { label: t('Raag', 'ਰਾਗ'),   value: meta.raag,   muted: false },
    meta.writer && { label: t('Writer', 'ਲਿਖਾਰੀ'), value: meta.writer, muted: false },
    meta.source && { label: t('Granth', 'ਗ੍ਰੰਥ'), value: meta.source, muted: true },
    meta.pageNo && { label: t('Ang', 'ਅੰਗ'),    value: meta.pageNo, muted: true },
  ].filter(Boolean);

  return (
    <article className="shabad-prose">
      {metaPills.length > 0 && (
        <div className="shabad-prose-meta">
          {metaPills.map((pill, i) => (
            <span key={i} className={`meta-pill${pill.muted ? ' meta-pill-muted' : ''}`}>
              <span className="meta-pill-label">{pill.label}</span>
              {pill.value}
            </span>
          ))}
        </div>
      )}

      {/* Block 1 — the full shabad, every pankti stacked, with vishraams. */}
      <section className="shabad-prose-gurmukhi gurmukhi" lang="pa" aria-label={t('Shabad', 'ਸ਼ਬਦ')}>
        {verses.map((v, i) => (
          <p key={v?.verseId ?? i} className={`shabad-prose-line${larivaar ? ' shabad-prose-line-larivaar' : ''}`}>
            {renderGurmukhiLine(v?.gurmukhi, v?.vishraams, larivaar)}
          </p>
        ))}
      </section>

      {/* Block 2 — meaning as flowing prose. Punjabi arth, then English. */}
      {paParagraph && (
        <section className="shabad-prose-translation">
          <h3 className="shabad-prose-tr-label" lang="pa">{t('Arth', 'ਅਰਥ')}</h3>
          <p className="shabad-prose-tr-body gurmukhi" lang="pa">{paParagraph}</p>
        </section>
      )}

      {enParagraph && (
        <section className="shabad-prose-translation">
          <h3 className="shabad-prose-tr-label">{t('Translation', 'ਅਨੁਵਾਦ')}</h3>
          <p className="shabad-prose-tr-body">{enParagraph}</p>
        </section>
      )}

      {!paParagraph && !enParagraph && (
        <p className="shabad-prose-empty">
          {t('Translation is not available for this shabad.', 'ਇਸ ਸ਼ਬਦ ਲਈ ਅਨੁਵਾਦ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।')}
        </p>
      )}
    </article>
  );
}

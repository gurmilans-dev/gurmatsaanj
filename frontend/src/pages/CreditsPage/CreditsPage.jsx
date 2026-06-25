import './CreditsPage.css';

const CURRENT_YEAR = new Date().getFullYear();

const CREDIT_LINKS = [
  {
    label: 'BaniDB',
    href: 'https://www.banidb.com/',
    description: 'Gurbani API, scripture data, translations, transliterations, metadata, and related resources used by this app.',
  },
  {
    label: 'BaniDB Terms of Service',
    href: 'https://www.banidb.com/tos/',
    description: 'Terms that apply to BaniDB, the BaniDB API, and BaniDB data.',
  },
  {
    label: 'NPOSL-3.0',
    href: 'https://www.banidb.com/nposl/',
    description: 'The license BaniDB identifies for BaniDB API data, subordinate to BaniDB terms.',
  },
  {
    label: 'Khalis Foundation',
    href: 'https://khalisfoundation.org/',
    description: 'Maintainer/affiliate connected with BaniDB and several public Gurbani resources.',
  },
  {
    label: 'SikhiToTheMax',
    href: 'https://www.sikhitothemax.org/',
    description: 'A separate Gurbani application and BaniDB partner. Gurmat Saanj is not affiliated with or endorsed by SikhiToTheMax.',
  },
];

// Specific translators / steek authors whose work the app displays (these are
// the channels behind the in-app steek toggle: Sahib Singh / Faridkot /
// Manmohan Singh) plus the English meanings. Rights remain with each author;
// the content reaches the app via BaniDB.
const TRANSLATION_CREDITS = [
  {
    label: 'Prof. Sahib Singh',
    description: 'Sri Guru Granth Sahib Darpan — Punjabi steek (the default "Sahib Singh" channel).',
  },
  {
    label: 'Faridkot Teeka',
    description: 'Faridkot Wala Teeka — classical Punjabi exegesis.',
  },
  {
    label: 'Bhai Manmohan Singh',
    description: 'English and Punjabi translation of Sri Guru Granth Sahib Ji.',
  },
  {
    label: 'English translations',
    description: 'English meanings delivered through BaniDB. Rights remain with the respective translators.',
  },
];

// Open-source software, fonts, and the in-browser ML model used by the app.
const TECH_CREDITS = [
  {
    label: 'multilingual-e5-small',
    href: 'https://huggingface.co/intfloat/multilingual-e5-small',
    description: 'Sentence-embedding model powering "By meaning" search, run entirely in your browser via Hugging Face Transformers.js (Xenova build). Used under its open licence.',
  },
  {
    label: 'Gurmukhi & display fonts',
    href: 'https://fonts.google.com/',
    description: 'Noto Serif Gurmukhi, Mukta Mahee, and Fraunces — SIL Open Font License, served via Google Fonts.',
  },
  {
    label: 'Open-source libraries',
    href: null,
    description: 'Built with React, Vite, Express, fuzzball, axios, and other open-source projects, each under its own licence.',
  },
];

function CreditEntry({ label, href, description }) {
  const className = `credits-link-card${href ? '' : ' credits-link-card-static'}`;
  const body = (
    <>
      <strong>{label}</strong>
      <span>{description}</span>
    </>
  );
  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

export default function CreditsPage() {
  return (
    <div className="app-container credits-page">
      <header className="credits-hero">
        <p className="section-eyebrow">Copyright · License · Credits</p>
        <h1>Credits & Data Sources</h1>
        <p>
          Gurmat Saanj is built as seva for live Kirtan, Katha, Bani reading,
          projector control, and remote operation. This page separates the
          original app work from the Gurbani data and third-party resources it uses.
        </p>
      </header>

      <section className="credits-grid" aria-label="Copyright and license summary">
        <article className="credits-card credits-card-primary">
          <span className="credits-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 6.5c2.6-1.2 5.1-1.2 8 0 2.9-1.2 5.4-1.2 8 0v12c-2.6-1.2-5.1-1.2-8 0-2.9-1.2-5.4-1.2-8 0v-12Z" />
              <path d="M12 6.5v12" />
            </svg>
          </span>
          <div>
            <h2>Original App</h2>
            <p>
              Original Gurmat Saanj code, interface design, live-session workflows,
              app name, and app branding are © {CURRENT_YEAR} Gurmat Saanj,
              unless otherwise noted.
            </p>
          </div>
        </article>

        <article className="credits-card">
          <span className="credits-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3Z" />
              <path d="m9 12 2 2 4-5" />
            </svg>
          </span>
          <div>
            <h2>Gurbani & BaniDB Data</h2>
            <p>
              Gurbani text, translations, transliterations, vishraam information,
              Ang/Shabad metadata, and Bani resources may be delivered through
              BaniDB. Gurmat Saanj does not claim copyright or ownership over
              BaniDB, the BaniDB API, or data provided by BaniDB. Some of this
              data may be cached or bundled on your device to support offline
              use, under BaniDB&rsquo;s terms.
            </p>
          </div>
        </article>

        <article className="credits-card">
          <span className="credits-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 8h10M7 12h10M7 16h6" />
              <path d="M5 3h14a1 1 0 0 1 1 1v16l-4-2-4 2-4-2-4 2V4a1 1 0 0 1 1-1Z" />
            </svg>
          </span>
          <div>
            <h2>License Notice</h2>
            <p>
              BaniDB states that BaniDB API Data is subject to the Non-Profit Open
              Software License 3.0, and also to BaniDB Terms of Service. Please
              review those terms before distributing or publicly deploying this app.
            </p>
          </div>
        </article>

        <article className="credits-card">
          <span className="credits-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 21s7-4.4 7-11a7 7 0 0 0-14 0c0 6.6 7 11 7 11Z" />
              <path d="M9.5 10.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0-5 0Z" />
            </svg>
          </span>
          <div>
            <h2>No Affiliation Claim</h2>
            <p>
              Gurmat Saanj is an independent app. Names such as BaniDB,
              Khalis Foundation, SikhiToTheMax, and iGurbani belong to their
              respective owners. Their names are used here only for attribution.
            </p>
          </div>
        </article>
      </section>

      <section className="credits-section">
        <div className="credits-section-head">
          <p className="section-eyebrow">Acknowledgements</p>
          <h2>Resources Used</h2>
        </div>
        <div className="credits-links">
          {CREDIT_LINKS.map((item) => (
            <a key={item.href} className="credits-link-card" href={item.href} target="_blank" rel="noreferrer">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="credits-section">
        <div className="credits-section-head">
          <p className="section-eyebrow">Gurbani Translations</p>
          <h2>Translations & Steeks</h2>
          <p>
            Steeks and translations shown in the app are the work of these
            authors, reaching Gurmat Saanj through BaniDB. All rights remain
            with the respective authors and publishers.
          </p>
        </div>
        <div className="credits-links">
          {TRANSLATION_CREDITS.map((item) => (
            <CreditEntry key={item.label} label={item.label} description={item.description} />
          ))}
        </div>
      </section>

      <section className="credits-section">
        <div className="credits-section-head">
          <p className="section-eyebrow">Software & Fonts</p>
          <h2>Open Source & Technology</h2>
          <p>
            Gurmat Saanj is built on open-source software and an in-browser
            language model, each used under its own licence.
          </p>
        </div>
        <div className="credits-links">
          {TECH_CREDITS.map((item) => (
            <CreditEntry key={item.label} label={item.label} href={item.href} description={item.description} />
          ))}
        </div>
      </section>

      <section className="credits-section credits-notes">
        <div className="credits-section-head">
          <p className="section-eyebrow">Respectful Use</p>
          <h2>Corrections & Responsibility</h2>
        </div>
        <p>
          Because this app displays Gurbani and related translations, accuracy matters.
          If a line, translation, source, Ang, vishraam, or metadata item appears wrong,
          it should be corrected in the app and, where the issue comes from upstream
          data, reported back to the data source so the wider Sangat can benefit.
        </p>
        <p>
          This page is an attribution and licensing notice for the app. It is not legal
          advice. For public distribution, commercial use, or institutional deployment,
          review the source licenses directly.
        </p>
      </section>
    </div>
  );
}

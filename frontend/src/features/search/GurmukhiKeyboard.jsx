import { useState } from 'react';
import './GurmukhiKeyboard.css';

/**
 * On-screen Gurmukhi keyboard.
 *
 * Three tabs:
 *   - ਅੱਖਰ  (ੴ, independent vowels, consonants, nukta letters)
 *   - ਮਾਤਰਾ (vowel signs, nasal marks, addak, halant)
 *   - ੧੨੩   (digits & punctuation)
 *
 * The component is purely presentational. It calls `onInsert(char)` and
 * `onBackspace()` callbacks on the parent, which inserts at the input's
 * current caret position so users can type into the middle of words.
 */

const TABS = [
  { id: 'akhar', label: 'ਅੱਖਰ' },
  { id: 'matra', label: 'ਮਾਤਰਾ' },
  { id: 'num', label: '੧੨੩' },
];

const KEYS = {
  akhar: [
    ['ੴ', 'ਉ', 'ਊ', 'ਓ', 'ਆ', 'ਐ', 'ਔ', 'ਇ', 'ਈ', 'ਏ'],
    ['ੳ', 'ਅ', 'ੲ', 'ਸ', 'ਹ', 'ਕ', 'ਖ', 'ਗ', 'ਘ', 'ਙ'],
    ['ਚ', 'ਛ', 'ਜ', 'ਝ', 'ਞ','ਟ', 'ਠ', 'ਡ', 'ਢ', 'ਣ'],
    ['ਤ', 'ਥ', 'ਦ', 'ਧ', 'ਨ','ਪ', 'ਫ', 'ਬ', 'ਭ', 'ਮ'],
    [ 'ਯ', 'ਰ', 'ਲ', 'ਵ', 'ੜ'],
    [ 'ਸ਼', 'ਖ਼', 'ਗ਼', 'ਜ਼', 'ਫ਼', 'ਲ਼'],
  ],
  matra: [
    ['ਾ', 'ਿ', 'ੀ', 'ੁ', 'ੂ', 'ੇ', 'ੈ', 'ੋ', 'ੌ'],
    ['ੰ', 'ਂ', 'ਃ', 'ੱ', '੍', '਼'],
    ['੍ਹ', '੍ਯ', '੍ਰ', '੍ਵ', '੍ਨ'],
  ],
  num: [
    ['੦', '੧', '੨', '੩', '੪', '੫', '੬', '੭', '੮', '੯'],
    ['।', '॥', ',', '.', '?', '!', '-', "'", '"'],
  ],
};

// Some matras are awkward to read on their own. Show a dotted circle base
// (U+25CC) with the matra applied so the user sees the actual glyph shape.
const NEEDS_DOTTED = new Set([
  'ਾ', 'ਿ', 'ੀ', 'ੁ', 'ੂ', 'ੇ', 'ੈ', 'ੋ', 'ੌ',
  'ੰ', 'ਂ', 'ਃ', 'ੱ', '੍', '਼',
  '੍ਹ', '੍ਯ', '੍ਰ', '੍ਵ', '੍ਨ',
]);

export default function GurmukhiKeyboard({ onInsert, onBackspace, onSpace, onClose }) {
  const [tab, setTab] = useState('akhar');

  const renderKey = (keyValue) => {
    const display = NEEDS_DOTTED.has(keyValue) ? `◌${keyValue}` : keyValue;
    return (
      <button
        key={keyValue}
        type="button"
        className="kb-key"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert(keyValue)}
        aria-label={`Insert ${keyValue}`}
      >
        {display}
      </button>
    );
  };

  return (
    <section className="kb" aria-label="Gurmukhi keyboard">
      <header className="kb-header">
        <div className="kb-tabs" role="tablist">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.id}
              className={`kb-tab gurmukhi${tab === tabItem.id ? ' kb-tab-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTab(tabItem.id)}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="kb-close"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          aria-label="Close keyboard"
        >
          x
        </button>
      </header>

      <div className="kb-rows" role="tabpanel">
        {KEYS[tab].map((row, index) => (
          <div key={index} className="kb-row">
            {row.map(renderKey)}
          </div>
        ))}

        <div className="kb-row kb-row-controls">
          <button
            type="button"
            className="kb-key kb-key-wide"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onSpace}
            aria-label="Space"
          >
            space
          </button>
          <button
            type="button"
            className="kb-key kb-key-wide kb-key-danger"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onBackspace}
            aria-label="Backspace"
          >
            backspace
          </button>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import GurmukhiKeyboard from './GurmukhiKeyboard';
import './SearchBar.css';

/**
 * Debounced search bar with an optional on-screen Gurmukhi keyboard.
 *
 * Insert / backspace operate at the current caret position, so users can
 * edit in the middle of a word.
 */
export default function SearchBar({
  value, onChange, onSearch, onClear, placeholder, debounceMs = 350, inputMode,
  trailing = null,        // optional element rendered to the right of the input (e.g. mic button)
  showHint = true,        // show the dim helper line under the bar
  showSubmit = true,      // show the inline Search button (hidden on the new compact hero)
}) {
  const [internal, setInternal] = useState(value || '');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (value !== undefined && value !== internal) setInternal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fireSearch = (v) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch?.(v), debounceMs);
  };

  const update = (next) => {
    setInternal(next);
    onChange?.(next);
    fireSearch(next);
  };

  const handleChange = (e) => update(e.target.value);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch?.(internal);
  };

  const handleClear = () => {
    update('');
    onClear?.();
    inputRef.current?.focus();
  };

  // Caret-aware insert / delete -------------------------------------------
  const insertAtCaret = (text) => {
    const el = inputRef.current;
    if (!el) {
      update(internal + text);
      return;
    }
    const start = el.selectionStart ?? internal.length;
    const end = el.selectionEnd ?? internal.length;
    const next = internal.slice(0, start) + text + internal.slice(end);
    update(next);
    // restore caret after the inserted text
    requestAnimationFrame(() => {
      const pos = start + text.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const deleteAtCaret = () => {
    const el = inputRef.current;
    if (!el) {
      update(internal.slice(0, -1));
      return;
    }
    const start = el.selectionStart ?? internal.length;
    const end = el.selectionEnd ?? internal.length;
    let next, pos;
    if (start !== end) {
      next = internal.slice(0, start) + internal.slice(end);
      pos = start;
    } else if (start > 0) {
      // Delete the previous full code point (handles surrogate pairs / matras).
      const before = internal.slice(0, start);
      const codePoints = Array.from(before);
      codePoints.pop();
      next = codePoints.join('') + internal.slice(end);
      pos = next.length - (internal.length - end);
    } else {
      return;
    }
    update(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="search-bar-wrap">
      <form className="search-bar" onSubmit={handleSubmit} role="search">
        <svg viewBox="0 0 24 24" className="search-bar-icon" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type={inputMode === 'numeric' ? 'number' : 'text'}
          inputMode={inputMode}
          min={inputMode === 'numeric' ? 1 : undefined}
          className="search-bar-input"
          placeholder={placeholder || 'Search Gurmukhi, English, or first letters (e.g. mjjj)…'}
          value={internal}
          onChange={handleChange}
          autoComplete="off"
          spellCheck="false"
          aria-label="Search shabads"
        />
        {internal && (
          <button type="button" className="search-bar-clear" onClick={handleClear} aria-label="Clear search">
            ✕
          </button>
        )}
        <button
          type="button"
          className={`search-bar-kb-toggle${showKeyboard ? ' search-bar-kb-toggle-active' : ''}`}
          onClick={() => setShowKeyboard((v) => !v)}
          aria-pressed={showKeyboard}
          aria-label="Toggle Gurmukhi keyboard"
          title="Toggle Gurmukhi keyboard"
        >
          <svg
            viewBox="0 0 22 14"
            className="search-bar-kb-glyph"
            width="18"
            height="12"
            aria-hidden="true"
          >
            <rect x="0.6" y="0.6" width="20.8" height="12.8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <g fill="currentColor">
              <rect x="2.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="5.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="8.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="11.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="14.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="17.6" y="3" width="1.8" height="1.8" rx="0.4" />
              <rect x="2.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="5.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="8.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="11.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="14.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="17.6" y="6" width="1.8" height="1.8" rx="0.4" />
              <rect x="5.6" y="9" width="10.8" height="1.8" rx="0.4" />
            </g>
          </svg>
        </button>
        {trailing && <span className="search-bar-trailing">{trailing}</span>}
        {showSubmit && (
          <button type="submit" className="btn btn-primary search-bar-submit">Search</button>
        )}
      </form>

      {showHint && (
        <p className="search-bar-hint">
          Tip: type Roman first-letters like <code className="search-bar-code">mjjj</code> for{' '}
          <span className="gurmukhi">ਮਨ ਜੀਤੈ ਜਗੁ ਜੀਤੁ</span>, or tap the keyboard to type Gurmukhi.
        </p>
      )}

      {showKeyboard && (
        <GurmukhiKeyboard
          onInsert={insertAtCaret}
          onBackspace={deleteAtCaret}
          onSpace={() => insertAtCaret(' ')}
          onClose={() => setShowKeyboard(false)}
        />
      )}
    </div>
  );
}

import { SEMANTIC_THEME_CHIPS } from '../../data/semanticThemeChips';
import './SemanticThemeChips.css';

/**
 * Horizontally scrollable row of one-tap "theme" chips for the "By meaning"
 * search mode. Tap → fills the input with the chip's richer seed query and
 * fires the search (parent handles both via `onPick`).
 */
export default function SemanticThemeChips({ lang = 'en', onPick }) {
  return (
    <div className="semantic-chips" role="list" aria-label="Theme suggestions">
      {SEMANTIC_THEME_CHIPS.map((chip) => {
        const label = lang === 'pa' ? (chip.labelPa || chip.labelEn) : chip.labelEn;
        return (
          <button
            key={chip.id}
            type="button"
            role="listitem"
            className="semantic-chip"
            onClick={() => onPick?.(chip)}
            title={chip.seed}
            lang={lang}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

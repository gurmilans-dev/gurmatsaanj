// Theme suggestion chips for the "By meaning" search mode.
//
// Each chip has a short bilingual display label and a richer seed query.
// The seed is what actually gets embedded — chip labels alone are too short
// to produce useful embeddings. When the user taps a chip, the input fills
// with the seed (so the user can see the words being searched), and the
// existing debounced search effect picks it up.
//
// Keep this list short and curated. Twelve fits a single horizontal-scroll
// row on a 390 px phone; more than that and the eye glazes over.

export const SEMANTIC_THEME_CHIPS = [
  {
    id: 'happiness',
    labelEn: 'Happiness',
    labelPa: 'ਖੁਸ਼ੀ',
    seed: 'joy bliss anand happiness celebration',
  },
  {
    id: 'grief',
    labelEn: 'Grief',
    labelPa: 'ਉਦਾਸੀ',
    seed: 'grief loss mourning sadness comfort',
  },
  {
    id: 'birthday',
    labelEn: 'Birthday',
    labelPa: 'ਜਨਮ ਦਿਨ',
    seed: 'birth naam karan child blessing',
  },
  {
    id: 'wedding',
    labelEn: 'Wedding',
    labelPa: 'ਵਿਆਹ',
    seed: 'marriage anand karaj union of souls lavaan',
  },
  {
    id: 'antam',
    labelEn: 'Antam (memorial)',
    labelPa: 'ਅੰਤਮ ਸਮੇਂ',
    seed: 'death memorial souls journey afterlife antam sanskar',
  },
  {
    id: 'protection',
    labelEn: 'Protection',
    labelPa: 'ਰੱਖਿਆ',
    seed: 'protection shelter fearlessness rakhia divine refuge',
  },
  {
    id: 'peace',
    labelEn: 'Peace',
    labelPa: 'ਸ਼ਾਂਤੀ',
    seed: 'peace stillness calm of mind contentment',
  },
  {
    id: 'strength',
    labelEn: 'Strength',
    labelPa: 'ਸ਼ਕਤੀ',
    seed: 'courage strength inner resolve fearlessness',
  },
  {
    id: 'naam-simran',
    labelEn: 'Naam Simran',
    labelPa: 'ਨਾਮ ਸਿਮਰਨ',
    seed: 'naam simran remembrance meditation chanting waheguru',
  },
  {
    id: 'gratitude',
    labelEn: 'Gratitude',
    labelPa: 'ਸ਼ੁਕਰਾਨਾ',
    seed: 'gratitude thankfulness blessings appreciation',
  },
  {
    id: 'forgiveness',
    labelEn: 'Forgiveness',
    labelPa: 'ਖਿਮਾ',
    seed: 'forgiveness humility seeking pardon ego',
  },
  {
    id: 'healing',
    labelEn: 'Healing',
    labelPa: 'ਅਰੋਗਤਾ',
    seed: 'healing recovery illness body spirit',
  },
];

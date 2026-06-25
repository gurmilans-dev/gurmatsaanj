import { getNanakshahiMonthDay } from './sikhCalendar';

export const RAAG_TIMING_SOURCES = [
  {
    label: 'SikhiWiki raag timing table',
    url: 'https://www.sikhiwiki.org/index.php/Timings_For_Gurbani_Raag',
  },
  {
    label: 'SearchGurbani raag timing table',
    url: 'https://www.searchgurbani.com/raags/raags_time',
  },
];

export const PEHAR_GUIDES = [
  {
    id: 'late-night',
    startHour: 0,
    endHour: 3,
    label: 'Late night',
    timeLabel: '12am - 3am',
    note: 'Keep this quiet and simple. Some raag charts vary here; for live seva, simran, nitnem, or a soft continuation is safest.',
    raags: ['Jaijawanti', 'Bhairav'],
    suggestions: [
      { label: 'Simran / Waheguru', query: 'ਵਾਹਿਗੁਰੂ', mode: 'words', raag: 'Simran' },
      { label: 'Prabhati preparation', query: 'ਪ੍ਰਭਾਤੀ', mode: 'words', raag: 'Raag Prabhati' },
    ],
  },
  {
    id: 'amrit-vela',
    startHour: 3,
    endHour: 6,
    label: 'Amrit vela',
    timeLabel: '3am - 6am',
    note: 'Best for awakening, ardaas, inner discipline, and morning bani.',
    raags: ['Aasa', 'Ramkali', 'Bhairav', 'Prabhati'],
    suggestions: [
      { label: 'Aasa di Vaar', query: 'ਆਸਾ ਦੀ ਵਾਰ', mode: 'words', raag: 'Raag Aasa' },
      { label: 'Anand Sahib', query: 'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ', mode: 'words', raag: 'Raag Ramkali' },
      { label: 'Prabhati', query: 'ਪ੍ਰਭਾਤੀ', mode: 'words', raag: 'Raag Prabhati' },
    ],
  },
  {
    id: 'early-morning',
    startHour: 6,
    endHour: 9,
    label: 'Morning',
    timeLabel: '6am - 9am',
    note: 'Clear, devotional morning mood.',
    raags: ['Bhairari', 'Devgandhari'],
    suggestions: [
      { label: 'Devgandhari', query: 'ਦੇਵਗੰਧਾਰੀ', mode: 'words', raag: 'Raag Devgandhari' },
      { label: 'Bhairari', query: 'ਬੈਰਾੜੀ', mode: 'words', raag: 'Raag Bhairari' },
    ],
  },
  {
    id: 'forenoon',
    startHour: 9,
    endHour: 12,
    label: 'Forenoon',
    timeLabel: '9am - 12pm',
    note: 'Good for bright, steady, and sangat-friendly kirtan.',
    raags: ['Sarang', 'Suhi', 'Bilaval', 'Gujri', 'Gond', 'Todi'],
    suggestions: [
      { label: 'Sarang', query: 'ਸਾਰੰਗ', mode: 'words', raag: 'Raag Sarang' },
      { label: 'Suhi Laavan', query: 'ਹਰਿ ਪਹਿਲੜੀ ਲਾਵ', mode: 'words', raag: 'Raag Suhi' },
      { label: 'Bilaval', query: 'ਬਿਲਾਵਲੁ', mode: 'words', raag: 'Raag Bilaval' },
    ],
  },
  {
    id: 'afternoon',
    startHour: 12,
    endHour: 15,
    label: 'Afternoon',
    timeLabel: '12pm - 3pm',
    note: 'Use raags with depth and strength; good for reflective mid-day diwan.',
    raags: ['Vadhans', 'Maru', 'Dhanasari', 'Tilang'],
    suggestions: [
      { label: 'Dhanasari Aarti', query: 'ਗਗਨ ਮੈ ਥਾਲੁ', mode: 'words', raag: 'Raag Dhanasari' },
      { label: 'Maru', query: 'ਮਾਰੂ', mode: 'words', raag: 'Raag Maru' },
      { label: 'Tilang', query: 'ਤਿਲੰਗ', mode: 'words', raag: 'Raag Tilang' },
    ],
  },
  {
    id: 'late-afternoon',
    startHour: 15,
    endHour: 18,
    label: 'Late afternoon',
    timeLabel: '3pm - 6pm',
    note: 'Good for contemplative shabads and Barah Maha themes.',
    raags: ['Maajh', 'Gauri', 'Tukhari'],
    suggestions: [
      { label: 'Barah Maha Majh', query: 'ਚੇਤਿ ਗੋਵਿੰਦੁ ਅਰਾਧੀਐ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Sukhmani Sahib', query: 'ਸੁਖਮਨੀ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮੁ', mode: 'words', raag: 'Raag Gauri' },
      { label: 'Tukhari Barah Maha', query: 'ਤੂ ਸੁਣਿ ਕਿਰਤ ਕਰੰਮਾ', mode: 'words', raag: 'Raag Tukhari' },
    ],
  },
  {
    id: 'evening',
    startHour: 18,
    endHour: 21,
    label: 'Evening',
    timeLabel: '6pm - 9pm',
    note: 'Strong for evening diwan: majesty, devotion, and calm sangat focus.',
    raags: ['Sri Raag', 'Basant', 'Maali Gaura', 'Jaitasari', 'Kedara', 'Kalyaan'],
    suggestions: [
      { label: 'Sri Raag', query: 'ਸਿਰੀਰਾਗੁ', mode: 'words', raag: 'Sri Raag' },
      { label: 'Kedara', query: 'ਕੇਦਾਰਾ', mode: 'words', raag: 'Raag Kedara' },
      { label: 'Basant', query: 'ਬਸੰਤੁ', mode: 'words', raag: 'Raag Basant' },
    ],
  },
  {
    id: 'night',
    startHour: 21,
    endHour: 24,
    label: 'Night',
    timeLabel: '9pm - 12am',
    note: 'Sweet, composed night mood; good for closing diwan.',
    raags: ['Bihaagra', 'Nat Narayan', 'Sorath', 'Malaar', 'Kaanra'],
    suggestions: [
      { label: 'Sorath', query: 'ਸੋਰਠਿ', mode: 'words', raag: 'Raag Sorath' },
      { label: 'Malaar', query: 'ਮਲਾਰ', mode: 'words', raag: 'Raag Malaar' },
      { label: 'Kaanra', query: 'ਕਾਨੜਾ', mode: 'words', raag: 'Raag Kaanra' },
    ],
  },
];

export const MONTH_KIRTAN_GUIDES = {
  chet: {
    title: 'Chet',
    mood: 'New beginning, remembrance, turning the mind toward Govind.',
    raags: ['Majh', 'Aasa', 'Ramkali'],
    suggestions: [
      { label: 'Chet Barah Maha', query: 'ਚੇਤਿ ਗੋਵਿੰਦੁ ਅਰਾਧੀਐ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Nanakshahi New Year', query: 'ਬਾਰਹ ਮਾਹਾ', mode: 'words', raag: 'Raag Majh' },
    ],
  },
  vaisakh: {
    title: 'Vaisakh',
    mood: 'Steadiness, Khalsa spirit, sangat, and spiritual ripening.',
    raags: ['Majh', 'Bilaval', 'Suhi'],
    suggestions: [
      { label: 'ਵੈਸਾਖਿ ਧੀਰਨਿ', query: 'ਵੈਸਾਖਿ ਧੀਰਨਿ', mode: 'words', raag: 'Raag Majh' },
      { label: 'ਦੇਹ ਸਿਵਾ ਬਰੁ ਮੋਹਿ', query: 'ਦੇਹ ਸਿਵਾ ਬਰੁ ਮੋਹਿ', mode: 'words', raag: 'Dasam Bani' },
    ],
  },
  jeth: {
    title: 'Jeth',
    mood: 'Heat, thirst, and the need to stay joined to Hari.',
    raags: ['Majh', 'Sarang', 'Dhanasari'],
    suggestions: [
      { label: 'Jeth Barah Maha', query: 'ਹਰਿ ਜੇਠਿ ਜੁੜੰਦਾ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Naam as coolness', query: 'ਹਰਿ ਕਾ ਨਾਮੁ ਰਿਦੈ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
    ],
  },
  harh: {
    title: 'Harh',
    mood: 'Longing, separation, and ardaas in the heat of life.',
    raags: ['Majh', 'Maru', 'Dhanasari'],
    suggestions: [
      { label: 'Harh Barah Maha', query: 'ਆਸਾੜੁ ਤਪੰਦਾ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Shaheedi reflection', query: 'ਤੇਰਾ ਕੀਆ ਮੀਠਾ ਲਾਗੈ', mode: 'words', raag: 'Raag Asa' },
    ],
  },
  sawan: {
    title: 'Sawan',
    mood: 'Rain, freshness, sangat, and the soul flowering with Naam.',
    raags: ['Malaar', 'Majh', 'Sarang'],
    suggestions: [
      { label: 'Sawan Barah Maha', query: 'ਸਾਵਣਿ ਸਰਸੀ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Malaar season', query: 'ਮਲਾਰ', mode: 'words', raag: 'Raag Malaar' },
    ],
  },
  bhadon: {
    title: 'Bhadon',
    mood: 'Rainy-season intensity, humility, and leaving bharam.',
    raags: ['Malaar', 'Majh', 'Sorath'],
    suggestions: [
      { label: 'Bhadon Barah Maha', query: 'ਭਾਦੁਇ ਭਰਮਿ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Bani Guru', query: 'ਬਾਣੀ ਗੁਰੂ ਗੁਰੂ ਹੈ ਬਾਣੀ', mode: 'words', raag: 'Raag Nat Narayan' },
    ],
  },
  assu: {
    title: 'Assu',
    mood: 'Love, discipline, and returning to Guru-centered life.',
    raags: ['Majh', 'Gauri', 'Jaitsari'],
    suggestions: [
      { label: 'Assu Barah Maha', query: 'ਅਸੁਨਿ ਪ੍ਰੇਮ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Guru Ram Das', query: 'ਗੁਰੂ ਰਾਮਦਾਸ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
    ],
  },
  katak: {
    title: 'Katak',
    mood: 'Grace, light, Bandi Chhor, and Guru Granth Sahib Ji.',
    raags: ['Sri Raag', 'Kedara', 'Kalyaan'],
    suggestions: [
      { label: 'Katak Barah Maha', query: 'ਕਤਿਕਿ ਕਰਮ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Bandi Chhor', query: 'ਬੰਧਨ ਕਾਟੇ ਆਪਿ ਪ੍ਰਭਿ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
    ],
  },
  maghar: {
    title: 'Maghar',
    mood: 'Truth, shaheedi, fearlessness, and inner warmth.',
    raags: ['Sorath', 'Ramkali', 'Salok Mahalla 9'],
    suggestions: [
      { label: 'Maghar Barah Maha', query: 'ਮੰਘਿਰਿ ਮਾਹਿ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Bhai kaahu kau', query: 'ਭੈ ਕਾਹੂ ਕਉ ਦੇਤ ਨਹਿ', mode: 'words', raag: 'Salok Mahalla 9' },
    ],
  },
  poh: {
    title: 'Poh',
    mood: 'Cold season, Sahibzade shaheedi, courage, and deep ardaas.',
    raags: ['Ramkali', 'Gauri', 'Dhanasari'],
    suggestions: [
      { label: 'Poh Barah Maha', query: 'ਪੋਖਿ ਤੁਖਾਰੁ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Shaheedi courage', query: 'ਸੂਰਾ ਸੋ ਪਹਿਚਾਨੀਐ', mode: 'words', raag: 'Salok Bhagat Kabir Ji' },
    ],
  },
  magh: {
    title: 'Magh',
    mood: 'Sangat, ishnaan, seva, and renewed discipline.',
    raags: ['Majh', 'Aasa', 'Bilaval'],
    suggestions: [
      { label: 'Magh Barah Maha', query: 'ਮਾਘਿ ਮਜਨੁ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Sangat', query: 'ਸਾਧਸੰਗਤਿ ਕੈਸੀ ਜਾਣੀਐ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
    ],
  },
  phagun: {
    title: 'Phagun',
    mood: 'Union, rang, joy, and completion of the yearly cycle.',
    raags: ['Basant', 'Majh', 'Aasa'],
    suggestions: [
      { label: 'ਫਲਗੁਣਿ Barah Maha', query: 'ਫਲਗੁਣਿ', mode: 'words', raag: 'Raag Majh' },
      { label: 'Basant season', query: 'ਬਸੰਤੁ', mode: 'words', raag: 'Raag Basant' },
    ],
  },
};

export const RAAG_SEARCH_TERMS = {
  'Sri Raag': 'ਸਿਰੀਰਾਗੁ',
  Siree: 'ਸਿਰੀਰਾਗੁ',
  Maajh: 'ਮਾਝ',
  Majh: 'ਮਾਝ',
  Gauri: 'ਗਉੜੀ',
  Aasa: 'ਆਸਾ',
  Asa: 'ਆਸਾ',
  Gujri: 'ਗੂਜਰੀ',
  Devgandhari: 'ਦੇਵਗੰਧਾਰੀ',
  Bihaagra: 'ਬਿਹਾਗੜਾ',
  Bihagra: 'ਬਿਹਾਗੜਾ',
  Vadhans: 'ਵਡਹੰਸੁ',
  Sorath: 'ਸੋਰਠਿ',
  Dhanasari: 'ਧਨਾਸਰੀ',
  Jaitasari: 'ਜੈਤਸਰੀ',
  Jaitsari: 'ਜੈਤਸਰੀ',
  Todi: 'ਟੋਡੀ',
  Bhairari: 'ਬੈਰਾੜੀ',
  Tilang: 'ਤਿਲੰਗ',
  Suhi: 'ਸੂਹੀ',
  Bilaval: 'ਬਿਲਾਵਲੁ',
  Gond: 'ਗੋਂਡ',
  Ramkali: 'ਰਾਮਕਲੀ',
  'Nat Narayan': 'ਨਟ ਨਾਰਾਇਨ',
  'Maali Gaura': 'ਮਾਲੀ ਗਉੜਾ',
  Maru: 'ਮਾਰੂ',
  Tukhari: 'ਤੁਖਾਰੀ',
  Kedara: 'ਕੇਦਾਰਾ',
  Bhairav: 'ਭੈਰਉ',
  Bhairao: 'ਭੈਰਉ',
  Basant: 'ਬਸੰਤੁ',
  Sarang: 'ਸਾਰਗ',
  Malaar: 'ਮਲਾਰ',
  Kaanra: 'ਕਾਨੜਾ',
  Kalyaan: 'ਕਲਿਆਨ',
  Prabhati: 'ਪ੍ਰਭਾਤੀ',
  Jaijawanti: 'ਜੈਜਾਵੰਤੀ',
};

export function getRaagSearchSuggestion(raag) {
  const label = String(raag || '').trim();
  if (!label) return null;
  const query = RAAG_SEARCH_TERMS[label] || label;
  return {
    label: `${label} Shabads`,
    query,
    mode: 'words',
    raag: label.startsWith('Raag') || label === 'Sri Raag' ? label : `Raag ${label}`,
  };
}

export function getPeharGuide(date = new Date()) {
  const hour = (date instanceof Date ? date : new Date(date)).getHours();
  return PEHAR_GUIDES.find((guide) => hour >= guide.startHour && hour < guide.endHour) || PEHAR_GUIDES[0];
}

export function getMonthKirtanGuide(monthIdOrDate = new Date()) {
  const monthId = typeof monthIdOrDate === 'string'
    ? monthIdOrDate
    : getNanakshahiMonthDay(monthIdOrDate).month.id;
  return MONTH_KIRTAN_GUIDES[monthId] || MONTH_KIRTAN_GUIDES.chet;
}

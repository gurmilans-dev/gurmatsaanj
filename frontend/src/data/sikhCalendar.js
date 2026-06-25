const DAY_MS = 24 * 60 * 60 * 1000;

export const CALENDAR_SOURCE_BY_YEAR = {
  2026: {
    label: 'SGPC Nanakshahi Samat 558, via SikhNet',
    url: 'https://www.sikhnet.com/pages/sikh-gurpurab-calendar',
    note: '2026 dates are year-specific. Moving observances should be updated when the next SGPC calendar is published.',
  },
};

export const CALENDAR_CATEGORIES = {
  sangrand: 'Sangrand',
  gurpurab: 'Gurpurab',
  gurgaddi: 'Gurgaddi',
  jotiJot: 'Joti Jot',
  shaheedi: 'Shaheedi',
  panth: 'Panth',
  granth: 'Sri Guru Granth Sahib Ji',
  historical: 'Historical',
  bhagat: 'Bhagat / Gursikh',
};

export const NANAKSHAHI_MONTHS = [
  { id: 'chet',    name: 'Chet',    gurmukhi: 'ਚੇਤ',    barahMaha: 'ਚੇਤਿ ਗੋਵਿੰਦੁ ਅਰਾਧੀਐ', raag: 'Raag Majh' },
  { id: 'vaisakh', name: 'Vaisakh', gurmukhi: 'ਵੈਸਾਖ',  barahMaha: 'ਵੈਸਾਖਿ ਧੀਰਨਿ', raag: 'Raag Majh' },
  { id: 'jeth',    name: 'Jeth',    gurmukhi: 'ਜੇਠ',    barahMaha: 'ਹਰਿ ਜੇਠਿ ਜੁੜੰਦਾ', raag: 'Raag Majh' },
  { id: 'harh',    name: 'Harh',    gurmukhi: 'ਹਾੜ',    barahMaha: 'ਆਸਾੜੁ ਤਪੰਦਾ', raag: 'Raag Majh' },
  { id: 'sawan',   name: 'Sawan',   gurmukhi: 'ਸਾਵਣ',  barahMaha: 'ਸਾਵਣਿ ਸਰਸੀ', raag: 'Raag Majh' },
  { id: 'bhadon',  name: 'Bhadon',  gurmukhi: 'ਭਾਦੋਂ',  barahMaha: 'ਭਾਦੁਇ ਭਰਮਿ', raag: 'Raag Majh' },
  { id: 'assu',    name: 'Assu',    gurmukhi: 'ਅੱਸੂ',   barahMaha: 'ਅਸੁਨਿ ਪ੍ਰੇਮ', raag: 'Raag Majh' },
  { id: 'katak',   name: 'Katak',   gurmukhi: 'ਕੱਤਕ',  barahMaha: 'ਕਤਿਕਿ ਕਰਮ', raag: 'Raag Majh' },
  { id: 'maghar',  name: 'Maghar',  gurmukhi: 'ਮੱਘਰ',  barahMaha: 'ਮੰਘਿਰਿ ਮਾਹਿ', raag: 'Raag Majh' },
  { id: 'poh',     name: 'Poh',     gurmukhi: 'ਪੋਹ',    barahMaha: 'ਪੋਖਿ ਤੁਖਾਰੁ', raag: 'Raag Majh' },
  { id: 'magh',    name: 'Magh',    gurmukhi: 'ਮਾਘ',    barahMaha: 'ਮਾਘਿ ਮਜਨੁ', raag: 'Raag Majh' },
  { id: 'phagun',  name: 'Phagun',  gurmukhi: 'ਫੱਗਣ',  barahMaha: 'ਫਲਗੁਣਿ', raag: 'Raag Majh' },
];

const MONTH_STARTS_BY_GREGORIAN_YEAR = {
  2026: {
    magh: '2026-01-13',
    phagun: '2026-02-12',
    chet: '2026-03-14',
    vaisakh: '2026-04-14',
    jeth: '2026-05-15',
    harh: '2026-06-15',
    sawan: '2026-07-16',
    bhadon: '2026-08-17',
    assu: '2026-09-17',
    katak: '2026-10-17',
    maghar: '2026-11-16',
    poh: '2026-12-16',
  },
  2027: {
    magh: '2027-01-14',
    phagun: '2027-02-13',
  },
};

const SUGGESTIONS = {
  barahMaha: [
    { label: 'Barah Maha', query: 'ਬਾਰਹ ਮਾਹਾ', mode: 'words', raag: 'Raag Majh' },
  ],
  gurpurab: [
    { label: 'Anand Sahib', query: 'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ', mode: 'words', raag: 'Raag Ramkali' },
    { label: 'Guru mahima', query: 'ਗੁਰੁ ਪਰਮੇਸਰੁ ਏਕੋ ਜਾਣੁ', mode: 'words', raag: 'Raag Asa' },
  ],
  shaheedi: [
    { label: 'Deh Shiva', query: 'ਦੇਹ ਸਿਵਾ ਬਰੁ ਮੋਹਿ', mode: 'words', raag: 'Dasam Bani' },
    { label: 'Soora so pehchaaniai', query: 'ਸੂਰਾ ਸੋ ਪਹਿਚਾਨੀਐ', mode: 'words', raag: 'Salok Bhagat Kabir Ji' },
    { label: 'Chaupai Sahib', query: 'ਹਮਰੀ ਕਰੋ ਹਾਥ ਦੈ ਰੱਛਾ', mode: 'words', raag: 'Dasam Bani' },
  ],
  guruArjanShaheedi: [
    { label: 'Tera kia meetha lage', query: 'ਤੇਰਾ ਕੀਆ ਮੀਠਾ ਲਾਗੈ', mode: 'words', raag: 'Raag Asa' },
    { label: 'Sukhmani Sahib', query: 'ਸੁਖਮਨੀ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮੁ', mode: 'words', raag: 'Raag Gauri' },
  ],
  guruTeghBahadur: [
    { label: 'Salok Mahalla 9', query: 'ਸਲੋਕ ਮਹਲਾ ੯', mode: 'words', raag: 'Salok Mahalla 9' },
    { label: 'Bhai kaahu kau', query: 'ਭੈ ਕਾਹੂ ਕਉ ਦੇਤ ਨਹਿ', mode: 'words', raag: 'Salok Mahalla 9' },
  ],
  granth: [
    { label: 'Bani Guru', query: 'ਬਾਣੀ ਗੁਰੂ ਗੁਰੂ ਹੈ ਬਾਣੀ', mode: 'words', raag: 'Raag Nat Narayan' },
    { label: 'Dhur ki bani', query: 'ਧੁਰ ਕੀ ਬਾਣੀ ਆਈ', mode: 'words', raag: 'Raag Sorath' },
    { label: 'Pothi Parmesar', query: 'ਪੋਥੀ ਪਰਮੇਸਰ ਕਾ ਥਾਨੁ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
  ],
  khalsa: [
    { label: 'Deh Shiva', query: 'ਦੇਹ ਸਿਵਾ ਬਰੁ ਮੋਹਿ', mode: 'words', raag: 'Dasam Bani' },
    { label: 'Soora so pehchaaniai', query: 'ਸੂਰਾ ਸੋ ਪਹਿਚਾਨੀਐ', mode: 'words', raag: 'Salok Bhagat Kabir Ji' },
    { label: 'Vaisakh Barah Maha', query: 'ਵੈਸਾਖਿ ਧੀਰਨਿ', mode: 'words', raag: 'Raag Majh' },
  ],
  miriPiri: [
    { label: 'Soora so pehchaaniai', query: 'ਸੂਰਾ ਸੋ ਪਹਿਚਾਨੀਐ', mode: 'words', raag: 'Salok Bhagat Kabir Ji' },
    { label: 'Rakha ek hamara', query: 'ਰਾਖਾ ਏਕੁ ਹਮਾਰਾ ਸੁਆਮੀ', mode: 'words', raag: 'Raag Bilaval' },
  ],
  healing: [
    { label: 'Sarab rog ka aukhad', query: 'ਸਰਬ ਰੋਗ ਕਾ ਅਉਖਦੁ ਨਾਮੁ', mode: 'words', raag: 'Raag Gauri' },
    { label: 'Daya karo', query: 'ਦਇਆ ਕਰਹੁ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
  ],
  guruNanak: [
    { label: 'Guru Nanak theme', query: 'ਗੁਰ ਨਾਨਕ', mode: 'words', raag: 'Sri Guru Granth Sahib Ji' },
    { label: 'Satgur Nanak', query: 'ਸਤਿਗੁਰ ਨਾਨਕ', mode: 'words', raag: 'Bhai Gurdas Ji / Search' },
  ],
};

const EVENT_SUGGESTION_KEYS = {
  'khalsa-saajna': ['khalsa'],
  'shaheedi-guru-arjan': ['guruArjanShaheedi', 'shaheedi'],
  'shaheedi-guru-tegh-bahadur': ['guruTeghBahadur', 'shaheedi'],
  'parkash-sri-guru-granth-sahib': ['granth'],
  'sampuranta-sri-guru-granth-sahib': ['granth'],
  'gurgaddi-sri-guru-granth-sahib': ['granth'],
  'miri-piri-divas': ['miriPiri'],
  'parkash-guru-har-rai': ['healing', 'gurpurab'],
  'parkash-guru-nanak': ['guruNanak', 'gurpurab'],
  'shaheedi-vadde-sahibzade': ['shaheedi'],
  'shaheedi-chhote-sahibzade': ['shaheedi', 'guruTeghBahadur'],
};

const EVENT_PUNJABI_TITLES = {
  'foundation-harimandir-sahib': 'ਸੱਚਖੰਡ ਸ੍ਰੀ ਹਰਿਮੰਦਰ ਸਾਹਿਬ ਦਾ ਨੀਂਹ ਪੱਥਰ',
  'maghi-muktsar': 'ਜੋੜ ਮੇਲਾ ਸ੍ਰੀ ਮੁਕਤਸਰ ਸਾਹਿਬ / ਮਾਘੀ',
  'basant-panchmi': 'ਬਸੰਤ ਪੰਚਮੀ',
  'marriage-guru-gobind-singh': 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਅਤੇ ਮਾਤਾ ਜੀਤੋ ਜੀ ਦਾ ਵਿਆਹ',
  'parkash-guru-har-rai': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਹਰਿ ਰਾਇ ਸਾਹਿਬ ਜੀ',
  'bhagat-ravidas': 'ਪ੍ਰਕਾਸ਼ ਭਗਤ ਰਵਿਦਾਸ ਜੀ',
  'birth-sahibzada-ajit-singh': 'ਸਾਹਿਬਜ਼ਾਦਾ ਬਾਬਾ ਅਜੀਤ ਸਿੰਘ ਜੀ ਦਾ ਜਨਮ',
  'saka-nankana-sahib': 'ਸਾਕਾ ਨਨਕਾਣਾ ਸਾਹਿਬ',
  'jaito-da-mela': 'ਜੈਤੋ ਦਾ ਮੇਲਾ',
  'hola-mohalla': 'ਹੋਲਾ ਮਹੱਲਾ',
  'nanakshahi-new-year': 'ਨਾਨਕਸ਼ਾਹੀ ਸੰਮਤ ੫੫੮ ਦੀ ਸ਼ੁਰੂਆਤ',
  'gurgaddi-guru-har-rai': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਹਰਿ ਰਾਇ ਸਾਹਿਬ ਜੀ',
  'gurgaddi-guru-amar-das': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਅਮਰ ਦਾਸ ਸਾਹਿਬ ਜੀ',
  'joti-jot-guru-angad': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਅੰਗਦ ਦੇਵ ਜੀ',
  'joti-jot-guru-hargobind': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਹਰਿਗੋਬਿੰਦ ਸਾਹਿਬ ਜੀ',
  'gurgaddi-guru-tegh-bahadur': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਤੇਗ ਬਹਾਦਰ ਸਾਹਿਬ ਜੀ',
  'joti-jot-guru-harkrishan': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਹਰਿਕ੍ਰਿਸ਼ਨ ਸਾਹਿਬ ਜੀ',
  'parkash-guru-tegh-bahadur': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਤੇਗ ਬਹਾਦਰ ਸਾਹਿਬ ਜੀ',
  'parkash-guru-arjan': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਅਰਜਨ ਦੇਵ ਜੀ',
  'khalsa-saajna': 'ਖਾਲਸਾ ਸਾਜਨਾ ਦਿਵਸ / ਵੈਸਾਖੀ',
  'parkash-guru-angad': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਅੰਗਦ ਦੇਵ ਜੀ',
  'parkash-guru-amar-das': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਅਮਰ ਦਾਸ ਸਾਹਿਬ ਜੀ',
  'victory-sirhind': 'ਸਰਹਿੰਦ ਫਤਿਹ',
  'chhota-ghallughara': 'ਛੋਟਾ ਘੱਲੂਘਾਰਾ',
  'akal-takht-1984': 'ਅਕਾਲ ਤਖ਼ਤ ਸ਼ਹੀਦੀ ਯਾਦ',
  'gurgaddi-guru-hargobind': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਹਰਿਗੋਬਿੰਦ ਸਾਹਿਬ ਜੀ',
  'shaheedi-guru-arjan': 'ਸ਼ਹੀਦੀ ਗੁਰੂ ਅਰਜਨ ਦੇਵ ਜੀ',
  'shaheedi-banda-singh-bahadur': 'ਸ਼ਹੀਦੀ ਬੰਦਾ ਸਿੰਘ ਬਹਾਦਰ ਜੀ',
  'bhagat-kabir': 'ਪ੍ਰਕਾਸ਼ ਭਗਤ ਕਬੀਰ ਜੀ',
  'parkash-guru-hargobind': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਹਰਿਗੋਬਿੰਦ ਸਾਹਿਬ ਜੀ',
  'shaheedi-bhai-mani-singh': 'ਸ਼ਹੀਦੀ ਭਾਈ ਮਨੀ ਸਿੰਘ ਜੀ',
  'shaheedi-bhai-taru-singh': 'ਸ਼ਹੀਦੀ ਭਾਈ ਤਾਰੂ ਸਿੰਘ ਜੀ',
  'miri-piri-divas': 'ਮੀਰੀ ਪੀਰੀ ਦਿਵਸ',
  'parkash-guru-harkrishan': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਹਰਿਕ੍ਰਿਸ਼ਨ ਸਾਹਿਬ ਜੀ',
  'sampuranta-sri-guru-granth-sahib': 'ਸੰਪੂਰਨਤਾ ਦਿਵਸ ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ',
  'parkash-sri-guru-granth-sahib': 'ਪਹਿਲਾ ਪ੍ਰਕਾਸ਼ ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ',
  'gurgaddi-guru-arjan': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਅਰਜਨ ਦੇਵ ਜੀ',
  'joti-jot-guru-ram-das': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਰਾਮ ਦਾਸ ਜੀ',
  'gurgaddi-guru-ram-das': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਰਾਮ ਦਾਸ ਜੀ',
  'joti-jot-guru-amar-das': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਅਮਰ ਦਾਸ ਸਾਹਿਬ ਜੀ',
  'gurgaddi-guru-angad': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਅੰਗਦ ਦੇਵ ਜੀ',
  'joti-jot-guru-nanak': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਨਾਨਕ ਦੇਵ ਜੀ',
  'parkash-guru-ram-das': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਰਾਮ ਦਾਸ ਜੀ',
  'gurgaddi-guru-harkrishan': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਹਰਿਕ੍ਰਿਸ਼ਨ ਸਾਹਿਬ ਜੀ',
  'joti-jot-guru-har-rai': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਹਰਿ ਰਾਇ ਸਾਹਿਬ ਜੀ',
  'bandi-chhor': 'ਬੰਦੀ ਛੋੜ ਦਿਵਸ',
  'gurgaddi-sri-guru-granth-sahib': 'ਗੁਰਗੱਦੀ ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ',
  'joti-jot-guru-gobind-singh': 'ਜੋਤੀ ਜੋਤ ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ',
  'parkash-guru-nanak': 'ਪ੍ਰਕਾਸ਼ ਗੁਰੂ ਨਾਨਕ ਦੇਵ ਜੀ',
  'gurgaddi-guru-gobind-singh': 'ਗੁਰਗੱਦੀ ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ',
  'shaheedi-bhai-mati-das': 'ਸ਼ਹੀਦੀ ਭਾਈ ਮਤੀ ਦਾਸ ਜੀ, ਭਾਈ ਦਿਆਲਾ ਜੀ ਅਤੇ ਭਾਈ ਸਤੀ ਦਾਸ ਜੀ',
  'shaheedi-guru-tegh-bahadur': 'ਸ਼ਹੀਦੀ ਗੁਰੂ ਤੇਗ ਬਹਾਦਰ ਸਾਹਿਬ ਜੀ',
  'birth-sahibzada-fateh-singh': 'ਸਾਹਿਬਜ਼ਾਦਾ ਬਾਬਾ ਫਤਿਹ ਸਿੰਘ ਜੀ ਦਾ ਜਨਮ',
  'shaheedi-vadde-sahibzade': 'ਸ਼ਹੀਦੀ ਵੱਡੇ ਸਾਹਿਬਜ਼ਾਦੇ',
  'saka-chamkaur-sahib': 'ਸਾਕਾ ਚਮਕੌਰ ਸਾਹਿਬ ਜੀ',
  'shaheedi-chhote-sahibzade': 'ਸ਼ਹੀਦੀ ਛੋਟੇ ਸਾਹਿਬਜ਼ਾਦੇ ਅਤੇ ਮਾਤਾ ਗੁਜਰੀ ਜੀ',
};

const YEAR_EVENTS_BY_GREGORIAN_YEAR = {
  2026: [
    event('2026-01-13', 'foundation-harimandir-sahib', 'Foundation Stone of Sachkhand Sri Harmandir Sahib', 'historical', 'normal', '01 Magh'),
    event('2026-01-13', 'maghi-muktsar', 'Jor Mela Sri Muktsar Sahib / Maghi', 'panth', 'major', '01 Magh'),
    event('2026-01-23', 'basant-panchmi', 'Basant Panchmi', 'historical', 'normal', '10 Magh'),
    event('2026-01-23', 'marriage-guru-gobind-singh', 'Marriage of Guru Gobind Singh Ji and Mata Jito Ji', 'historical', 'normal', '10 Magh'),
    event('2026-01-31', 'parkash-guru-har-rai', 'Parkash Guru Har Rai Sahib Ji', 'gurpurab', 'major', '18 Magh'),
    event('2026-02-01', 'bhagat-ravidas', 'Parkash Bhagat Ravidas Ji', 'bhagat', 'normal', '20 Magh'),
    event('2026-02-11', 'birth-sahibzada-ajit-singh', 'Birth Sahibzada Baba Ajit Singh Ji', 'gurpurab', 'normal', '30 Magh'),
    event('2026-02-21', 'saka-nankana-sahib', 'Saka Nankana Sahib', 'shaheedi', 'major', '10 Phagun'),
    event('2026-02-21', 'jaito-da-mela', 'Jaito da Mela', 'historical', 'normal', '10 Phagun'),
    event('2026-03-04', 'hola-mohalla', 'Hola Mohalla', 'panth', 'major', '21 Phagun'),
    event('2026-03-14', 'nanakshahi-new-year', 'Nanakshahi Samvat 558 Starts', 'panth', 'major', '01 Chet', ['barahMaha']),
    event('2026-03-17', 'gurgaddi-guru-har-rai', 'Gurgaddi Guru Har Rai Sahib Ji', 'gurgaddi', 'normal', '04 Chet'),
    event('2026-03-19', 'gurgaddi-guru-amar-das', 'Gurgaddi Guru Amar Das Sahib Ji', 'gurgaddi', 'normal', '06 Chet'),
    event('2026-03-22', 'joti-jot-guru-angad', 'Joti Jot Guru Angad Dev Ji', 'jotiJot', 'normal', '09 Chet'),
    event('2026-03-23', 'joti-jot-guru-hargobind', 'Joti Jot Guru Hargobind Sahib Ji', 'jotiJot', 'normal', '10 Chet'),
    event('2026-04-01', 'gurgaddi-guru-tegh-bahadur', 'Gurgaddi Guru Tegh Bahadur Sahib Ji', 'gurgaddi', 'normal', '19 Chet'),
    event('2026-04-01', 'joti-jot-guru-harkrishan', 'Joti Jot Guru HarKrishan Sahib Ji', 'jotiJot', 'normal', '19 Chet'),
    event('2026-04-07', 'parkash-guru-tegh-bahadur', 'Parkash Guru Tegh Bahadur Sahib Ji', 'gurpurab', 'major', '25 Chet', ['guruTeghBahadur', 'gurpurab']),
    event('2026-04-09', 'parkash-guru-arjan', 'Parkash Guru Arjan Dev Ji', 'gurpurab', 'major', '27 Chet'),
    event('2026-04-14', 'khalsa-saajna', 'Khalsa Saajna Divas / Vaisakhi', 'panth', 'major', '01 Vaisakh', ['khalsa']),
    event('2026-04-18', 'parkash-guru-angad', 'Parkash Guru Angad Dev Ji', 'gurpurab', 'major', '05 Vaisakh'),
    event('2026-04-30', 'parkash-guru-amar-das', 'Parkash Guru Amar Das Sahib Ji', 'gurpurab', 'major', '17 Vaisakh'),
    event('2026-05-12', 'victory-sirhind', 'Victory at Sirhind', 'historical', 'normal', '29 Vaisakh'),
    event('2026-05-17', 'chhota-ghallughara', 'Chhota Ghallughara', 'shaheedi', 'major', '03 Jeth'),
    event('2026-06-04', 'akal-takht-1984', 'Akal Takht Martyrdom Remembrance', 'shaheedi', 'major', '21 Jeth'),
    event('2026-06-08', 'gurgaddi-guru-hargobind', 'Gurgaddi Guru Hargobind Sahib Ji', 'gurgaddi', 'normal', '25 Jeth'),
    event('2026-06-18', 'shaheedi-guru-arjan', 'Shaheedi Guru Arjan Dev Ji', 'shaheedi', 'major', '04 Harh', ['guruArjanShaheedi']),
    event('2026-06-25', 'shaheedi-banda-singh-bahadur', 'Shaheedi Banda Singh Bahadur', 'shaheedi', 'major', '11 Harh'),
    event('2026-06-29', 'bhagat-kabir', 'Parkash Bhagat Kabir Ji', 'bhagat', 'normal', '15 Harh'),
    event('2026-06-30', 'parkash-guru-hargobind', 'Parkash Guru Hargobind Sahib Ji', 'gurpurab', 'major', '16 Harh', ['miriPiri', 'gurpurab']),
    event('2026-07-09', 'shaheedi-bhai-mani-singh', 'Shaheedi Bhai Mani Singh Ji', 'shaheedi', 'major', '25 Harh'),
    event('2026-07-16', 'shaheedi-bhai-taru-singh', 'Shaheedi Bhai Taru Singh Ji', 'shaheedi', 'major', '01 Sawan'),
    event('2026-07-24', 'miri-piri-divas', 'Miri Piri Divas', 'panth', 'major', '09 Sawan', ['miriPiri']),
    event('2026-08-07', 'parkash-guru-harkrishan', 'Parkash Guru HarKrishan Sahib Ji', 'gurpurab', 'major', '23 Sawan'),
    event('2026-08-30', 'sampuranta-sri-guru-granth-sahib', 'Sampuranta Divas Sri Guru Granth Sahib Ji', 'granth', 'major', '14 Bhadon', ['granth']),
    event('2026-09-12', 'parkash-sri-guru-granth-sahib', 'First Parkash Sri Guru Granth Sahib Ji', 'granth', 'major', '27 Bhadon', ['granth']),
    event('2026-09-13', 'gurgaddi-guru-arjan', 'Gurgaddi Guru Arjan Dev Ji', 'gurgaddi', 'normal', '28 Bhadon'),
    event('2026-09-14', 'joti-jot-guru-ram-das', 'Joti Jot Guru Ram Das Ji', 'jotiJot', 'normal', '29 Bhadon'),
    event('2026-09-24', 'gurgaddi-guru-ram-das', 'Gurgaddi Guru Ram Das Ji', 'gurgaddi', 'normal', '08 Assu'),
    event('2026-09-26', 'joti-jot-guru-amar-das', 'Joti Jot Guru Amar Das Sahib Ji', 'jotiJot', 'normal', '10 Assu'),
    event('2026-10-01', 'gurgaddi-guru-angad', 'Gurgaddi Guru Angad Dev Ji', 'gurgaddi', 'normal', '15 Assu'),
    event('2026-10-05', 'joti-jot-guru-nanak', 'Joti Jot Guru Nanak Dev Ji', 'jotiJot', 'normal', '19 Assu', ['guruNanak']),
    event('2026-10-27', 'parkash-guru-ram-das', 'Parkash Guru Ram Das Ji', 'gurpurab', 'major', '11 Katak'),
    event('2026-11-03', 'gurgaddi-guru-harkrishan', 'Gurgaddi Guru HarKrishan Sahib Ji', 'gurgaddi', 'normal', '18 Katak'),
    event('2026-11-03', 'joti-jot-guru-har-rai', 'Joti Jot Guru Har Rai Sahib Ji', 'jotiJot', 'normal', '18 Katak'),
    event('2026-11-08', 'bandi-chhor', 'Bandi Chhor Divas', 'panth', 'major', '23 Katak', ['miriPiri']),
    event('2026-11-11', 'gurgaddi-sri-guru-granth-sahib', 'Gurgaddi Sri Guru Granth Sahib Ji', 'granth', 'major', '26 Katak', ['granth']),
    event('2026-11-14', 'joti-jot-guru-gobind-singh', 'Joti Jot Guru Gobind Singh Ji', 'jotiJot', 'normal', '29 Katak'),
    event('2026-11-24', 'parkash-guru-nanak', 'Parkash Guru Nanak Dev Ji', 'gurpurab', 'major', '09 Maghar', ['guruNanak', 'gurpurab']),
    event('2026-12-12', 'gurgaddi-guru-gobind-singh', 'Gurgaddi Guru Gobind Singh Ji', 'gurgaddi', 'normal', '27 Maghar'),
    event('2026-12-13', 'shaheedi-bhai-mati-das', 'Shaheedi Bhai Mati Das Ji, Bhai Dyala Ji and Bhai Sati Das Ji', 'shaheedi', 'major', '28 Maghar', ['guruTeghBahadur', 'shaheedi']),
    event('2026-12-14', 'shaheedi-guru-tegh-bahadur', 'Shaheedi Guru Tegh Bahadur Sahib Ji', 'shaheedi', 'major', '29 Maghar', ['guruTeghBahadur']),
    event('2026-12-14', 'birth-sahibzada-fateh-singh', 'Birth Sahibzada Baba Fateh Singh Ji', 'gurpurab', 'normal', '29 Maghar'),
    event('2026-12-23', 'shaheedi-vadde-sahibzade', 'Shaheedi Sahibzada Ajit Singh Ji and Sahibzada Jujhar Singh Ji', 'shaheedi', 'major', '08 Poh', ['shaheedi']),
    event('2026-12-23', 'saka-chamkaur-sahib', 'Saka Chamkaur Sahib Ji', 'shaheedi', 'major', '08 Poh', ['shaheedi']),
    event('2026-12-28', 'shaheedi-chhote-sahibzade', 'Shaheedi Sahibzada Zorawar Singh Ji, Sahibzada Fateh Singh Ji and Mata Gujri Ji', 'shaheedi', 'major', '13 Poh', ['shaheedi', 'guruTeghBahadur']),
  ],
};

export const IMPORTANT_DAYS = YEAR_EVENTS_BY_GREGORIAN_YEAR[2026];

function event(dateKey, id, title, category, importance, nsDate, suggestionKeys) {
  return { dateKey, id, title, category, importance, nsDate, suggestionKeys };
}

function monthById(monthId) {
  return NANAKSHAHI_MONTHS.find((month) => month.id === monthId) || NANAKSHAHI_MONTHS[0];
}

function atNoon(year, month, day) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return atNoon(year, month - 1, day);
}

function addDays(date, days) {
  return atNoon(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0));
}

function monthStartsForGregorianYear(year) {
  const starts = MONTH_STARTS_BY_GREGORIAN_YEAR[Number(year)] || {};
  return Object.entries(starts)
    .map(([monthId, dateKey]) => ({ month: monthById(monthId), date: dateFromKey(dateKey) }))
    .sort((a, b) => a.date - b.date);
}

function parseNsDate(nsDate) {
  const match = String(nsDate || '').trim().match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return null;
  const day = Number(match[1]);
  const rawMonth = match[2].toLowerCase();
  const aliases = {
    chet: 'chet',
    chetar: 'chet',
    vaisakh: 'vaisakh',
    vaisaakh: 'vaisakh',
    jeth: 'jeth',
    harh: 'harh',
    sawan: 'sawan',
    saavan: 'sawan',
    bhadon: 'bhadon',
    bhaadon: 'bhadon',
    assu: 'assu',
    katak: 'katak',
    maghar: 'maghar',
    magh: 'magh',
    maagh: 'magh',
    poh: 'poh',
    phagun: 'phagun',
    phagan: 'phagun',
  };
  return { day, month: monthById(aliases[rawMonth] || rawMonth) };
}

function suggestionListForEvent(item, nsDetail) {
  const month = nsDetail?.month;
  if (item.category === 'sangrand') {
    return [
      { label: `${month.name} Barah Maha`, query: month.barahMaha, mode: 'words', raag: month.raag },
      ...SUGGESTIONS.barahMaha,
    ];
  }

  const keys = item.suggestionKeys || EVENT_SUGGESTION_KEYS[item.id] || [item.category];
  const suggestions = [];
  const seen = new Set();
  for (const key of keys) {
    for (const suggestion of SUGGESTIONS[key] || []) {
      const dedupe = `${suggestion.query}-${suggestion.raag}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      suggestions.push(suggestion);
    }
  }
  if (suggestions.length) return suggestions;
  return item.importance === 'major' ? SUGGESTIONS.gurpurab : SUGGESTIONS.barahMaha;
}

function decorateEvent(item, sourceYear) {
  const date = dateFromKey(item.dateKey);
  const nsDetail = parseNsDate(item.nsDate) || getNanakshahiMonthDay(date);
  const nanakshahiYear = getNanakshahiYear(date);
  const categoryLabel = CALENDAR_CATEGORIES[item.category] || item.category;
  return {
    ...item,
    date,
    dateKey: toDateKey(date),
    sourceYear,
    sourceLabel: CALENDAR_SOURCE_BY_YEAR[sourceYear]?.label || 'Local calendar data',
    nanakshahiYear,
    nanakshahiMonthId: nsDetail.month.id,
    nanakshahiMonth: nsDetail.month.name,
    nanakshahiMonthGurmukhi: nsDetail.month.gurmukhi,
    nanakshahiDay: nsDetail.day,
    categoryLabel,
    titlePunjabi: item.titlePunjabi || EVENT_PUNJABI_TITLES[item.id] || '',
    summary: item.summary || `${categoryLabel} observance on ${nsDetail.day} ${nsDetail.month.name}.`,
    suggestions: suggestionListForEvent(item, nsDetail),
  };
}

function sangrandForStart(start, gregorianYear) {
  const nsYear = getNanakshahiYear(start.date);
  return {
    id: `sangrand-${start.month.id}-${gregorianYear}`,
    title: `${start.month.name} Sangrand`,
    titlePunjabi: `${start.month.gurmukhi} ਸੰਗਰਾਂਦ`,
    category: 'sangrand',
    categoryLabel: CALENDAR_CATEGORIES.sangrand,
    importance: start.month.id === 'chet' || start.month.id === 'vaisakh' ? 'major' : 'normal',
    summary: `The first day of ${start.month.name} (${start.month.gurmukhi}) in the Nanakshahi calendar.`,
    suggestions: [
      { label: `${start.month.name} Barah Maha`, query: start.month.barahMaha, mode: 'words', raag: start.month.raag },
      ...SUGGESTIONS.barahMaha,
    ],
    date: start.date,
    dateKey: toDateKey(start.date),
    sourceYear: gregorianYear,
    sourceLabel: CALENDAR_SOURCE_BY_YEAR[gregorianYear]?.label || 'Local calendar data',
    nanakshahiYear: nsYear,
    nanakshahiMonthId: start.month.id,
    nanakshahiMonth: start.month.name,
    nanakshahiMonthGurmukhi: start.month.gurmukhi,
    nanakshahiDay: 1,
  };
}

export function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatGregorian(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function getNanakshahiYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const chetOne = atNoon(d.getFullYear(), 2, 14);
  return d >= chetOne ? d.getFullYear() - 1468 : d.getFullYear() - 1469;
}

export function gregorianDateForNanakshahi(nanakshahiYear, monthId, day = 1) {
  const candidateYears = [nanakshahiYear + 1468, nanakshahiYear + 1469, nanakshahiYear + 1467];
  for (const year of candidateYears) {
    const startKey = MONTH_STARTS_BY_GREGORIAN_YEAR[year]?.[monthId];
    if (!startKey) continue;
    const start = dateFromKey(startKey);
    if (getNanakshahiYear(start) === Number(nanakshahiYear)) {
      return addDays(start, Number(day || 1) - 1);
    }
  }
  return addDays(monthStartsForGregorianYear(candidateYears[0]).find((item) => item.month.id === monthId)?.date || atNoon(candidateYears[0], 2, 14), Number(day || 1) - 1);
}

export function getNanakshahiMonthDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const dayDate = atNoon(d.getFullYear(), d.getMonth(), d.getDate());
  const starts = [
    ...monthStartsForGregorianYear(d.getFullYear() - 1),
    ...monthStartsForGregorianYear(d.getFullYear()),
    ...monthStartsForGregorianYear(d.getFullYear() + 1),
  ].sort((a, b) => a.date - b.date);

  let current = starts.find((item) => item.date <= dayDate) || starts[0];
  for (const item of starts) {
    if (item.date <= dayDate) current = item;
    else break;
  }

  if (!current) {
    return { nanakshahiYear: getNanakshahiYear(dayDate), month: monthById('chet'), day: 1 };
  }

  return {
    nanakshahiYear: getNanakshahiYear(dayDate),
    month: current.month,
    day: Math.floor((dayDate - current.date) / DAY_MS) + 1,
  };
}

export function getAvailableCalendarYears() {
  return Object.keys(YEAR_EVENTS_BY_GREGORIAN_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
}

export function getCalendarSourceForYear(year) {
  return CALENDAR_SOURCE_BY_YEAR[Number(year)] || {
    label: 'No verified yearly source loaded',
    url: '',
    note: 'Add the SGPC yearly event table to sikhCalendar.js for exact moving dates.',
  };
}

export function getCalendarEventsForGregorianYear(gregorianYear) {
  const year = Number(gregorianYear);
  const events = [
    ...monthStartsForGregorianYear(year).map((start) => sangrandForStart(start, year)),
    ...(YEAR_EVENTS_BY_GREGORIAN_YEAR[year] || []).map((item) => decorateEvent(item, year)),
  ];

  const seen = new Set();
  return events
    .filter((eventItem) => eventItem.date.getFullYear() === year)
    .filter((eventItem) => {
      const key = `${eventItem.id}-${eventItem.dateKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date - b.date || importanceRank(b.importance) - importanceRank(a.importance));
}

export function getCalendarEventsForMonth(gregorianYear, gregorianMonthIndex) {
  return getCalendarEventsForGregorianYear(gregorianYear)
    .filter((eventItem) => eventItem.date.getMonth() === Number(gregorianMonthIndex));
}

export function getCalendarEventsForDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return getCalendarEventsForGregorianYear(d.getFullYear())
    .filter((eventItem) => eventItem.dateKey === toDateKey(d));
}

export function getUpcomingCalendarEvents(date = new Date(), limit = 8) {
  const d = date instanceof Date ? date : new Date(date);
  const start = atNoon(d.getFullYear(), d.getMonth(), d.getDate());
  const events = [
    ...getCalendarEventsForGregorianYear(d.getFullYear()),
    ...getCalendarEventsForGregorianYear(d.getFullYear() + 1),
  ];
  const seen = new Set();
  return events
    .filter((eventItem) => eventItem.date >= start)
    .filter((eventItem) => {
      const key = `${eventItem.id}-${eventItem.dateKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date - b.date || importanceRank(b.importance) - importanceRank(a.importance))
    .slice(0, limit);
}

export function importanceRank(importance) {
  if (importance === 'major') return 2;
  if (importance === 'normal') return 1;
  return 0;
}

export function describeNanakshahiDate(eventOrDate) {
  if (eventOrDate?.nanakshahiMonth) {
    return `${eventOrDate.nanakshahiMonth} ${eventOrDate.nanakshahiDay}, Nanakshahi ${eventOrDate.nanakshahiYear}`;
  }
  const detail = getNanakshahiMonthDay(eventOrDate);
  return `${detail.month.name} ${detail.day}, Nanakshahi ${detail.nanakshahiYear}`;
}

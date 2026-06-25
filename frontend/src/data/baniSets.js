export const BANI_SETS = [
  {
    id: 'japji-sahib',
    title: 'Japji Sahib',
    titlePa: 'ਜਪੁਜੀ ਸਾਹਿਬ',
    categoryId: 'nitnem',
    categoryOrder: 10,
    tags: ['Nitnem', 'Morning'],
    description: 'Foundational morning bani by Guru Nanak Dev Ji — the path to truth and the nature of Akal Purakh.',
    descriptionPa: 'ਗੁਰੂ ਨਾਨਕ ਦੇਵ ਜੀ ਦੁਆਰਾ ਉਚਾਰੀ ਮੂਲ ਨਿਤਨੇਮ ਬਾਣੀ — ਸੱਚ ਦਾ ਮਾਰਗ ਅਤੇ ਅਕਾਲ ਪੁਰਖ ਦਾ ਸਰੂਪ।',
    segments: [
      { type: 'shabadIdRange', start: 1, end: 39, title: 'Japji Sahib' },
    ],
  },
  {
    id: 'jaap-sahib',
    title: 'Jaap Sahib',
    titlePa: 'ਜਾਪੁ ਸਾਹਿਬ',
    categoryId: 'nitnem',
    categoryOrder: 20,
    tags: ['Nitnem', 'Dasam Bani', 'Morning'],
    description: 'Hundreds of Names of the Eternal by Guru Gobind Singh Ji — praise of the One who is beyond form, caste, and time.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੁਆਰਾ ਉਚਾਰੀ ਅਕਾਲ ਪੁਰਖ ਦੇ ਅਨੇਕ ਨਾਮਾਂ ਦੀ ਉਸਤਤਿ — ਜੋ ਰੂਪ, ਜਾਤ ਅਤੇ ਸਮੇਂ ਤੋਂ ਪਰੇ ਹੈ।',
    segments: [
      { type: 'shabadIdRange', start: 7402, end: 7423, title: 'Jaap Sahib' },
    ],
  },
  {
    id: 'tav-prasad-savaiye',
    title: 'Tav Prasad Savaiye',
    titlePa: 'ਤ੍ਵ ਪ੍ਰਸਾਦਿ ਸ੍ਵੈਯੇ',
    categoryId: 'nitnem',
    categoryOrder: 30,
    tags: ['Nitnem', 'Dasam Bani', 'Morning'],
    description: 'Ten Savaiye by Guru Gobind Singh Ji — empty ritual and image-worship are set aside in favour of remembrance of the One.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੇ ਦਸ ਸ੍ਵੈਯੇ — ਖੋਖਲੇ ਕਰਮਕਾਂਡ ਅਤੇ ਮੂਰਤੀ-ਪੂਜਾ ਛੱਡ ਕੇ ਇੱਕ ਅਕਾਲ ਪੁਰਖ ਦੀ ਯਾਦ।',
    segments: [
      { type: 'shabad', shabadId: '7426', title: 'Tav Prasad Savaiye' },
    ],
  },
  {
    id: 'rehras-sahib',
    title: 'Rehras Sahib (without extra Dohre)',
    titlePa: 'ਰਹਿਰਾਸ ਸਾਹਿਬ (ਬਿਨਾਂ ਦੋਹਰੇ)',
    categoryId: 'nitnem',
    categoryOrder: 60,
    tags: ['Nitnem', 'Evening', 'Without extra Dohre'],
    description: 'Evening prayer thanking the Guru for the day and asking strength for the next — Rehras, Benti Chaupai, Anand Sahib, and Mundavani.',
    descriptionPa: 'ਸ਼ਾਮ ਦੀ ਅਰਦਾਸ — ਦਿਨ ਲਈ ਗੁਰੂ ਦਾ ਸ਼ੁਕਰਾਨਾ ਅਤੇ ਅਗਲੇ ਦਿਨ ਲਈ ਬਲ — ਰਹਿਰਾਸ, ਬੇਨਤੀ ਚੌਪਈ, ਅਨੰਦ ਸਾਹਿਬ ਅਤੇ ਮੁੰਦਾਵਣੀ।',
    segments: [
      { type: 'shabad', shabadId: '1661', title: 'Har Jug Jug Bhagat Upaya', skip: 13 },
      { type: 'shabadIdRange', start: 40, end: 48, title: 'Rehras Sahib - SGGS' },
      { type: 'shabadList', shabadIds: ['12794', '12795'], title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '12796', title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '8095', title: 'Savaiya' },
      { type: 'shabad', shabadId: '8096', title: 'Dohra', dropLast: 1 },
      { type: 'shabadList', shabadIds: ['333375', '333376'], title: 'Anand Sahib - 6 pauris' },
      { type: 'shabadList', shabadIds: ['5538', '5539'], title: 'Mundavani / Salok' },
      { type: 'shabad', shabadId: '3544', title: 'Pauree' },
      { type: 'shabad', shabadId: '1944', title: 'Salok Mahalla 5' },
    ],
  },
  {
    id: 'rehras-sahib-with-dohre',
    title: 'Rehras Sahib (with Dohre)',
    titlePa: 'ਰਹਿਰਾਸ ਸਾਹਿਬ (ਦੋਹਰੇ ਸਮੇਤ)',
    categoryId: 'nitnem',
    categoryOrder: 61,
    tags: ['Nitnem', 'Evening', 'Dasam Bani', 'With Dohre'],
    description: 'Evening Rehras with the added Dasam Granth Dohre — including the line "Daas Jaan Kar Dijai Mukti", as recited in many traditions.',
    descriptionPa: 'ਦਸਮ ਗ੍ਰੰਥ ਦੇ ਦੋਹਰਿਆਂ ਸਮੇਤ ਰਹਿਰਾਸ — \'ਦਾਸ ਜਾਨਿ ਕਰਿ ਦੀਜੈ ਮੁਕਤਿ\' ਸਮੇਤ, ਜਿਵੇਂ ਕਈ ਪਰੰਪਰਾਵਾਂ ਵਿੱਚ ਪੜ੍ਹਿਆ ਜਾਂਦਾ ਹੈ।',
    segments: [
      { type: 'shabad', shabadId: '1661', title: 'Har Jug Jug Bhagat Upaya', skip: 13 },
      { type: 'shabadIdRange', start: 40, end: 48, title: 'Rehras Sahib - SGGS' },
      {
        type: 'static',
        title: 'Paatshahi 10 Chaupai header',
        sourceLabel: 'Local Rehras header',
        lines: [
          'ੴ ਸ੍ਰੀ ਵਾਹਿਗੁਰੂ ਜੀ ਕੀ ਫਤਹਿ ॥',
          'ਪਾਤਿਸਾਹੀ ੧੦ ॥',
          'ਚੌਪਈ ॥',
        ],
      },
      { type: 'shabad', shabadId: '12793', title: 'Chaupai', skip: 29 },
      { type: 'shabadList', shabadIds: ['12794', '12795'], title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '12796', title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '8308', title: 'Dohra - Daas Jaan Kar' },
      { type: 'shabad', shabadId: '8309', title: 'Chaupai - Mai Na Ganesh' },
      { type: 'shabadList', shabadIds: ['7508', '7509'], title: 'Bachitar Natak Dohre' },
      { type: 'shabad', shabadId: '7511', title: 'Dohra - Jab Aais Prabh Ko', dropLast: 1 },
      { type: 'shabad', shabadId: '7498', title: 'Dohra - Thaad Bhayo' },
      { type: 'shabad', shabadId: '7737', title: 'Dohra - Je Je Tumre Dhian', dropLast: 1 },
      { type: 'shabad', shabadId: '7867', title: 'Dohra - Kaal Purakh', skip: 2 },
      { type: 'shabad', shabadId: '8092', title: 'Dohra - Ram Katha', dropLast: 1 },
      { type: 'shabadList', shabadIds: ['8093', '8094'], title: 'Ram Avtar closing' },
      { type: 'shabad', shabadId: '8095', title: 'Savaiya' },
      { type: 'shabad', shabadId: '8096', title: 'Dohra', dropLast: 1 },
      { type: 'shabadList', shabadIds: ['333375', '333376'], title: 'Anand Sahib - 6 pauris' },
      { type: 'shabadList', shabadIds: ['5538', '5539'], title: 'Mundavani / Salok' },
      { type: 'shabad', shabadId: '3544', title: 'Pauree' },
      { type: 'shabad', shabadId: '1944', title: 'Salok Mahalla 5' },
    ],
  },

  {
    id: 'anand-sahib',
    title: 'Anand Sahib',
    titlePa: 'ਅਨੰਦੁ ਸਾਹਿਬ',
    categoryId: 'nitnem',
    categoryOrder: 50,
    tags: ['Nitnem', 'Anand Sahib', 'SGGS'],
    description: 'Song of Bliss by Guru Amar Das Ji — 40 pauris recited at every Sikh occasion to invite divine peace and joy.',
    descriptionPa: 'ਗੁਰੂ ਅਮਰ ਦਾਸ ਜੀ ਦੀ ਅਨੰਦ ਦੀ ਬਾਣੀ — 40 ਪਉੜੀਆਂ, ਜੋ ਹਰ ਖੁਸ਼ੀ-ਗਮੀ ਸਮੇਂ ਪੜ੍ਹੀਆਂ ਜਾਂਦੀਆਂ ਹਨ।',
    segments: [
      { type: 'shabadList', shabadIds: ['333375', '3375', '333376'], title: 'Anand Sahib' },
    ],
  },
  {
    id: 'chaupai-sahib',
    title: 'Chaupai Sahib',
    titlePa: 'ਚੌਪਈ ਸਾਹਿਬ',
    categoryId: 'nitnem',
    categoryOrder: 40,
    tags: ['Dasam Bani', 'Nitnem'],
    description: 'Benti Chaupai by Guru Gobind Singh Ji — a petition for divine shelter, fearlessness, and victory of righteousness.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੀ ਬੇਨਤੀ ਚੌਪਈ — ਪ੍ਰਭੂ ਦੀ ਪਨਾਹ, ਨਿਰਭੈਤਾ ਅਤੇ ਧਰਮ ਦੀ ਜਿੱਤ ਦੀ ਅਰਦਾਸ।',
    segments: [
      { type: 'shabadList', shabadIds: ['12794', '12795'], title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '12796', title: 'Benti Chaupai' },
      { type: 'shabad', shabadId: '8095', title: 'Savaiya' },
      { type: 'shabad', shabadId: '8096', title: 'Dohra', dropLast: 1 },
    ],
  },
  {
    id: 'sukhmani-sahib',
    title: 'Sukhmani Sahib',
    titlePa: 'ਸੁਖਮਨੀ ਸਾਹਿਬ',
    categoryId: 'other-banis',
    categoryOrder: 10,
    tags: ['Sukhmani Sahib', 'SGGS'],
    description: 'Pearl of Peace by Guru Arjan Dev Ji — 24 astpadis that settle the mind through remembrance of Naam.',
    descriptionPa: 'ਗੁਰੂ ਅਰਜਨ ਦੇਵ ਜੀ ਦੀ ਸੁਖਮਨੀ ਸਾਹਿਬ — 24 ਅਸਟਪਦੀਆਂ, ਜੋ ਨਾਮ ਦੀ ਯਾਦ ਨਾਲ ਮਨ ਨੂੰ ਸ਼ਾਂਤ ਕਰਦੀਆਂ ਹਨ।',
    segments: [
      { type: 'shabadIdRange', start: 871, end: 1086, title: 'Sukhmani Sahib' },
    ],
  },
  {
    id: 'asa-di-vaar',
    title: 'Asa di Vaar',
    titlePa: 'ਆਸਾ ਦੀ ਵਾਰ',
    categoryId: 'other-banis',
    categoryOrder: 20,
    tags: ['Vaar', 'Raag Asa'],
    description: 'Morning ballad in Raag Asa by Guru Nanak Dev Ji — challenges ritualism and caste, affirms Divine truth in everyday life.',
    descriptionPa: 'ਗੁਰੂ ਨਾਨਕ ਦੇਵ ਜੀ ਦੀ ਆਸਾ ਰਾਗ ਵਿੱਚ ਸਵੇਰ ਦੀ ਵਾਰ — ਕਰਮਕਾਂਡ ਅਤੇ ਜਾਤਪਾਤ ਨੂੰ ਚੁਣੌਤੀ, ਜੀਵਨ ਵਿੱਚ ਅਕਾਲ ਦੀ ਸੱਚਾਈ।',
    segments: [
      { type: 'shabad', shabadId: '1656', title: 'Asa di Vaar opening' },
      { type: 'shabadIdRange', start: 1685, end: 1767, title: 'Asa di Vaar' },
    ],
  },
  {
    id: 'ardaas',
    title: 'Ardaas',
    titlePa: 'ਅਰਦਾਸ',
    categoryId: 'other-banis',
    categoryOrder: 30,
    tags: ['Ardaas', 'Sangat'],
    description: 'Standing prayer remembering the Gurus, Sahibzaade, and martyrs — offered at the start and end of every Sikh undertaking.',
    descriptionPa: 'ਸਾਰੇ ਗੁਰੂ ਸਾਹਿਬਾਨ, ਸਾਹਿਬਜ਼ਾਦਿਆਂ ਅਤੇ ਸ਼ਹੀਦਾਂ ਨੂੰ ਯਾਦ ਕਰਦੀ ਖੜ੍ਹੀ ਅਰਦਾਸ — ਹਰ ਸਿੱਖ ਕਾਰਜ ਦੇ ਅਰੰਭ ਅਤੇ ਅੰਤ ਵਿੱਚ।',
    segments: [
      {
        type: 'static',
        title: 'Ardaas',
        sourceLabel: 'Common Ardaas text',
        lines: [
          'ਪ੍ਰਿਥਮ ਭਗੌਤੀ ਸਿਮਰਿ ਕੈ ਗੁਰ ਨਾਨਕ ਲਈਂ ਧਿਆਇ ॥',
          'ਫਿਰ ਅੰਗਦ ਗੁਰ ਤੇ ਅਮਰਦਾਸੁ ਰਾਮਦਾਸੈ ਹੋਈਂ ਸਹਾਇ ॥',
          'ਅਰਜਨ ਹਰਿਗੋਬਿੰਦ ਨੋ ਸਿਮਰੌ ਸ੍ਰੀ ਹਰਿਰਾਇ ॥',
          'ਸ੍ਰੀ ਹਰਿਕ੍ਰਿਸ਼ਨ ਧਿਆਈਐ ਜਿਸੁ ਡਿਠੇ ਸਭਿ ਦੁਖਿ ਜਾਇ ॥',
          'ਤੇਗ ਬਹਾਦਰ ਸਿਮਰਿਐ ਘਰਿ ਨਉ ਨਿਧਿ ਆਵੈ ਧਾਇ ॥',
          'ਸਭ ਥਾਈਂ ਹੋਇ ਸਹਾਇ ॥੧॥',
          'ਦਸਵੇਂ ਪਾਤਿਸਾਹ ਸ੍ਰੀ ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਸਾਹਿਬ ਜੀ ਸਭ ਥਾਈਂ ਹੋਇ ਸਹਾਇ ॥',
          'ਦਸਾਂ ਪਾਤਿਸਾਹੀਆਂ ਦੀ ਜੋਤਿ ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ ਦੇ ਪਾਠ ਦੀਦਾਰ ਦਾ ਧਿਆਨ ਧਰ ਕੇ ਬੋਲੋ ਜੀ ਵਾਹਿਗੁਰੂ ॥',
          'ਪੰਜਾਂ ਪਿਆਰਿਆਂ, ਚੌਹਾਂ ਸਾਹਿਬਜ਼ਾਦਿਆਂ, ਚਾਲੀਆਂ ਮੁਕਤਿਆਂ, ਹਠੀਆਂ, ਜਪੀਆਂ, ਤਪੀਆਂ, ਜਿਨ੍ਹਾਂ ਨਾਮ ਜਪਿਆ, ਵੰਡ ਛਕਿਆ, ਦੇਗ ਚਲਾਈ, ਤੇਗ ਵਾਹੀ, ਦੇਖ ਕੇ ਅਣਡਿੱਠ ਕੀਤਾ, ਤਿਨ੍ਹਾਂ ਪਿਆਰਿਆਂ ਸਚਿਆਰਿਆਂ ਦੀ ਕਮਾਈ ਦਾ ਧਿਆਨ ਧਰ ਕੇ ਬੋਲੋ ਜੀ ਵਾਹਿਗੁਰੂ ॥',
          'ਜਿਨ੍ਹਾਂ ਸਿੰਘਾਂ ਸਿੰਘਣੀਆਂ ਨੇ ਧਰਮ ਹੇਤ ਸੀਸ ਦਿੱਤੇ, ਬੰਦ ਬੰਦ ਕਟਾਏ, ਖੋਪਰੀਆਂ ਲੁਹਾਈਆਂ, ਚਰਖੜੀਆਂ ਤੇ ਚੜ੍ਹੇ, ਆਰਿਆਂ ਨਾਲ ਚਿਰਾਏ ਗਏ, ਗੁਰਦੁਆਰਿਆਂ ਦੀ ਸੇਵਾ ਲਈ ਕੁਰਬਾਨੀਆਂ ਕੀਤੀਆਂ, ਧਰਮ ਨਹੀਂ ਹਾਰਿਆ, ਸਿੱਖੀ ਕੇਸਾਂ ਸੁਆਸਾਂ ਨਾਲ ਨਿਭਾਈ, ਤਿਨ੍ਹਾਂ ਦੀ ਕਮਾਈ ਦਾ ਧਿਆਨ ਧਰ ਕੇ ਬੋਲੋ ਜੀ ਵਾਹਿਗੁਰੂ ॥',
          'ਪੰਜਾਂ ਤਖ਼ਤਾਂ, ਸਰਬੱਤ ਗੁਰਦੁਆਰਿਆਂ ਦਾ ਧਿਆਨ ਧਰ ਕੇ ਬੋਲੋ ਜੀ ਵਾਹਿਗੁਰੂ ॥',
          'ਪ੍ਰਿਥਮੇ ਸਰਬੱਤ ਖਾਲਸਾ ਜੀ ਕੀ ਅਰਦਾਸ ਹੈ ਜੀ, ਸਰਬੱਤ ਖਾਲਸਾ ਜੀ ਕੋ ਵਾਹਿਗੁਰੂ, ਵਾਹਿਗੁਰੂ, ਵਾਹਿਗੁਰੂ ਚਿਤ ਆਵੇ, ਚਿਤ ਆਵਨ ਕਾ ਸਦਕਾ ਸਰਬ ਸੁਖ ਹੋਵੇ ॥',
          'ਜਹਾਂ ਜਹਾਂ ਖਾਲਸਾ ਜੀ ਸਾਹਿਬ, ਤਹਾਂ ਤਹਾਂ ਰਛਿਆ ਰਿਆਇਤ, ਦੇਗ ਤੇਗ ਫਤਹਿ, ਬਿਰਦ ਕੀ ਪੈਜ, ਪੰਥ ਕੀ ਜੀਤ, ਸ੍ਰੀ ਸਾਹਿਬ ਜੀ ਸਹਾਇ, ਖਾਲਸੇ ਜੀ ਕੇ ਬੋਲ ਬਾਲੇ, ਬੋਲੋ ਜੀ ਵਾਹਿਗੁਰੂ ॥',
          'ਸਿੱਖਾਂ ਨੂੰ ਸਿੱਖੀ ਦਾਨ, ਕੇਸ ਦਾਨ, ਰਹਿਤ ਦਾਨ, ਬਿਬੇਕ ਦਾਨ, ਭਰੋਸਾ ਦਾਨ, ਦਾਨਾਂ ਸਿਰ ਦਾਨ ਨਾਮ ਦਾਨ, ਸ੍ਰੀ ਅੰਮ੍ਰਿਤਸਰ ਜੀ ਦੇ ਦਰਸ਼ਨ ਇਸ਼ਨਾਨ ॥',
          'ਹੇ ਨਿਮਾਣਿਆਂ ਦੇ ਮਾਣ, ਨਿਤਾਣਿਆਂ ਦੇ ਤਾਣ, ਨਿਓਟਿਆਂ ਦੀ ਓਟ, ਸੱਚੇ ਪਿਤਾ ਵਾਹਿਗੁਰੂ, ਆਪ ਜੀ ਦੇ ਹਜ਼ੂਰ ਅਰਦਾਸ ਹੈ ਜੀ ॥',
          'ਅੱਖਰ ਵਾਧਾ ਘਾਟਾ ਭੁੱਲ ਚੁੱਕ ਮਾਫ ਕਰਨੀ, ਸਰਬੱਤ ਦੇ ਕਾਰਜ ਰਾਸ ਕਰਨੇ ॥',
          'ਸੇਈ ਪਿਆਰੇ ਮੇਲ ਜਿਨ੍ਹਾਂ ਮਿਲਿਆਂ ਤੇਰਾ ਨਾਮ ਚਿਤ ਆਵੇ ॥',
          'ਨਾਨਕ ਨਾਮ ਚੜ੍ਹਦੀ ਕਲਾ, ਤੇਰੇ ਭਾਣੇ ਸਰਬੱਤ ਦਾ ਭਲਾ ॥',
          'ਵਾਹਿਗੁਰੂ ਜੀ ਕਾ ਖਾਲਸਾ ॥ ਵਾਹਿਗੁਰੂ ਜੀ ਕੀ ਫਤਹਿ ॥',
        ],
      },
    ],
  },
  {
    id: 'anand-karaj',
    title: 'Anand Karaj (Lavaan)',
    titlePa: 'ਅਨੰਦ ਕਾਰਜ (ਲਾਵਾਂ)',
    categoryId: 'other-banis',
    categoryOrder: 35,
    tags: ['Anand Karaj', 'Wedding', 'SGGS'],
    description: 'The four Lavaan by Guru Ram Das Ji — sung in order during the Sikh marriage ceremony; the soul-bride\'s four stages of union with the Divine Beloved.',
    descriptionPa: 'ਗੁਰੂ ਰਾਮਦਾਸ ਜੀ ਦੀਆਂ ਚਾਰ ਲਾਵਾਂ — ਸਿੱਖ ਵਿਆਹ ਸਮੇਂ ਕ੍ਰਮ ਵਿੱਚ ਪੜ੍ਹੀਆਂ ਜਾਂਦੀਆਂ; ਜੀਵਾਤਮਾ ਦਾ ਅਕਾਲ ਪੁਰਖ ਨਾਲ ਮਿਲਾਪ ਦੇ ਚਾਰ ਪੜਾਅ।',
    segments: [
      { type: 'bani', baniId: 11, title: 'Lavaan' },
    ],
  },
  {
    id: 'rakhia-de-shabad',
    title: 'Rakhia De Shabad',
    titlePa: 'ਰਾਖਿਆ ਦੇ ਸ਼ਬਦ',
    categoryId: 'other-banis',
    categoryOrder: 40,
    tags: ['Rakhia', 'SGGS'],
    description: 'Protective Shabads — Tati Vao Na Lagai and companion verses recited for divine shelter from fear and harm.',
    descriptionPa: 'ਰੱਖਿਆ ਦੇ ਸ਼ਬਦ — ਤਤੀ ਵਾਉ ਨ ਲਗਈ ਅਤੇ ਸਾਥੀ ਸ਼ਬਦ, ਡਰ ਅਤੇ ਨੁਕਸਾਨ ਤੋਂ ਪ੍ਰਭੂ ਦੀ ਰੱਖਿਆ ਲਈ।',
    segments: [
      { type: 'shabad', shabadId: '2367', title: 'Gur Ka Shabad Rakhvaare' },
      { type: 'shabad', shabadId: '3085', title: 'Tati Vaao Na Lagai' },
      { type: 'shabadList', shabadIds: ['5534', '5535'], title: 'Salok Mahalla 9' },
    ],
  },
  {
    id: 'aarti',
    title: 'Aarti',
    titlePa: 'ਆਰਤੀ',
    categoryId: 'other-banis',
    categoryOrder: 50,
    tags: ['Aarti', 'SGGS', 'Dasam Bani'],
    description: 'Cosmic Aarti — Guru Nanak sees sky as the tray, sun and moon as lamps, stars as pearls offered to the Divine.',
    descriptionPa: 'ਬ੍ਰਹਿਮੰਡੀ ਆਰਤੀ — ਗੁਰੂ ਨਾਨਕ ਅਕਾਸ਼ ਨੂੰ ਥਾਲ, ਸੂਰਜ-ਚੰਦ ਨੂੰ ਦੀਵੇ, ਅਤੇ ਤਾਰਿਆਂ ਨੂੰ ਮੋਤੀਆਂ ਵਾਂਗ ਅਕਾਲ ਪੁਰਖ ਦੀ ਆਰਤੀ ਵਜੋਂ ਦੇਖਦੇ ਹਨ।',
    segments: [
      { type: 'shabad', shabadId: '2533', title: 'Gagan Mai Thaal' },
      { type: 'shabad', shabadId: '2638', title: 'Naam Tero Aarti' },
      { type: 'shabad', shabadId: '2640', title: 'Sain Ji Aarti' },
      { type: 'shabad', shabadId: '7596', title: 'Aarti Savaiya' },
    ],
  },
  {
    id: 'chandi-di-vaar',
    title: 'Chandi Di Vaar',
    titlePa: 'ਚੰਡੀ ਦੀ ਵਾਰ',
    categoryId: 'dasam-bani',
    categoryOrder: 10,
    tags: ['Dasam Bani', 'Vaar'],
    description: 'Heroic ballad by Guru Gobind Singh Ji — the soul\'s battle against ego and evil; the opening "Pritham Bhagauti" begins every Ardaas.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੀ ਵੀਰਰਸ ਵਾਰ — ਆਤਮਾ ਦੀ ਹਉਮੈ ਅਤੇ ਬੁਰਾਈ ਨਾਲ ਜੰਗ; ਇਸ ਦੀ ਪਹਿਲੀ ਪਉੜੀ \'ਪ੍ਰਿਥਮ ਭਗੌਤੀ\' ਅਰਦਾਸ ਦਾ ਅਰੰਭ ਹੈ।',
    segments: [
      { type: 'shabadIdRange', start: 7738, end: 7740, title: 'Chandi Di Vaar' },
    ],
  },
  {
    id: 'akal-ustat',
    title: 'Akal Ustat',
    titlePa: 'ਅਕਾਲ ਉਸਤਤਿ',
    categoryId: 'dasam-bani',
    categoryOrder: 20,
    tags: ['Dasam Bani', 'Praise'],
    description: 'Praise of the Timeless by Guru Gobind Singh Ji — One God beyond name, form, caste, and religion; the same Divine of all humanity.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੀ ਅਕਾਲ ਉਸਤਤਿ — ਨਾਮ, ਰੂਪ, ਜਾਤ ਅਤੇ ਧਰਮ ਤੋਂ ਪਰੇ ਇੱਕ ਅਕਾਲ ਪੁਰਖ; ਸਾਰੀ ਮਨੁੱਖਤਾ ਦਾ ਇੱਕੋ ਪ੍ਰਭੂ।',
    segments: [
      { type: 'bani', baniId: 29, title: 'Akal Ustat' },
    ],
  },
  {
    id: 'shabad-hazare-p10',
    title: 'Shabad Hazare (Patshahi 10)',
    titlePa: 'ਸ਼ਬਦ ਹਜ਼ਾਰੇ ਪਾਤਸ਼ਾਹੀ ੧੦',
    categoryId: 'dasam-bani',
    categoryOrder: 30,
    tags: ['Dasam Bani', 'Hazare'],
    description: 'Ten Shabads by Guru Gobind Singh Ji — the soul\'s longing to meet and merge with the Divine Beloved.',
    descriptionPa: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ ਦੇ ਦਸ ਸ਼ਬਦ — ਪ੍ਰਭੂ ਪ੍ਰੀਤਮ ਨੂੰ ਮਿਲਣ ਅਤੇ ਉਸ ਵਿੱਚ ਸਮਾਉਣ ਦੀ ਆਤਮਾ ਦੀ ਤਾਂਘ।',
    segments: [
      { type: 'bani', baniId: 5, title: 'Shabad Hazare Patshahi 10' },
    ],
  },
  {
    id: 'kirtan-sohila',
    title: 'Kirtan Sohila',
    titlePa: 'ਕੀਰਤਨ ਸੋਹਿਲਾ',
    categoryId: 'nitnem',
    categoryOrder: 70,
    tags: ['Nitnem', 'Night'],
    description: 'Night bani — five Shabads recited before sleep, surrendering the day\'s actions and contemplating the eternal Naam.',
    descriptionPa: 'ਰਾਤ ਦੀ ਬਾਣੀ — ਸੌਣ ਤੋਂ ਪਹਿਲਾਂ ਪੜ੍ਹੇ ਜਾਂਦੇ ਪੰਜ ਸ਼ਬਦ; ਦਿਨ ਦੇ ਕਰਮਾਂ ਨੂੰ ਪ੍ਰਭੂ ਚਰਨੀਂ ਅਰਪਣ ਅਤੇ ਨਾਮ ਦਾ ਚਿੰਤਨ।',
    segments: [
      { type: 'shabadIdRange', start: 49, end: 53, title: 'Kirtan Sohila' },
    ],
  },
];

export const BANI_CATEGORIES = [
  { id: 'nitnem',        label: 'Nitnem',                       labelPa: 'ਨਿਤਨੇਮ' },
  { id: 'dasam-bani',    label: 'Dasam Bani',                   labelPa: 'ਦਸਮ ਬਾਣੀ' },
  { id: 'other-banis',   label: 'Other Banis',                  labelPa: 'ਹੋਰ ਬਾਣੀਆਂ' },
  { id: 'other-granths', label: 'Other Granths / related texts', labelPa: 'ਹੋਰ ਗ੍ਰੰਥ' },
];

// English-tag → Gurmukhi-tag lookup. Tags are stored as English strings so
// existing code keeps working; render-time translation picks the active form.
export const BANI_TAG_LABELS = {
  'Nitnem':              'ਨਿਤਨੇਮ',
  'Morning':             'ਸਵੇਰ',
  'Evening':             'ਸ਼ਾਮ',
  'Night':               'ਰਾਤ',
  'Dasam Bani':          'ਦਸਮ ਬਾਣੀ',
  'Without extra Dohre': 'ਬਿਨਾਂ ਦੋਹਰੇ',
  'With Dohre':          'ਦੋਹਰੇ ਸਮੇਤ',
  'Vaar':                'ਵਾਰ',
  'Anand Sahib':         'ਅਨੰਦੁ ਸਾਹਿਬ',
  'SGGS':                'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ',
  'Sukhmani Sahib':      'ਸੁਖਮਨੀ ਸਾਹਿਬ',
  'Raag Asa':            'ਰਾਗ ਆਸਾ',
  'Ardaas':              'ਅਰਦਾਸ',
  'Sangat':              'ਸੰਗਤ',
  'Rakhia':              'ਰੱਖਿਆ',
  'Aarti':               'ਆਰਤੀ',
  'Hazare':              'ਹਜ਼ਾਰੇ',
  'Praise':              'ਉਸਤਤਿ',
  'Anand Karaj':         'ਅਨੰਦ ਕਾਰਜ',
  'Wedding':             'ਵਿਆਹ',
};

export const BANI_VARIANT_GROUPS = [
  {
    id: 'rehras-sahib',
    title: 'Rehras Sahib',
    defaultId: 'rehras-sahib',
    variants: [
      {
        id: 'rehras-sahib',
        label: 'Standard',
        description: 'Common complete Rehras without the extra Dasam Granth Dohre.',
      },
      {
        id: 'rehras-sahib-with-dohre',
        label: 'With Dohre',
        description: 'Rehras with the added Dasam Granth Dohre used in many traditions.',
      },
    ],
  },
];

export function getBaniVariantGroupForId(id) {
  if (!id) return null;
  return BANI_VARIANT_GROUPS.find((group) =>
    group.variants.some((variant) => variant.id === id)
  ) || null;
}

export function getBaniVariantForId(id) {
  const group = getBaniVariantGroupForId(id);
  if (!group) return null;
  return group.variants.find((variant) => variant.id === id) || null;
}

const CALENDAR_BANI_RECOMMENDATION_RULES = [
  { needle: 'anand sahib', id: 'anand-sahib' },
  { needle: 'sukhmani sahib', id: 'sukhmani-sahib' },
  { needle: 'chaupai sahib', id: 'chaupai-sahib' },
  { needle: 'rakhia', id: 'rakhia-de-shabad' },
  { needle: 'rakha ek hamara', id: 'rakhia-de-shabad' },
  { needle: 'aarti', id: 'aarti' },
];

export function getRecommendedBaniForCalendarEvents(events, limit = 3) {
  const byId = new Map(BANI_SETS.map((item) => [item.id, item]));
  const recommendations = [];
  const seen = new Set();
  const add = (id, reason) => {
    if (!id || seen.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    seen.add(id);
    recommendations.push({ ...item, recommendationReason: reason || 'Recommended for today' });
  };

  for (const event of events || []) {
    const suggestionText = (event.suggestions || [])
      .map((suggestion) => [
        suggestion.label,
        suggestion.query,
        suggestion.raag,
      ].filter(Boolean).join(' '))
      .join(' ')
      .toLowerCase();

    for (const rule of CALENDAR_BANI_RECOMMENDATION_RULES) {
      if (suggestionText.includes(rule.needle)) add(rule.id, event.title);
    }

    if (recommendations.length >= limit) break;
  }

  return recommendations.slice(0, limit);
}

// UI strings used across the bani index + reader. Each entry is { en, pa }.
// Helper t() in BaniPage picks the active language.
export const BANI_UI_TEXT = {
  eyebrow:           { en: 'One-click Bani',
                       pa: 'ਇੱਕ ਛੋਹ ਨਾਲ ਬਾਣੀ' },
  heroTitle:         { en: 'Bani Mode',
                       pa: 'ਬਾਣੀ ਮੋਡ' },
  heroSub:           { en: 'Open complete bani flows in a calm, text-first reader. Choose from grouped sections instead of searching line by line.',
                       pa: 'ਪੂਰੀਆਂ ਬਾਣੀਆਂ ਨੂੰ ਸ਼ਾਂਤ, ਪਾਠ-ਮੁੱਖ ਰੀਡਰ ਵਿੱਚ ਖੋਲ੍ਹੋ। ਲਾਈਨ-ਦਰ-ਲਾਈਨ ਖੋਜਣ ਦੀ ਥਾਂ ਸਮੂਹਬੱਧ ਭਾਗਾਂ ਵਿੱਚੋਂ ਚੁਣੋ।' },
  langToggleLabel:   { en: 'Language',
                       pa: 'ਭਾਸ਼ਾ' },
  searchPlaceholder: { en: 'Search banis — Japji, Sukhmani, ਅਰਦਾਸ, Nitnem…',
                       pa: 'ਬਾਣੀ ਖੋਜੋ — ਜਪੁਜੀ, ਸੁਖਮਨੀ, ਅਰਦਾਸ, ਨਿਤਨੇਮ…' },
  searchAriaLabel:   { en: 'Search banis',
                       pa: 'ਬਾਣੀਆਂ ਖੋਜੋ' },
  clearSearch:       { en: 'Clear search',
                       pa: 'ਖੋਜ ਮਿਟਾਓ' },
  searchResults:     { en: 'Search results',
                       pa: 'ਖੋਜ ਨਤੀਜੇ' },
  searchEmpty:       { en: 'No banis match',
                       pa: 'ਕੋਈ ਬਾਣੀ ਮੇਲ ਨਹੀਂ ਖਾਂਦੀ' },
  searchEmptyHint:   { en: 'Try a shorter word, or browse the categories below.',
                       pa: 'ਕੋਈ ਛੋਟਾ ਸ਼ਬਦ ਅਜ਼ਮਾਓ, ਜਾਂ ਹੇਠਾਂ ਸਮੂਹ ਦੇਖੋ।' },
  searchMeta:        { en: 'Matching',
                       pa: 'ਨਾਲ ਮੇਲ ਖਾਂਦੀਆਂ' },
  searchMetaHint:    { en: 'Clear the search to see the grouped list.',
                       pa: 'ਖੋਜ ਮਿਟਾਓ ਅਤੇ ਸਮੂਹਬੱਧ ਸੂਚੀ ਦੇਖੋ।' },
  baniCountSingular: { en: 'bani',
                       pa: 'ਬਾਣੀ' },
  baniCountPlural:   { en: 'banis',
                       pa: 'ਬਾਣੀਆਂ' },
  findLabel:         { en: 'Find',
                       pa: 'ਖੋਜੋ' },
  findTitle:         { en: 'Find a line, paudi, astpadi, mahalla, or pankti',
                       pa: 'ਲਾਈਨ, ਪਉੜੀ, ਅਸਟਪਦੀ, ਮਹਲਾ ਜਾਂ ਪੰਕਤੀ ਖੋਜੋ' },
  resumeLive:        { en: 'Resume live',
                       pa: 'ਲਾਈਵ ਮੁੜ ਚਾਲੂ ਕਰੋ' },
  readerDisplay:     { en: 'Reader display',
                       pa: 'ਪੜ੍ਹਨ ਸੈਟਿੰਗਾਂ' },
  close:             { en: 'Close',
                       pa: 'ਬੰਦ ਕਰੋ' },
  backToBani:        { en: 'Back to bani list',
                       pa: 'ਬਾਣੀ ਸੂਚੀ ਤੇ ਵਾਪਸ' },
};

export function getBaniSet(id) {
  return BANI_SETS.find((set) => set.id === id) || null;
}

export function shabadIdsForBaniSegment(segment) {
  if (!segment) return [];
  if (segment.type === 'shabad') return [segment.shabadId].filter(Boolean).map(String);
  if (segment.type === 'shabadList') return (segment.shabadIds || []).filter(Boolean).map(String);
  if (segment.type === 'shabadIdRange') {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const step = start <= end ? 1 : -1;
    const ids = [];
    for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
      ids.push(String(value));
    }
    return ids;
  }
  return [];
}

export function shabadIdsForBaniSet(setOrId) {
  const set = typeof setOrId === 'string' ? getBaniSet(setOrId) : setOrId;
  if (!set?.segments?.length) return [];
  const ids = set.segments.flatMap((segment) => shabadIdsForBaniSegment(segment));
  return Array.from(new Set(ids));
}

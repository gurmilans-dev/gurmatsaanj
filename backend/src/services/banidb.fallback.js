/**
 * Curated fallback lists used when BaniDB is unreachable (offline, blocked,
 * or returning unexpected shapes). The IDs match BaniDB v2 so the rest of the
 * search/match pipeline keeps working — selecting a writer/raag/source from
 * these will still apply the right filter parameter on the next /search call.
 *
 * Source of IDs: https://docs.banidb.com — these are stable.
 */

const SOURCES = [
  { sourceId: 'G', nameGurmukhi: 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ', nameEnglish: 'Sri Guru Granth Sahib Ji' },
  { sourceId: 'D', nameGurmukhi: 'ਸ੍ਰੀ ਦਸਮ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ', nameEnglish: 'Sri Dasam Granth Sahib Ji' },
  { sourceId: 'B', nameGurmukhi: 'ਵਾਰਾਂ ਭਾਈ ਗੁਰਦਾਸ ਜੀ',     nameEnglish: 'Vaaran Bhai Gurdas Ji' },
  { sourceId: 'K', nameGurmukhi: 'ਕਬਿੱਤ ਸਵੱਯੇ ਭਾਈ ਗੁਰਦਾਸ ਜੀ', nameEnglish: 'Kabit Savaiye Bhai Gurdas Ji' },
  { sourceId: 'N', nameGurmukhi: 'ਭਾਈ ਨੰਦ ਲਾਲ ਜੀ',           nameEnglish: 'Bhai Nand Lal Ji' },
];

// A small, useful subset of writers — covers Gurus, common Bhagats and Bhai's.
const WRITERS = [
  { writerId: 1,  nameGurmukhi: 'ਗੁਰੂ ਨਾਨਕ ਦੇਵ ਜੀ',    nameEnglish: 'Guru Nanak Dev Ji', type: 'Guru' },
  { writerId: 2,  nameGurmukhi: 'ਗੁਰੂ ਅੰਗਦ ਦੇਵ ਜੀ',    nameEnglish: 'Guru Angad Dev Ji', type: 'Guru' },
  { writerId: 3,  nameGurmukhi: 'ਗੁਰੂ ਅਮਰ ਦਾਸ ਜੀ',    nameEnglish: 'Guru Amar Das Ji', type: 'Guru' },
  { writerId: 4,  nameGurmukhi: 'ਗੁਰੂ ਰਾਮ ਦਾਸ ਜੀ',    nameEnglish: 'Guru Ram Das Ji', type: 'Guru' },
  { writerId: 5,  nameGurmukhi: 'ਗੁਰੂ ਅਰਜਨ ਦੇਵ ਜੀ',   nameEnglish: 'Guru Arjan Dev Ji', type: 'Guru' },
  { writerId: 6,  nameGurmukhi: 'ਗੁਰੂ ਤੇਗ ਬਹਾਦਰ ਜੀ',  nameEnglish: 'Guru Teg Bahadar Ji', type: 'Guru' },
  { writerId: 7,  nameGurmukhi: 'ਗੁਰੂ ਗੋਬਿੰਦ ਸਿੰਘ ਜੀ', nameEnglish: 'Guru Gobind Singh Ji', type: 'Guru' },
  { writerId: 8,  nameGurmukhi: 'ਭਗਤ ਕਬੀਰ ਜੀ',         nameEnglish: 'Bhagat Kabir Ji', type: 'Bhagat' },
  { writerId: 9,  nameGurmukhi: 'ਭਗਤ ਨਾਮਦੇਵ ਜੀ',        nameEnglish: 'Bhagat Namdev Ji', type: 'Bhagat' },
  { writerId: 10, nameGurmukhi: 'ਭਗਤ ਰਵਿਦਾਸ ਜੀ',        nameEnglish: 'Bhagat Ravidas Ji', type: 'Bhagat' },
  { writerId: 11, nameGurmukhi: 'ਭਗਤ ਫਰੀਦ ਜੀ',         nameEnglish: 'Bhagat Farid Ji', type: 'Bhagat' },
  { writerId: 12, nameGurmukhi: 'ਭਗਤ ਜੈਦੇਵ ਜੀ',          nameEnglish: 'Bhagat Jaidev Ji', type: 'Bhagat' },
  { writerId: 13, nameGurmukhi: 'ਭਗਤ ਤ੍ਰਿਲੋਚਨ ਜੀ',     nameEnglish: 'Bhagat Trilochan Ji', type: 'Bhagat' },
  { writerId: 14, nameGurmukhi: 'ਭਗਤ ਧੰਨਾ ਜੀ',           nameEnglish: 'Bhagat Dhanna Ji', type: 'Bhagat' },
  { writerId: 15, nameGurmukhi: 'ਭਗਤ ਬੇਣੀ ਜੀ',           nameEnglish: 'Bhagat Beni Ji', type: 'Bhagat' },
  { writerId: 16, nameGurmukhi: 'ਭਗਤ ਭੀਖਨ ਜੀ',           nameEnglish: 'Bhagat Bhikhan Ji', type: 'Bhagat' },
  { writerId: 17, nameGurmukhi: 'ਭਗਤ ਪਰਮਾਨੰਦ ਜੀ',      nameEnglish: 'Bhagat Parmanand Ji', type: 'Bhagat' },
  { writerId: 18, nameGurmukhi: 'ਭਗਤ ਸਧਨਾ ਜੀ',           nameEnglish: 'Bhagat Sadhna Ji', type: 'Bhagat' },
  { writerId: 19, nameGurmukhi: 'ਭਗਤ ਰਾਮਾਨੰਦ ਜੀ',       nameEnglish: 'Bhagat Ramanand Ji', type: 'Bhagat' },
  { writerId: 20, nameGurmukhi: 'ਭਗਤ ਪੀਪਾ ਜੀ',            nameEnglish: 'Bhagat Pipa Ji', type: 'Bhagat' },
  { writerId: 21, nameGurmukhi: 'ਭਗਤ ਸੈਣ ਜੀ',             nameEnglish: 'Bhagat Sain Ji', type: 'Bhagat' },
  { writerId: 22, nameGurmukhi: 'ਭਗਤ ਸੂਰਦਾਸ ਜੀ',         nameEnglish: 'Bhagat Surdas Ji', type: 'Bhagat' },
  { writerId: 23, nameGurmukhi: 'ਭਾਈ ਮਰਦਾਨਾ ਜੀ',          nameEnglish: 'Bhai Mardana Ji', type: 'Bhai' },
  { writerId: 24, nameGurmukhi: 'ਭਾਈ ਸੱਤਾ ਡੂਮ',            nameEnglish: 'Satta Doom Ji', type: 'Bhai' },
  { writerId: 25, nameGurmukhi: 'ਭਾਈ ਬਲਵੰਡ ਜੀ',          nameEnglish: 'Balwand Ji', type: 'Bhai' },
];

// 31 standard Raags of Sri Guru Granth Sahib Ji (most common ones).
const RAAGS = [
  { raagId: 2,  nameGurmukhi: 'ਸਿਰੀਰਾਗੁ',     nameEnglish: 'Siree Raag' },
  { raagId: 4,  nameGurmukhi: 'ਮਾਝ',          nameEnglish: 'Maajh' },
  { raagId: 5,  nameGurmukhi: 'ਗਉੜੀ',         nameEnglish: 'Gauree' },
  { raagId: 9,  nameGurmukhi: 'ਆਸਾ',          nameEnglish: 'Aasaa' },
  { raagId: 10, nameGurmukhi: 'ਗੂਜਰੀ',         nameEnglish: 'Goojaree' },
  { raagId: 11, nameGurmukhi: 'ਦੇਵਗੰਧਾਰੀ',     nameEnglish: 'Devgandhari' },
  { raagId: 12, nameGurmukhi: 'ਬਿਹਾਗੜਾ',       nameEnglish: 'Bihagraa' },
  { raagId: 13, nameGurmukhi: 'ਵਡਹੰਸੁ',        nameEnglish: 'Wadhans' },
  { raagId: 14, nameGurmukhi: 'ਸੋਰਠਿ',         nameEnglish: 'Sorath' },
  { raagId: 15, nameGurmukhi: 'ਧਨਾਸਰੀ',         nameEnglish: 'Dhanaasaree' },
  { raagId: 16, nameGurmukhi: 'ਜੈਤਸਰੀ',         nameEnglish: 'Jaitsaree' },
  { raagId: 17, nameGurmukhi: 'ਟੋਡੀ',            nameEnglish: 'Todee' },
  { raagId: 18, nameGurmukhi: 'ਬੈਰਾੜੀ',         nameEnglish: 'Bairaaree' },
  { raagId: 19, nameGurmukhi: 'ਤਿਲੰਗ',          nameEnglish: 'Tilang' },
  { raagId: 20, nameGurmukhi: 'ਸੂਹੀ',           nameEnglish: 'Soohee' },
  { raagId: 21, nameGurmukhi: 'ਬਿਲਾਵਲੁ',         nameEnglish: 'Bilaaval' },
  { raagId: 22, nameGurmukhi: 'ਗੋਂਡ',            nameEnglish: 'Gond' },
  { raagId: 23, nameGurmukhi: 'ਰਾਮਕਲੀ',         nameEnglish: 'Raamkalee' },
  { raagId: 24, nameGurmukhi: 'ਨਟ ਨਾਰਾਇਨ',    nameEnglish: 'Nat Naaraayan' },
  { raagId: 25, nameGurmukhi: 'ਮਾਲੀ ਗਉੜਾ',     nameEnglish: 'Maalee Gauraa' },
  { raagId: 26, nameGurmukhi: 'ਮਾਰੂ',            nameEnglish: 'Maaroo' },
  { raagId: 27, nameGurmukhi: 'ਤੁਖਾਰੀ',          nameEnglish: 'Tukhaaree' },
  { raagId: 28, nameGurmukhi: 'ਕੇਦਾਰਾ',          nameEnglish: 'Kaydaaraa' },
  { raagId: 29, nameGurmukhi: 'ਭੈਰਉ',            nameEnglish: 'Bhairao' },
  { raagId: 30, nameGurmukhi: 'ਬਸੰਤੁ',            nameEnglish: 'Basant' },
  { raagId: 31, nameGurmukhi: 'ਸਾਰਗ',             nameEnglish: 'Saarag' },
  { raagId: 32, nameGurmukhi: 'ਮਲਾਰ',             nameEnglish: 'Malaar' },
  { raagId: 33, nameGurmukhi: 'ਕਾਨੜਾ',            nameEnglish: 'Kaanraa' },
  { raagId: 34, nameGurmukhi: 'ਕਲਿਆਨ',           nameEnglish: 'Kalyaan' },
  { raagId: 35, nameGurmukhi: 'ਪ੍ਰਭਾਤੀ',          nameEnglish: 'Prabhaatee' },
  { raagId: 36, nameGurmukhi: 'ਜੈਜਾਵੰਤੀ',         nameEnglish: 'Jaijaavantee' },
];

module.exports = { SOURCES, WRITERS, RAAGS };

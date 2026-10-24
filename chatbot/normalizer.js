/**
 * Layer 1: Normalizer & Language Detection
 * 
 * Normalizes input:
 * 1. Lowercase, trim
 * 2. Remove punctuation and collapse spaces
 * 3. Fix common domain typos using fuzzy matching dictionary
 * 4. Detect language: English ('en'), Bengali script ('bn'), Hindi script ('hi'),
 *    and Roman-script Bengali/Hindi (Hinglish/Banglish like 'kothay', 'kitna').
 */

const TYPO_MAP = {
  // Contact typos
  'contct': 'contact',
  'contat': 'contact',
  'cntact': 'contact',
  'contect': 'contact',
  'numbr': 'number',
  'nmbr': 'number',
  'nomber': 'number',
  'phne': 'phone',
  'phn': 'phone',
  'watsp': 'whatsapp',
  'whatsp': 'whatsapp',
  'whatsap': 'whatsapp',
  'watsapp': 'whatsapp',
  'whatapp': 'whatsapp',
  'emil': 'email',
  'emai': 'email',

  // Room typos
  'rooom': 'room',
  'roome': 'room',
  'rom': 'room',
  'roms': 'rooms',
  'rooomz': 'rooms',
  'delux': 'deluxe',
  'dlx': 'deluxe',
  'swiming': 'swimming',

  // Booking typos
  'bok': 'book',
  'boking': 'booking',
  'bookng': 'booking',
  'bokking': 'booking',
  'bokk': 'book',
  'resrv': 'reserve',
  'resrvation': 'reservation',

  // Price & Tariff typos
  'prce': 'price',
  'pirce': 'price',
  'prie': 'price',
  'traiff': 'tariff',
  'tarif': 'tariff',
  'tarff': 'tariff',

  // Location & Address typos
  'adress': 'address',
  'addres': 'address',
  'addrs': 'address',
  'loction': 'location',
  'locatn': 'location',
  'locashun': 'location',
  'directon': 'directions',
  'directons': 'directions',
  'kothaye': 'kothay',
  'kothai': 'kothay',

  // Availability typos
  'availabl': 'available',
  'availabel': 'available',
  'avlbl': 'available',
  'avaiable': 'available',
  'availibility': 'availability',
  'availabilty': 'availability',
  'vacnt': 'vacant',

  // Addons & Food typos
  'brekfast': 'breakfast',
  'brakfast': 'breakfast',
  'brakefast': 'breakfast',
  'bfast': 'breakfast',
  'brkfast': 'breakfast',
  'resturant': 'restaurant',
  'restuarant': 'restaurant',
  'restraunt': 'restaurant',
  'candel': 'candlelight',
  'candellight': 'candlelight',
  'candelight': 'candlelight',
  'totu': 'toto',
  'totoo': 'toto',
  'tota': 'toto',
  'ilsh': 'ilish',
  'elish': 'ilish',
  'hilsa': 'ilish',

  // Policies & Timings typos
  'chekin': 'checkin',
  'chkin': 'checkin',
  'checkn': 'checkin',
  'chekout': 'checkout',
  'chakout': 'checkout',
  'checkot': 'checkout',
  'canceltion': 'cancellation',
  'cancl': 'cancel',
  'refnd': 'refund',
  'amnity': 'amenity',
  'amenitis': 'amenities',
  'facilites': 'facilities',
  'fecility': 'facility',
  'polcy': 'policy',
  'policys': 'policies'
};

// Bengali transliterated vocabulary (Banglish)
const BANGLISH_WORDS = new Set([
  'kothay', 'kothaye', 'kothai', 'achhen', 'achen', 'acho', 'kemon', 'bhalo',
  'koto', 'daam', 'bhara', 'taka', 'korbo', 'dekhan', 'dekhao', 'dekhun',
  'thikana', 'yogayog', 'jogajog', 'den', 'dao', 'dite', 'hobe', 'amader',
  'apnader', 'samudra', 'mach', 'bhat', 'khabar', 'shunchen', 'bolun',
  'dhonnobad', 'faka', 'khali', 'ache', 'kina', 'jabo', 'kivabe', 'ekta',
  'chobi', 'diner', 'rat', 'rater', 'nomoskar', 'nomoshkar'
]);

// Hindi transliterated vocabulary (Hinglish)
const HINGLISH_WORDS = new Set([
  'kitna', 'kaise', 'kahan', 'kya', 'chahiye', 'batao', 'bataiye', 'kamra',
  'kamre', 'kamro', 'khana', 'kripya', 'namaste', 'namaskar', 'pranam',
  'sampark', 'pata', 'suvidha', 'shukriya', 'paas', 'hai', 'hain', 'karna',
  'karein', 'karo', 'chahta', 'hoon', 'dijiye', 'batao', 'kiraya', 'raat',
  'kitne', 'baje', 'khali', 'milega', 'dikhao', 'dekhein'
]);

/**
 * Remove punctuation while preserving Latin, Bengali, Devanagari characters and digits.
 */
function cleanPunctuation(str) {
  if (!str) return '';
  // Match any character that is NOT a letter (Latin, Bengali [\u0980-\u09FF], Devanagari [\u0900-\u097F]), digit, or whitespace
  return str.replace(/[^\w\s\u0980-\u09FF\u0900-\u097F]/g, ' ');
}

/**
 * Normalizes input text: lowercase, punctuation removal, whitespace trimming, and typo correction.
 */
function normalizeText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText.toLowerCase().trim();

  // Strip punctuation & extra spaces
  text = cleanPunctuation(text);
  text = text.replace(/\s+/g, ' ').trim();

  // Word-level typo correction
  const words = text.split(' ').map(word => {
    if (TYPO_MAP[word]) {
      return TYPO_MAP[word];
    }
    return word;
  });

  return words.join(' ');
}

/**
 * Detect language of raw text or normalized text.
 * Returns 'bn' (Bengali), 'hi' (Hindi), or 'en' (English).
 */
function detectLanguage(rawText, normalizedText = '') {
  const text = rawText || '';
  const norm = normalizedText || normalizeText(rawText);

  // 1. Bengali Unicode check
  if (/[\u0980-\u09FF]/.test(text)) {
    return 'bn';
  }

  // 2. Hindi / Devanagari Unicode check
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }

  // 3. Token check against Banglish & Hinglish dictionaries
  const tokens = norm.split(' ').filter(Boolean);
  let bnScore = 0;
  let hiScore = 0;

  for (const token of tokens) {
    if (BANGLISH_WORDS.has(token)) bnScore += 2;
    if (HINGLISH_WORDS.has(token)) hiScore += 2;
  }

  if (bnScore > 0 && bnScore >= hiScore) {
    return 'bn';
  }
  if (hiScore > 0 && hiScore > bnScore) {
    return 'hi';
  }

  return 'en';
}

module.exports = {
  normalizeText,
  detectLanguage,
  TYPO_MAP,
  BANGLISH_WORDS,
  HINGLISH_WORDS
};

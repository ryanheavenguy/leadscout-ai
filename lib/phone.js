// Shared phone-number helpers. Plain ESM JS so both server.js (node) and the
// Vite-bundled client can import the same source of truth.

/** ISO 3166-1 alpha-2 → E.164 country calling code (digits only, no '+'). */
export const DIAL_CODES = {
  AF: '93',  AL: '355', DZ: '213', AD: '376', AO: '244', AG: '1',   AR: '54',
  AM: '374', AU: '61',  AT: '43',  AZ: '994', BS: '1',   BH: '973', BD: '880',
  BB: '1',   BY: '375', BE: '32',  BZ: '501', BJ: '229', BT: '975', BO: '591',
  BA: '387', BW: '267', BR: '55',  BN: '673', BG: '359', BF: '226', BI: '257',
  CV: '238', KH: '855', CM: '237', CA: '1',   CF: '236', TD: '235', CL: '56',
  CN: '86',  CO: '57',  KM: '269', CD: '243', CG: '242', CR: '506', HR: '385',
  CU: '53',  CY: '357', CZ: '420', DK: '45',  DJ: '253', DM: '1',   DO: '1',
  EC: '593', EG: '20',  SV: '503', GQ: '240', ER: '291', EE: '372', SZ: '268',
  ET: '251', FJ: '679', FI: '358', FR: '33',  GA: '241', GM: '220', GE: '995',
  DE: '49',  GH: '233', GR: '30',  GD: '1',   GT: '502', GN: '224', GW: '245',
  GY: '592', HT: '509', HN: '504', HU: '36',  IS: '354', IN: '91',  ID: '62',
  IR: '98',  IQ: '964', IE: '353', IL: '972', IT: '39',  JM: '1',   JP: '81',
  JO: '962', KZ: '7',   KE: '254', KI: '686', KW: '965', KG: '996', LA: '856',
  LV: '371', LB: '961', LS: '266', LR: '231', LY: '218', LI: '423', LT: '370',
  LU: '352', MG: '261', MW: '265', MY: '60',  MV: '960', ML: '223', MT: '356',
  MH: '692', MR: '222', MU: '230', MX: '52',  FM: '691', MD: '373', MC: '377',
  MN: '976', ME: '382', MA: '212', MZ: '258', MM: '95',  NA: '264', NR: '674',
  NP: '977', NL: '31',  NZ: '64',  NI: '505', NE: '227', NG: '234', KP: '850',
  MK: '389', NO: '47',  OM: '968', PK: '92',  PW: '680', PS: '970', PA: '507',
  PG: '675', PY: '595', PE: '51',  PH: '63',  PL: '48',  PT: '351', QA: '974',
  RO: '40',  RU: '7',   RW: '250', KN: '1',   LC: '1',   VC: '1',   WS: '685',
  SM: '378', ST: '239', SA: '966', SN: '221', RS: '381', SC: '248', SL: '232',
  SG: '65',  SK: '421', SI: '386', SB: '677', SO: '252', ZA: '27',  KR: '82',
  SS: '211', ES: '34',  LK: '94',  SD: '249', SR: '597', SE: '46',  CH: '41',
  SY: '963', TW: '886', TJ: '992', TZ: '255', TH: '66',  TL: '670', TG: '228',
  TO: '676', TT: '1',   TN: '216', TR: '90',  TM: '993', TV: '688', UG: '256',
  UA: '380', AE: '971', GB: '44',  US: '1',   UY: '598', UZ: '998', VA: '39',
  VU: '678', VE: '58',  VN: '84',  YE: '967', ZM: '260', ZW: '263',
};

/** Every distinct dial code, longest first, for greedy prefix matching. */
const DIAL_CODES_BY_LENGTH = [...new Set(Object.values(DIAL_CODES))]
  .sort((a, b) => b.length - a.length);

/**
 * The '+NN' display form for an ISO country code, or '' when unknown.
 * @param {string} [countryCode] ISO 3166-1 alpha-2, case-insensitive.
 */
export function dialCodeFor(countryCode) {
  const dial = DIAL_CODES[String(countryCode || '').toUpperCase()];
  return dial ? `+${dial}` : '';
}

/**
 * Split an international number ('+44 20 7123 4567') into its calling code and
 * the national remainder. Returns null when the input has no usable '+' prefix.
 * @param {string} [international]
 */
export function splitInternational(international) {
  const raw = String(international || '').trim();
  if (!raw.startsWith('+')) return null;

  const digits = raw.slice(1).replace(/\D/g, '');
  if (!digits) return null;

  const dial = DIAL_CODES_BY_LENGTH.find(d => digits.startsWith(d));
  if (!dial) return null;

  // Keep the original spacing/punctuation of the national part when possible so
  // the number stays in the locally-readable form Google returned.
  const nationalDigits = digits.slice(dial.length);
  const formatted = raw.slice(1).replace(/^\s*/, '');
  const national = formatted.startsWith(dial)
    ? formatted.slice(dial.length).trim()
    : nationalDigits;

  return { countryCode: `+${dial}`, national: national || nationalDigits };
}

/**
 * Resolve a phone number into a display pair: the '+NN' country code and the
 * national number. Prefers Google's international form, falls back to pairing
 * the national number with the search region's dial code.
 *
 * @param {{ international?: string, national?: string, regionCode?: string }} input
 * @returns {{ phone: string|null, phoneCountryCode: string|null }}
 */
export function normalizePhone({ international, national, regionCode } = {}) {
  const split = splitInternational(international);
  if (split) {
    return { phone: split.national, phoneCountryCode: split.countryCode };
  }

  const nat = String(national || '').trim();
  if (!nat) return { phone: null, phoneCountryCode: null };

  // The national number itself may already carry a '+' prefix in some feeds.
  const embedded = splitInternational(nat);
  if (embedded) {
    return { phone: embedded.national, phoneCountryCode: embedded.countryCode };
  }

  return { phone: nat, phoneCountryCode: dialCodeFor(regionCode) || null };
}

// Calling codes where a leading '0' belongs to the subscriber number and must
// survive internationalization. Italy (and Vatican City, which shares +39) is
// the standard exception; everywhere else the '0' is a national trunk prefix.
const TRUNK_ZERO_SIGNIFICANT = new Set(['39']);

/**
 * Drop the national trunk prefix so a number reads correctly beside its calling
 * code ('020 7123 4567' + '+44' → '20 7123 4567').
 * @param {string} [countryCode] '+44'
 * @param {string} [phone] national number
 */
export function stripTrunkPrefix(countryCode, phone) {
  const nat = String(phone || '').trim();
  const dial = String(countryCode || '').replace(/\D/g, '');
  if (!nat || !dial || TRUNK_ZERO_SIGNIFICANT.has(dial)) return nat;
  // Only a leading zero on the number itself, not one inside '(0)' notation.
  return nat.replace(/^0+(?=\d)/, '');
}

/**
 * Digits-only E.164 form ('442071234567') for tel:/wa.me links, or '' when the
 * number cannot be made international.
 * @param {string} [countryCode] '+44'
 * @param {string} [phone] national number
 */
export function toE164Digits(countryCode, phone) {
  const nat = String(phone || '').replace(/\D/g, '');
  if (!nat) return '';

  const dial = String(countryCode || '').replace(/\D/g, '');
  if (!dial) return nat;

  return `${dial}${stripTrunkPrefix(countryCode, nat)}`;
}

/**
 * Whether two numbers refer to the same line, tolerating formatting, trunk
 * prefixes and one side being written internationally and the other nationally.
 * Compares the trailing significant digits, which survive both conventions.
 */
export function sameNumber(a, b) {
  const digitsA = String(a || '').replace(/\D/g, '').replace(/^0+/, '');
  const digitsB = String(b || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digitsA || !digitsB) return false;
  if (digitsA === digitsB) return true;

  // Require a solid overlap so short/partial numbers cannot match by accident.
  const len = Math.min(digitsA.length, digitsB.length);
  if (len < 7) return false;
  return digitsA.slice(-len) === digitsB.slice(-len);
}

/** Full display form: '+44 20 7123 4567'. */
export function formatPhone(countryCode, phone) {
  const nat = String(phone || '').trim();
  if (!nat) return '';
  const dial = String(countryCode || '').trim();
  return dial ? `${dial} ${stripTrunkPrefix(dial, nat)}` : nat;
}

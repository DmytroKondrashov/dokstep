import type { Case, DateFormat, DeclineAs, LetterCase, NameFormat, Transform } from './types.ts';

/* Client-safe transform helpers. Declension needs shevchenko and runs on the server
   (#lib/server/transform.ts); everything else is plain string work. */

export const CASES: { id: Case; label: string }[] = [
	{ id: 'nom', label: 'називний' },
	{ id: 'gen', label: 'родовий' },
	{ id: 'dat', label: 'давальний' },
	{ id: 'acc', label: 'знахідний' },
	{ id: 'ins', label: 'орудний' },
	{ id: 'loc', label: 'місцевий' },
	{ id: 'voc', label: 'кличний' }
];

export const DECLINE_AS: { id: DeclineAs; label: string }[] = [
	{ id: 'name', label: 'ПІБ' },
	{ id: 'rank', label: 'звання' },
	{ id: 'appointment', label: 'посада / фраза' }
];

export const NAME_FORMATS: { id: NameFormat; label: string }[] = [
	{ id: 'full', label: 'як є' },
	{ id: 'surnameFull', label: 'ПРІЗВИЩЕ Ім’я По батькові' },
	{ id: 'givenSurname', label: 'Ім’я ПРІЗВИЩЕ' },
	{ id: 'initialsSurname', label: 'І.П. ПРІЗВИЩЕ' },
	{ id: 'surnameInitials', label: 'ПРІЗВИЩЕ І.П.' },
	{ id: 'surname', label: 'ПРІЗВИЩЕ' }
];

export const LETTER_CASES: { id: LetterCase; label: string }[] = [
	{ id: 'upper', label: 'ВЕЛИКІ' },
	{ id: 'lower', label: 'малі' },
	{ id: 'capitalize', label: 'З великої' }
];

export const DATE_FORMATS: { id: DateFormat; label: string }[] = [
	{ id: 'short', label: '05.08.2026' },
	{ id: 'long', label: '5 серпня 2026 року' },
	{ id: 'quoted', label: '«05» серпня 2026 року' }
];

/** True for a transform that changes nothing. */
export function isIdentity(t: Transform | undefined | null): boolean {
	if (!t) return true;
	return (
		!t.addDays &&
		!t.dateFormat &&
		(!t.case || t.case === 'nom') &&
		(!t.nameFormat || t.nameFormat === 'full') &&
		!t.letter
	);
}

/** Drop no-op keys so stored transforms stay small and comparable. */
export function cleanTransform(t: Transform | undefined | null): Transform | undefined {
	if (!t) return undefined;
	const out: Transform = {};
	if (t.addDays) out.addDays = Number(t.addDays);
	if (t.dateFormat) out.dateFormat = t.dateFormat;
	if (t.case && t.case !== 'nom') {
		out.case = t.case;
		if (t.declineAs && t.declineAs !== 'name') out.declineAs = t.declineAs;
	}
	if (t.nameFormat && t.nameFormat !== 'full') out.nameFormat = t.nameFormat;
	if (t.letter) out.letter = t.letter;
	return Object.keys(out).length ? out : undefined;
}

export function sameTransform(a: Transform | undefined, b: Transform | undefined): boolean {
	return JSON.stringify(cleanTransform(a) ?? {}) === JSON.stringify(cleanTransform(b) ?? {});
}

/** Short human description, e.g. «родовий · І.П. ПРІЗВИЩЕ». */
export function describeTransform(t: Transform | undefined | null): string {
	if (!t || isIdentity(t)) return '';
	const parts: string[] = [];
	if (t.addDays) parts.push(`${t.addDays > 0 ? '+' : ''}${t.addDays} дн.`);
	if (t.dateFormat) parts.push(DATE_FORMATS.find((x) => x.id === t.dateFormat)?.label ?? '');
	if (t.case && t.case !== 'nom') parts.push(CASES.find((x) => x.id === t.case)?.label ?? '');
	if (t.nameFormat && t.nameFormat !== 'full')
		parts.push(NAME_FORMATS.find((x) => x.id === t.nameFormat)?.label ?? '');
	if (t.letter) parts.push(LETTER_CASES.find((x) => x.id === t.letter)?.label ?? '');
	return parts.filter(Boolean).join(' · ');
}

/* ---------- dates ---------- */

const MONTHS_GEN = [
	'січня',
	'лютого',
	'березня',
	'квітня',
	'травня',
	'червня',
	'липня',
	'серпня',
	'вересня',
	'жовтня',
	'листопада',
	'грудня'
];

/** Parse `dd.mm.yyyy` (also `/` or `-` separators, or `«05» серпня 2026`). */
export function parseDate(s: string): Date | null {
	const t = s.trim();
	let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s*(?:р\.|року))?$/);
	if (m) return makeDate(+m[3], +m[2], +m[1]);
	m = t.match(/^«?(\d{1,2})»?\s+(\p{L}+)\s+(\d{4})(?:\s*(?:р\.|року))?$/u);
	if (m) {
		const mi = MONTHS_GEN.indexOf(m[2].toLowerCase());
		if (mi >= 0) return makeDate(+m[3], mi + 1, +m[1]);
	}
	return null;
}

function makeDate(y: number, mo: number, d: number): Date | null {
	const date = new Date(Date.UTC(y, mo - 1, d));
	return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date, f: DateFormat = 'short'): string {
	const day = d.getUTCDate();
	const month = d.getUTCMonth();
	const year = d.getUTCFullYear();
	if (f === 'long') return `${day} ${MONTHS_GEN[month]} ${year} року`;
	if (f === 'quoted') return `«${pad(day)}» ${MONTHS_GEN[month]} ${year} року`;
	return `${pad(day)}.${pad(month + 1)}.${year}`;
}

/** Date shift + format. A value that is not a date passes unchanged. */
export function applyDate(value: string, t: Transform): string {
	if (!t.addDays && !t.dateFormat) return value;
	const d = parseDate(value);
	if (!d) return value;
	if (t.addDays) d.setUTCDate(d.getUTCDate() + Number(t.addDays));
	return formatDate(d, t.dateFormat ?? guessDateFormat(value));
}

function guessDateFormat(value: string): DateFormat {
	if (/^\s*«/.test(value)) return 'quoted';
	if (/\p{L}{3,}/u.test(value)) return 'long';
	return 'short';
}

/* ---------- names ---------- */

export type NameRole = 'family' | 'given' | 'patronymic' | 'initials';
export interface NameToken {
	role: NameRole;
	text: string;
}

const PATRONYMIC_RE = /(ович|евич|йович|ївна|івна|овна|ична|інічна|ьович)$/i;
const WORD_RE = /^[\p{L}'’ʼ-]+$/u;
const INITIALS_RE = /^(\p{Lu}\.\s*){1,2}$/u;

const isUpperWord = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();

/**
 * Split a Ukrainian full name into roles, keeping the original order.
 * A fully upper-cased word is the surname; otherwise «Прізвище Ім’я По батькові»
 * (3 words with a patronymic last), «Ім’я По батькові Прізвище», «Ім’я Прізвище».
 * Returns null for text that does not look like a name.
 */
export function parseName(s: string): NameToken[] | null {
	const words = s.trim().split(/\s+/).filter(Boolean);
	if (!words.length || words.length > 4) return null;
	if (!words.every((w) => WORD_RE.test(w) || INITIALS_RE.test(w))) return null;
	const lettered = words.filter((w) => !INITIALS_RE.test(w));
	if (!lettered.length || lettered.length > 3) return null;

	const roles = new Map<string, NameRole>();
	const upper = lettered.find(isUpperWord);
	if (upper) {
		roles.set(upper, 'family');
		const rest = lettered.filter((w) => w !== upper);
		if (rest[0]) roles.set(rest[0], 'given');
		if (rest[1]) roles.set(rest[1], 'patronymic');
	} else if (lettered.length === 3) {
		if (PATRONYMIC_RE.test(lettered[1]) && !PATRONYMIC_RE.test(lettered[2])) {
			roles.set(lettered[0], 'given').set(lettered[1], 'patronymic').set(lettered[2], 'family');
		} else {
			roles.set(lettered[0], 'family').set(lettered[1], 'given').set(lettered[2], 'patronymic');
		}
	} else if (lettered.length === 2) {
		if (PATRONYMIC_RE.test(lettered[1]))
			roles.set(lettered[0], 'given').set(lettered[1], 'patronymic');
		else roles.set(lettered[0], 'given').set(lettered[1], 'family');
	} else {
		roles.set(lettered[0], 'family');
	}
	return words.map((w) => ({
		role: INITIALS_RE.test(w) ? 'initials' : (roles.get(w) ?? 'family'),
		text: w
	}));
}

const initial = (w: string | undefined) => (w ? `${w.charAt(0).toUpperCase()}.` : '');

/** Re-arrange parsed name tokens into the requested format. */
export function formatName(tokens: NameToken[], f: NameFormat): string {
	const get = (r: NameRole) => tokens.find((t) => t.role === r)?.text;
	const family = (get('family') ?? '').toUpperCase();
	const inits =
		get('initials')?.replace(/\s+/g, '') ?? `${initial(get('given'))}${initial(get('patronymic'))}`;
	switch (f) {
		case 'surnameFull':
			return [family, get('given'), get('patronymic')].filter(Boolean).join(' ');
		case 'givenSurname':
			return [get('given') ?? inits, family].filter(Boolean).join(' ');
		case 'initialsSurname':
			return [inits, family].filter(Boolean).join(' ');
		case 'surnameInitials':
			return [family, inits].filter(Boolean).join(' ');
		case 'surname':
			return family;
		default:
			return tokens.map((t) => t.text).join(' ');
	}
}

export function applyLetter(value: string, l: LetterCase | undefined): string {
	if (l === 'upper') return value.toUpperCase();
	if (l === 'lower') return value.toLowerCase();
	if (l === 'capitalize') return value.charAt(0).toUpperCase() + value.slice(1);
	return value;
}

/** Replace `{Field label}` in a file-name pattern. */
export function fillPattern(pattern: string, byLabel: Record<string, string>): string {
	return pattern.replace(/\{([^{}]+)\}/g, (_, label: string) => byLabel[label.trim()] ?? '').trim();
}

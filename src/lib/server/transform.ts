import * as shevchenko from 'shevchenko';
import { militaryExtension } from 'shevchenko-ext-military';
import { applyDate, applyLetter, formatName, isIdentity, parseName } from '#lib/transform.js';
import type { NameToken } from '#lib/transform.js';
import type { Case, DeclineAs, Transform } from '#lib/types.js';

shevchenko.registerExtension(militaryExtension);

const FN = {
	nom: shevchenko.inNominative,
	gen: shevchenko.inGenitive,
	dat: shevchenko.inDative,
	acc: shevchenko.inAccusative,
	ins: shevchenko.inAblative,
	loc: shevchenko.inLocative,
	voc: shevchenko.inVocative
} as const;

const cache = new Map<string, Promise<string>>();

/** Apply a transform; declension results are cached (shevchenko is slow-ish and async). */
export async function applyTransform(
	value: string,
	t: Transform | undefined | null
): Promise<string> {
	if (!value || !t || isIdentity(t)) return value;
	const key = `${value}\u0000${JSON.stringify(t)}`;
	let p = cache.get(key);
	if (!p) {
		p = run(value, t);
		cache.set(key, p);
		if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
	}
	return p;
}

async function run(value: string, t: Transform): Promise<string> {
	let v = applyDate(value, t);
	let tokens: NameToken[] | null = null;
	if (t.case && t.case !== 'nom') {
		if ((t.declineAs ?? 'name') === 'name') {
			tokens = parseName(v);
			if (tokens) tokens = await declineName(tokens, t.case);
			else v = await declinePhrase(v, t.case, 'appointment');
		} else {
			v = await declinePhrase(v, t.case, t.declineAs ?? 'appointment');
		}
	}
	if (t.nameFormat && t.nameFormat !== 'full') {
		tokens ??= parseName(v);
		if (tokens) v = formatName(tokens, t.nameFormat);
	} else if (tokens) {
		v = formatName(tokens, 'full');
	}
	return applyLetter(v, t.letter);
}

async function declineName(tokens: NameToken[], c: Case): Promise<NameToken[]> {
	const get = (r: string) => tokens.find((x) => x.role === r)?.text;
	const input = {
		givenName: get('given'),
		patronymicName: get('patronymic'),
		familyName: get('family')
	};
	try {
		const gender = (await shevchenko.detectGender(input)) ?? shevchenko.GrammaticalGender.MASCULINE;
		const out = await FN[c]({ gender, ...input });
		const map: Record<string, string | undefined> = {
			given: out.givenName,
			patronymic: out.patronymicName,
			family: out.familyName
		};
		return tokens.map((x) => ({ ...x, text: map[x.role] ?? x.text }));
	} catch (e) {
		console.warn('declineName failed:', (e as Error)?.message);
		return tokens;
	}
}

/** Military rank / appointment (or any phrase shevchenko-ext-military understands). */
async function declinePhrase(text: string, c: Case, as: DeclineAs): Promise<string> {
	const prop = as === 'rank' ? 'militaryRank' : 'militaryAppointment';
	try {
		const out = (await FN[c]({
			gender: shevchenko.GrammaticalGender.MASCULINE,
			[prop]: text
		} as never)) as Record<string, string>;
		return out[prop] ?? text;
	} catch (e) {
		console.warn('declinePhrase failed:', (e as Error)?.message);
		return text;
	}
}

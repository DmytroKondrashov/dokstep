import { describe, expect, it } from 'vitest';
import { applyTransform } from '../src/lib/server/transform.ts';
import { applyDate, formatName, parseName } from '../src/lib/transform.ts';

describe('names', () => {
	it('finds the surname by upper case or by position', () => {
		expect(parseName('Іван ПЕТРЕНКО')?.map((t) => t.role)).toEqual(['given', 'family']);
		expect(parseName('Петренко Іван Васильович')?.map((t) => t.role)).toEqual([
			'family',
			'given',
			'patronymic'
		]);
		expect(parseName('Іван Васильович Петренко')?.map((t) => t.role)).toEqual([
			'given',
			'patronymic',
			'family'
		]);
		expect(parseName('командир взводу резерву рядового складу')).toBeNull();
	});

	it('formats names', () => {
		const t = parseName('Петренко Іван Васильович')!;
		expect(formatName(t, 'givenSurname')).toBe('Іван ПЕТРЕНКО');
		expect(formatName(t, 'initialsSurname')).toBe('І.В. ПЕТРЕНКО');
		expect(formatName(t, 'surnameInitials')).toBe('ПЕТРЕНКО І.В.');
	});

	it('declines names and military phrases', async () => {
		expect(await applyTransform('КОВАЛЕНКО Петро Іванович', { case: 'gen' })).toBe(
			'КОВАЛЕНКА Петра Івановича'
		);
		expect(
			await applyTransform('Олена Коваленко', { case: 'dat', nameFormat: 'givenSurname' })
		).toBe('Олені КОВАЛЕНКО');
		expect(await applyTransform('старший солдат', { case: 'ins', declineAs: 'rank' })).toBe(
			'старшим солдатом'
		);
	});
});

describe('dates', () => {
	it('shifts and formats', () => {
		expect(applyDate('05.08.2026', { addDays: 10 })).toBe('15.08.2026');
		expect(applyDate('28.02.2026', { addDays: 1, dateFormat: 'long' })).toBe('1 березня 2026 року');
		expect(applyDate('«05» серпня 2026 року', { addDays: 1 })).toBe('«06» серпня 2026 року');
		expect(applyDate('не дата', { addDays: 1 })).toBe('не дата');
	});
});

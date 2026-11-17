import { describe, expect, it } from 'vitest';
import {
	createRun,
	createWorkflow,
	getRun,
	getWorkflow,
	saveRun,
	saveWorkflow
} from '../src/lib/server/db.ts';

describe('saves ignore requests that arrive late', () => {
	it('workflow: an older revision does not overwrite a newer one', () => {
		const wf = createWorkflow('Тест');
		saveWorkflow(wf.id, { name: 'новий', description: '', steps: [] }, 200);
		saveWorkflow(wf.id, { name: 'старий', description: '', steps: [] }, 100);
		expect(getWorkflow(wf.id)?.name).toBe('новий');
	});

	it('run: same rule', () => {
		const wf = createWorkflow('Тест');
		const run = createRun(wf.id, 'справа');
		saveRun(run.id, 'справа', { a: 'нове' }, 200);
		saveRun(run.id, 'справа', { a: 'старе' }, 100);
		expect(getRun(run.id)?.values).toEqual({ a: 'нове' });
	});
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DocPreview, Run, Workflow, WorkflowDefinition, WorkflowSummary } from '#lib/types.js';

/**
 * SQLite storage (built into Node ≥ 22). One file: `$DATA_DIR/dokstep.db` (default `./data`).
 * Workflow definitions are JSON; uploaded example documents are BLOBs with their preview.
 */
const DATA_DIR = process.env.DATA_DIR || 'data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'dokstep.db'));
db.exec(`
	PRAGMA journal_mode = WAL;
	PRAGMA foreign_keys = ON;
	CREATE TABLE IF NOT EXISTS workflows (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		definition TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS documents (
		id TEXT PRIMARY KEY,
		workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		data BLOB NOT NULL,
		preview TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS documents_workflow ON documents(workflow_id);
	CREATE TABLE IF NOT EXISTS runs (
		id TEXT PRIMARY KEY,
		workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		"values" TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS runs_workflow ON runs(workflow_id);
`);

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);

type Row = Record<string, unknown>;

function toWorkflow(r: Row): Workflow {
	return {
		id: r.id as string,
		name: r.name as string,
		description: r.description as string,
		...(JSON.parse(r.definition as string) as WorkflowDefinition),
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string
	};
}

function toRun(r: Row): Run {
	return {
		id: r.id as string,
		workflowId: r.workflow_id as string,
		name: r.name as string,
		values: JSON.parse(r.values as string),
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string
	};
}

/* ---------- workflows ---------- */

export function listWorkflows(): WorkflowSummary[] {
	const rows = db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all() as Row[];
	return rows.map((r) => {
		const w = toWorkflow(r);
		return {
			id: w.id,
			name: w.name,
			description: w.description,
			steps: w.steps.length,
			docs: w.steps.reduce((n, s) => n + s.docs.length, 0),
			updatedAt: w.updatedAt
		};
	});
}

export function getWorkflow(id: string): Workflow | null {
	const r = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as Row | undefined;
	return r ? toWorkflow(r) : null;
}

export function createWorkflow(name: string, description = '', def?: WorkflowDefinition): Workflow {
	const id = newId();
	const t = now();
	const definition: WorkflowDefinition = def ?? {
		steps: [{ id: newId(), name: 'Крок 1', docs: [], fields: [], marks: [] }]
	};
	db.prepare(
		'INSERT INTO workflows (id, name, description, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, name, description, JSON.stringify(definition), t, t);
	return getWorkflow(id)!;
}

/** Save name/description/steps and drop documents no step refers to any more. */
export function saveWorkflow(id: string, w: Pick<Workflow, 'name' | 'description' | 'steps'>) {
	const definition: WorkflowDefinition = { steps: w.steps };
	db.prepare(
		'UPDATE workflows SET name = ?, description = ?, definition = ?, updated_at = ? WHERE id = ?'
	).run(w.name, w.description ?? '', JSON.stringify(definition), now(), id);
	// Uploads land before the definition that refers to them is saved, so only
	// documents orphaned for a while are removed.
	const used = new Set(w.steps.flatMap((s) => s.docs.map((d) => d.id)));
	const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
	const docs = db
		.prepare('SELECT id FROM documents WHERE workflow_id = ? AND created_at < ?')
		.all(id, cutoff) as Row[];
	const del = db.prepare('DELETE FROM documents WHERE id = ?');
	for (const d of docs) if (!used.has(d.id as string)) del.run(d.id as string);
}

export function deleteWorkflow(id: string) {
	db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
}

/* ---------- documents ---------- */

export function addDocument(
	workflowId: string,
	name: string,
	data: Uint8Array,
	preview: DocPreview
) {
	const id = newId();
	db.prepare(
		'INSERT INTO documents (id, workflow_id, name, data, preview, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, workflowId, name, data, JSON.stringify(preview), now());
	return id;
}

export function getDocumentData(id: string): { name: string; data: Uint8Array } | null {
	const r = db.prepare('SELECT name, data FROM documents WHERE id = ?').get(id) as Row | undefined;
	return r ? { name: r.name as string, data: r.data as Uint8Array } : null;
}

export function getPreviews(workflowId: string): Record<string, DocPreview> {
	const rows = db
		.prepare('SELECT id, preview FROM documents WHERE workflow_id = ?')
		.all(workflowId) as Row[];
	return Object.fromEntries(rows.map((r) => [r.id as string, JSON.parse(r.preview as string)]));
}

/* ---------- runs ---------- */

export function listRuns(workflowId?: string): (Run & { workflowName: string })[] {
	const rows = (
		workflowId
			? db
					.prepare(
						'SELECT r.*, w.name AS workflow_name FROM runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.workflow_id = ? ORDER BY r.updated_at DESC'
					)
					.all(workflowId)
			: db
					.prepare(
						'SELECT r.*, w.name AS workflow_name FROM runs r JOIN workflows w ON w.id = r.workflow_id ORDER BY r.updated_at DESC'
					)
					.all()
	) as Row[];
	return rows.map((r) => ({ ...toRun(r), workflowName: r.workflow_name as string }));
}

export function getRun(id: string): Run | null {
	const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
	return r ? toRun(r) : null;
}

export function createRun(workflowId: string, name: string): Run {
	const id = newId();
	const t = now();
	db.prepare(
		'INSERT INTO runs (id, workflow_id, name, "values", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, workflowId, name, '{}', t, t);
	return getRun(id)!;
}

export function saveRun(id: string, name: string, values: Record<string, string>) {
	db.prepare('UPDATE runs SET name = ?, "values" = ?, updated_at = ? WHERE id = ?').run(
		name,
		JSON.stringify(values),
		now(),
		id
	);
}

export function deleteRun(id: string) {
	db.prepare('DELETE FROM runs WHERE id = ?').run(id);
}

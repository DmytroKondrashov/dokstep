/**
 * Domain model.
 *
 * A workflow is an ordered list of steps. Each step owns example documents (.docx)
 * and fields. A mark is a text range in one of the step's documents that is
 * replaced on generation by a field's value — a field of the same step (an input)
 * or of an earlier step (inherited), passed through an optional transform.
 */

export type Case = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'loc' | 'voc';
export type DeclineAs = 'name' | 'rank' | 'appointment';
export type NameFormat =
	| 'full'
	| 'surnameFull'
	| 'givenSurname'
	| 'initialsSurname'
	| 'surnameInitials'
	| 'surname';
export type LetterCase = 'upper' | 'lower' | 'capitalize';
export type DateFormat = 'short' | 'long' | 'quoted';

/** Applied in this order: date shift/format → declension → name format → letter case. */
export interface Transform {
	addDays?: number;
	dateFormat?: DateFormat;
	case?: Case;
	declineAs?: DeclineAs;
	nameFormat?: NameFormat;
	letter?: LetterCase;
}

export interface Field {
	id: string;
	label: string;
	/** The text the field had in the example document; a placeholder hint when generating. */
	example: string;
	multiline?: boolean;
	/** Left empty when generating, the field takes this value (another field + transform). */
	defaultFrom?: { fieldId: string; transform?: Transform } | null;
}

export interface Mark {
	id: string;
	docId: string;
	/** Paragraph key `<part>#<index>`, see paragraphKey() on the server. */
	para: string;
	start: number;
	end: number;
	fieldId: string;
	transform?: Transform;
}

export interface StepDoc {
	id: string;
	name: string;
	/** Output file name without extension; `{Field label}` is replaced by the field value. */
	outputName: string;
}

export interface Step {
	id: string;
	name: string;
	docs: StepDoc[];
	fields: Field[];
	marks: Mark[];
}

export interface WorkflowDefinition {
	steps: Step[];
}

export interface Workflow extends WorkflowDefinition {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

export interface WorkflowSummary {
	id: string;
	name: string;
	description: string;
	steps: number;
	docs: number;
	updatedAt: string;
}

export interface Run {
	id: string;
	workflowId: string;
	name: string;
	/** Values typed by the user, by field id. Missing/empty = automatic (defaultFrom) or blank. */
	values: Record<string, string>;
	createdAt: string;
	updatedAt: string;
}

/* ---------- document preview model (what the editor renders) ---------- */

export interface PreviewRun {
	/** Plain text; tabs are `\t`, line breaks `\n` — one character each, like the server's offsets. */
	text: string;
	b?: boolean;
	i?: boolean;
	u?: boolean;
	strike?: boolean;
	/** Font size in pt. */
	sz?: number;
	color?: string;
	highlight?: string;
}

export interface PreviewParagraph {
	t: 'p';
	key: string;
	runs: PreviewRun[];
	align?: 'left' | 'center' | 'right' | 'both';
	/** Indents in pt. */
	indLeft?: number;
	indFirst?: number;
	spaceBefore?: number;
	spaceAfter?: number;
}

export interface PreviewCell {
	blocks: PreviewBlock[];
	span?: number;
	/** Continuation of a vertically merged cell (rendered empty, without top border). */
	merged?: boolean;
	width?: number;
}

export interface PreviewTable {
	t: 'tbl';
	rows: PreviewCell[][];
}

export type PreviewBlock = PreviewParagraph | PreviewTable;

export interface PreviewPart {
	/** Zip part name, e.g. `word/document.xml`. */
	name: string;
	kind: 'body' | 'header' | 'footer' | 'footnotes';
	blocks: PreviewBlock[];
}

export interface DocPreview {
	parts: PreviewPart[];
	/** Paragraph key → plain text (for searching and validating marks). */
	text: Record<string, string>;
	/** Page width (content area) in pt, for a roughly Word-like preview. */
	pageWidth?: number;
}

/** An unmarked place where a field's example (maybe declined / re-formatted) occurs. */
export interface Suggestion {
	fieldId: string;
	transform?: Transform;
	text: string;
	occurrences: Omit<Mark, 'id' | 'fieldId' | 'transform'>[];
}

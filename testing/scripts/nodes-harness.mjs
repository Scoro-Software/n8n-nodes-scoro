#!/usr/bin/env node
/**
 * Runs the compiled Scoro node outside n8n, with a stub execution context, to check the requests
 * its operations (User → Get Me, Eli → Send Message) build and the way they report errors.
 *
 *   npm run build && node testing/scripts/nodes-harness.mjs
 *
 * The HTTP layer is stubbed: every call is recorded and answered by the check's fetchImpl.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { Scoro, ELI_TIMEOUT_MS } = require(join(ROOT, 'dist', 'nodes', 'Scoro', 'Scoro.node.js'));

let failures = 0;
const check = (label, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures += 1;
};

/**
 * Stub of the parts of IExecuteFunctions the node uses. `params` is indexed by item; `resource`
 * and `operation` select what the node does.
 */
function context({
	items = [{ json: {} }],
	params = [{}],
	fetchImpl,
	continueOnFail = false,
	companyAccount = 'acme',
	resource = 'user',
	operation = 'getMe',
}) {
	const calls = [];
	return {
		calls,
		getInputData: () => items,
		getNodeParameter: (name, i, fallback) => {
			if (name === 'resource') return resource;
			if (name === 'operation') return operation;
			const p = params[i] ?? params[0] ?? {};
			return name in p ? p[name] : fallback;
		},
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ siteUrl: 'https://Example.scoro.ee/', companyAccount }),
		getNode: () => ({
			name: 'Scoro',
			type: 'scoro',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		helpers: {
			httpRequestWithAuthentication: async (_type, options) => {
				calls.push(options);
				return fetchImpl(options, calls.length - 1);
			},
		},
	};
}

/** An error shaped like the one n8n's request helper throws for an HTTP error status. */
function httpError(status, data, headers = {}) {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data, headers },
	});
}

const scoro = new Scoro();
const getMe = (overrides) => context({ resource: 'user', operation: 'getMe', ...overrides });
const sendMessage = (overrides) =>
	context({ resource: 'eli', operation: 'sendMessage', ...overrides });
const user = { id: 7, firstName: 'Ada', accounts: ['acme'] };
const answer = {
	threadId: 'thr_1',
	messageId: 'msg_1',
	response: 'Three tasks are overdue.',
	createdDateTime: '2026-11-03T12:00:00+02:00',
	isNewThread: true,
};

// --- User → Get Me --------------------------------------------------------------------------

{
	const ctx = getMe({ fetchImpl: async () => user });
	const [out] = await scoro.execute.call(ctx);
	const call = ctx.calls[0];
	check(
		'Get Me requests GET /users/me on the site host (any Scoro domain)',
		call?.method === 'GET' && call?.url === 'https://Example.scoro.ee/api/v4/users/me',
		call?.url,
	);
	check(
		'Get Me sends the company account header when set',
		call?.headers?.['Scoro-Company-Account'] === 'acme',
	);
	check(
		'Get Me outputs the user with pairedItem',
		out[0]?.json?.firstName === 'Ada' && out[0]?.pairedItem?.item === 0,
	);
}

{
	const ctx = getMe({
		items: [{ json: {} }, { json: {} }],
		fetchImpl: async () => user,
		companyAccount: '  ',
	});
	const [out] = await scoro.execute.call(ctx);
	check(
		'Get Me runs once per input item',
		ctx.calls.length === 2 && out[1]?.pairedItem?.item === 1,
	);
	check(
		'blank company account sends no header',
		!('Scoro-Company-Account' in (ctx.calls[0]?.headers ?? {})),
	);
}

{
	const ctx = getMe({
		fetchImpl: async () => {
			throw httpError(401, { error: 'unauthorized', message: ['Token expired'] });
		},
	});
	let caught;
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		caught = error;
	}
	check(
		'HTTP errors become readable NodeApiErrors',
		caught?.constructor?.name === 'NodeApiError' &&
			caught?.message === 'Scoro did not accept the authentication',
		caught?.message,
	);
	check(
		'error description keeps the API text and the fix',
		String(caught?.description).includes('Token expired') &&
			String(caught?.description).includes('Reconnect'),
	);
}

{
	const ctx = getMe({
		continueOnFail: true,
		fetchImpl: async () => {
			throw httpError(500, 'boom');
		},
	});
	const [out] = await scoro.execute.call(ctx);
	check(
		'Continue On Fail turns the error into an item',
		out[0]?.json?.error === 'Scoro API error (500)' && out[0]?.pairedItem?.item === 0,
		out[0]?.json?.error,
	);
}

// --- Eli → Send Message ---------------------------------------------------------------------

{
	const ctx = sendMessage({
		params: [{ message: 'Which tasks are overdue?', options: {} }],
		fetchImpl: async () => answer,
	});
	const [out] = await scoro.execute.call(ctx);
	const call = ctx.calls[0];
	check(
		'Send Message posts to /ai/messages',
		call?.method === 'POST' && call?.url === 'https://Example.scoro.ee/api/v4/ai/messages',
		call?.url,
	);
	check(
		'a new conversation sends only the message',
		JSON.stringify(call?.body) === JSON.stringify({ message: 'Which tasks are overdue?' }),
		JSON.stringify(call?.body),
	);
	check(
		'Send Message sets a long timeout',
		call?.timeout === ELI_TIMEOUT_MS && ELI_TIMEOUT_MS >= 120_000,
		String(call?.timeout),
	);
	check(
		'Send Message outputs the answer as delivered',
		out[0]?.json?.response === answer.response &&
			out[0]?.json?.threadId === 'thr_1' &&
			out[0]?.pairedItem?.item === 0,
	);
}

{
	const ctx = sendMessage({
		params: [{ message: 'Group them by project.', options: { threadId: ' thr_1 ' } }],
		fetchImpl: async () => ({ ...answer, isNewThread: false }),
	});
	await scoro.execute.call(ctx);
	check(
		'a Thread ID in Options continues the conversation (trimmed)',
		ctx.calls[0]?.body?.threadId === 'thr_1',
		JSON.stringify(ctx.calls[0]?.body),
	);
}

const eliFailure = async (status, data) => {
	const ctx = sendMessage({
		params: [{ message: 'Hi' }],
		fetchImpl: async () => {
			throw httpError(status, data);
		},
	});
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		return error;
	}
	return undefined;
};

{
	const e = await eliFailure(409, {
		error: 'conflict',
		statusCode: 409,
		message: ['Already answering'],
		threadId: 'thr_9',
	});
	check(
		'409 says Eli is still answering',
		e?.message === 'Eli is still answering the same question',
		e?.message,
	);
	check('409 keeps the API body in the error details', e?.errorResponse?.threadId === 'thr_9');
}
{
	const e = await eliFailure(504, {
		error: 'timeout',
		statusCode: 504,
		message: ['No answer in time'],
	});
	check(
		'504 says Eli did not answer in time',
		e?.message === 'Eli did not answer in time' &&
			String(e?.description).includes('No answer in time'),
		e?.message,
	);
}
{
	const e = await eliFailure(403, {
		error: 'insufficient_scope',
		statusCode: 403,
		required_scope: 'ai:rw',
		message: ['Insufficient scope'],
	});
	check(
		'403 for a missing scope names the scope',
		e?.message === 'The connected Scoro app does not have the "ai:rw" scope',
		e?.message,
	);
}
{
	const e = await eliFailure(403, {
		error: 'forbidden',
		statusCode: 403,
		message: ['AI assistant is not enabled'],
	});
	check(
		'other 403 says Eli is not available',
		e?.message === 'Eli is not available for this user or site',
		e?.message,
	);
}

// --- Unknown resource / operation ------------------------------------------------------------

{
	const ctx = context({ resource: 'user', operation: 'nope', fetchImpl: async () => user });
	let caught;
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		caught = error;
	}
	check(
		'an unknown operation fails with a NodeOperationError and no request',
		caught?.constructor?.name === 'NodeOperationError' && ctx.calls.length === 0,
		caught?.message,
	);
}

console.log(
	failures === 0 ? '\nAll node harness checks passed.' : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);

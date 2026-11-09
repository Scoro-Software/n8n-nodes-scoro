#!/usr/bin/env node
/**
 * Runs the compiled Scoro node outside n8n, with a stub execution context, to check the requests
 * its operations (User → Get Me, Eli → Send Message, Custom API Call → Send Request) build and
 * the way they report errors.
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
const customCall = (overrides) =>
	context({ resource: 'customApiCall', operation: 'sendRequest', ...overrides });
/** Name/value pairs the way n8n stores a fixedCollection with `parameters` entries. */
const pairs = (obj) => ({
	parameters: Object.entries(obj).map(([name, value]) => ({ name, value })),
});
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

{
	const ctx = getMe({
		params: [{ options: { companyAccount: ' acme-uk ' } }],
		fetchImpl: async () => user,
	});
	await scoro.execute.call(ctx);
	check(
		'Get Me: Options → Company Account overrides the credential for the call',
		ctx.calls[0]?.headers?.['Scoro-Company-Account'] === 'acme-uk',
		JSON.stringify(ctx.calls[0]?.headers),
	);
}

{
	const ctx = getMe({ params: [{ options: { companyAccount: '' } }], fetchImpl: async () => user });
	await scoro.execute.call(ctx);
	check(
		'Get Me: a blank Company Account option keeps the credential value',
		ctx.calls[0]?.headers?.['Scoro-Company-Account'] === 'acme',
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

{
	const ctx = sendMessage({
		params: [{ message: 'Hi', options: { companyAccount: 'acme-uk', threadId: 'thr_1' } }],
		fetchImpl: async () => answer,
	});
	await scoro.execute.call(ctx);
	check(
		'Send Message: Company Account override and Thread ID work together',
		ctx.calls[0]?.headers?.['Scoro-Company-Account'] === 'acme-uk' &&
			ctx.calls[0]?.body?.threadId === 'thr_1',
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

// --- Custom API Call → Send Request ----------------------------------------------------------

{
	const projects = [
		{ id: 1, name: 'A' },
		{ id: 2, name: 'B' },
	];
	const ctx = customCall({
		params: [
			{
				method: 'GET',
				endpoint: ' projects ',
				queryParameters: pairs({ perPage: 2, 'filters[ids][]': 1 }),
				headers: pairs({ 'X-Trace': 'abc' }),
				options: {},
			},
		],
		fetchImpl: async () => projects,
	});
	const [out] = await scoro.execute.call(ctx);
	const call = ctx.calls[0];
	check(
		'Custom API Call builds the URL from the endpoint and query parameters',
		call?.method === 'GET' &&
			call?.url === 'https://Example.scoro.ee/api/v4/projects?perPage=2&filters%5Bids%5D%5B%5D=1',
		call?.url,
	);
	check(
		'Custom API Call sends user headers next to the defaults',
		call?.headers?.['X-Trace'] === 'abc' &&
			call?.headers?.Accept === 'application/json' &&
			call?.headers?.['Scoro-Company-Account'] === 'acme',
		JSON.stringify(call?.headers),
	);
	check('GET sends no body', !('body' in call));
	check(
		'a list response becomes one item per element, all paired to the input item',
		out.length === 2 && out[1]?.json?.name === 'B' && out[1]?.pairedItem?.item === 0,
		String(out.length),
	);
}

{
	const ctx = customCall({
		params: [
			{
				method: 'POST',
				endpoint: '/api/v4/projects',
				specifyBody: 'fields',
				bodyFields: pairs({ name: 'Website redesign', companyId: 7 }),
				options: { companyAccount: 'acme-uk' },
			},
		],
		fetchImpl: async () => ({ id: 42, name: 'Website redesign' }),
	});
	const [out] = await scoro.execute.call(ctx);
	const call = ctx.calls[0];
	check(
		'an /api/v4 prefix typed into Endpoint is not doubled',
		call?.url === 'https://Example.scoro.ee/api/v4/projects',
		call?.url,
	);
	check(
		'body fields become a JSON object',
		JSON.stringify(call?.body) === JSON.stringify({ name: 'Website redesign', companyId: 7 }),
		JSON.stringify(call?.body),
	);
	check(
		'Custom API Call: Company Account override replaces the credential value',
		call?.headers?.['Scoro-Company-Account'] === 'acme-uk',
	);
	check('an object response is a single item', out.length === 1 && out[0]?.json?.id === 42);
}

{
	const ctx = customCall({
		params: [
			{
				method: 'PATCH',
				endpoint: '/projects/42',
				specifyBody: 'json',
				jsonBody: '{"name": "Renamed", "tags": ["a", "b"]}',
				options: {},
			},
		],
		fetchImpl: async () => ({ id: 42, name: 'Renamed' }),
	});
	await scoro.execute.call(ctx);
	check(
		'a JSON body string is parsed and sent as an object',
		ctx.calls[0]?.method === 'PATCH' && ctx.calls[0]?.body?.tags?.[1] === 'b',
		JSON.stringify(ctx.calls[0]?.body),
	);
}

{
	const ctx = customCall({
		params: [{ method: 'DELETE', endpoint: '/projects/42', options: {} }],
		fetchImpl: async () => '',
	});
	const [out] = await scoro.execute.call(ctx);
	check(
		'an empty response (204) becomes { success: true }',
		out.length === 1 && out[0]?.json?.success === true && !('body' in ctx.calls[0]),
		JSON.stringify(out[0]?.json),
	);
}

{
	const ctx = customCall({
		params: [
			{
				method: 'POST',
				endpoint: '/projects',
				specifyBody: 'json',
				jsonBody: '{oops',
				options: {},
			},
		],
		fetchImpl: async () => ({}),
	});
	let caught;
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		caught = error;
	}
	check(
		'invalid JSON Body fails before any request',
		caught?.constructor?.name === 'NodeOperationError' &&
			caught?.message === 'The JSON Body is not valid JSON' &&
			ctx.calls.length === 0,
		caught?.message,
	);
}

{
	const ctx = customCall({
		params: [{ method: 'GET', endpoint: '   ', options: {} }],
		fetchImpl: async () => ({}),
	});
	let caught;
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		caught = error;
	}
	check(
		'an empty Endpoint fails before any request',
		caught?.constructor?.name === 'NodeOperationError' && ctx.calls.length === 0,
		caught?.message,
	);
}

{
	const ctx = customCall({
		params: [{ method: 'GET', endpoint: '/projects/999', options: {} }],
		fetchImpl: async () => {
			throw httpError(404, { error: 'not_found', statusCode: 404, message: ['Project not found'] });
		},
	});
	let caught;
	try {
		await scoro.execute.call(ctx);
	} catch (error) {
		caught = error;
	}
	check(
		'Custom API Call errors go through the Scoro error mapping',
		caught?.message === 'The Scoro record was not found' &&
			String(caught?.description).includes('Project not found'),
		caught?.message,
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

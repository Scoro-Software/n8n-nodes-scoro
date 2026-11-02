#!/usr/bin/env node
/**
 * Runs the compiled Scoro Trigger's webhook() handler outside n8n, with a stub context,
 * to check the HEAD probe answer and the payload mapping without a reachable n8n.
 *
 *   npm run build && node testing/scripts/trigger-harness.mjs
 *
 * The API fetch is stubbed: "Return Full Record" on returns a fake v4 record, and the
 * deleted-snapshot case must skip the fetch entirely.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { ScoroTrigger } = require(join(ROOT, 'dist', 'nodes', 'Scoro', 'ScoroTrigger.node.js'));
const fixture = JSON.parse(
	readFileSync(join(ROOT, 'testing', 'fixtures', 'webhook-task-created.json'), 'utf8'),
);

let failures = 0;
const check = (label, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures += 1;
};

function context({ webhookName, body, params, fetchImpl }) {
	const calls = [];
	return {
		calls,
		getWebhookName: () => webhookName,
		getBodyData: () => body,
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ siteUrl: 'https://Example.scoro.ee/', companyAccount: '' }),
		getNode: () => ({ name: 'Scoro Trigger', type: 'scoroTrigger' }),
		helpers: {
			httpRequestWithAuthentication: async (_type, options) => {
				calls.push(options);
				return fetchImpl(options);
			},
		},
	};
}

const trigger = new ScoroTrigger();
const base = { module: 'tasks', action: 'create', returnFullRecord: true, options: {} };

// 1. HEAD probe
{
	const ctx = context({
		webhookName: 'setup',
		body: {},
		params: base,
		fetchImpl: async () => ({}),
	});
	const result = await trigger.webhook.call(ctx);
	check(
		'HEAD probe returns an empty response (200, no workflow run)',
		result.workflowData === undefined,
	);
}

// 2. POST with Return Full Record: item is the v4 record plus webhook metadata
{
	const record = { id: 1001, name: 'Example task', status: 'task_status010' };
	const ctx = context({
		webhookName: 'default',
		body: fixture,
		params: base,
		fetchImpl: async () => record,
	});
	const result = await trigger.webhook.call(ctx);
	const item = result.workflowData?.[0]?.[0]?.json;
	check(
		'fetches the record from the v4 tasks endpoint on the site host (any Scoro domain)',
		ctx.calls[0]?.url === 'https://Example.scoro.ee/api/v4/tasks/1001',
		ctx.calls[0]?.url,
	);
	check('item carries the v4 record fields', item?.name === 'Example task');
	check(
		'item carries webhook metadata',
		item?.webhook?.entityId === 1001 &&
			item?.webhook?.module === 'tasks' &&
			item?.webhook?.action === 'create',
	);
}

// 3. POST with Return Full Record off: raw delivery plus metadata
{
	const ctx = context({
		webhookName: 'default',
		body: fixture,
		params: { ...base, returnFullRecord: false },
		fetchImpl: async () => ({}),
	});
	const result = await trigger.webhook.call(ctx);
	const item = result.workflowData?.[0]?.[0]?.json;
	check('no API call when Return Full Record is off', ctx.calls.length === 0);
	check(
		'item is the raw delivery',
		item?.entity?.event_name === fixture.entity.event_name && item?.entityId === 1001,
	);
}

// 4. Deleted snapshot: never fetched, even with "any" action
{
	const deleted = { ...fixture, entity: { ...fixture.entity, is_deleted: 1 } };
	const ctx = context({
		webhookName: 'default',
		body: deleted,
		params: { ...base, action: 'any' },
		fetchImpl: async () => ({}),
	});
	const result = await trigger.webhook.call(ctx);
	const item = result.workflowData?.[0]?.[0]?.json;
	check('deleted snapshot skips the fetch', ctx.calls.length === 0);
	check(
		'deleted item is the raw delivery',
		item?.entity?.is_deleted === 1 && item?.webhook?.action === 'any',
	);
}

// 5. Fetch failure falls back to the delivery and records the error
{
	const ctx = context({
		webhookName: 'default',
		body: fixture,
		params: base,
		fetchImpl: async () => {
			throw new Error('boom');
		},
	});
	const result = await trigger.webhook.call(ctx);
	const item = result.workflowData?.[0]?.[0]?.json;
	check(
		'fetch failure keeps the event',
		item?.entityId === 1001 && item?.webhook?.recordFetchError === 'boom',
	);
}

// 6. Module names map to API paths by convention; the Record Endpoint option overrides
{
	const ctx = context({
		webhookName: 'default',
		body: fixture,
		params: { ...base, module: 'purchaseOrders' },
		fetchImpl: async () => ({ id: 1001 }),
	});
	await trigger.webhook.call(ctx);
	check(
		'camelCase module becomes a kebab-case endpoint',
		ctx.calls[0]?.url === 'https://Example.scoro.ee/api/v4/purchase-orders/1001',
		ctx.calls[0]?.url,
	);
	const ctx2 = context({
		webhookName: 'default',
		body: fixture,
		params: { ...base, module: 'timeoff', options: { recordEndpoint: '/time-offs/{ID}' } },
		fetchImpl: async () => ({ id: 1001 }),
	});
	await trigger.webhook.call(ctx2);
	check(
		'Record Endpoint option overrides the derived path',
		ctx2.calls[0]?.url === 'https://Example.scoro.ee/api/v4/time-offs/1001',
		ctx2.calls[0]?.url,
	);
}

// 7. Non-Scoro body is acknowledged without a run
{
	const ctx = context({
		webhookName: 'default',
		body: { hello: 'world' },
		params: base,
		fetchImpl: async () => ({}),
	});
	const result = await trigger.webhook.call(ctx);
	check('unknown payload does not start the workflow', result.workflowData === undefined);
}

console.log(
	failures === 0 ? '\nAll trigger harness checks passed.' : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);

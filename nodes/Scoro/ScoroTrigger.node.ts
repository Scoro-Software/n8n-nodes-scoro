import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { scoroApiRequest } from './shared/transport';

const PAGE_SIZE = 100;

interface SubscriptionOptions {
	fields?: string;
	owners?: string;
	actors?: string;
	relationType?: string;
	bookmarkId?: number;
	recordEndpoint?: string;
}

interface ScoroWebhook extends IDataObject {
	id: number;
	module: string;
	action: string;
	url: string;
}

/** "12, me, group_3" -> [12, "me", "group_3"], the shapes the webhooks API accepts. */
function parseList(value: string | undefined): Array<number | string> {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '')
		.map((entry) => (/^\d+$/.test(entry) ? Number(entry) : entry));
}

/** The module name as typed, trimmed. */
function resolveModule(context: IHookFunctions | IWebhookFunctions): string {
	return (context.getNodeParameter('module') as string).trim();
}

/**
 * Endpoint that returns one record of a module, under /api/v4, with `{id}` for the record ID.
 * By convention the API path is the module name in kebab-case ("purchaseOrders" ->
 * "/purchase-orders/{id}"); the Record Endpoint option overrides it for modules that differ.
 */
export function recordEndpointFor(module: string, override?: string): string {
	const custom = (override ?? '').trim();
	if (custom) {
		return custom.startsWith('/') ? custom : `/${custom}`;
	}
	const kebab = module
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase();
	return `/${kebab}/{id}`;
}

/** Body of the subscription that this node registers, built from the node parameters. */
function subscriptionBody(context: IHookFunctions): IDataObject {
	const action = context.getNodeParameter('action') as string;
	const options = context.getNodeParameter('options', {}) as SubscriptionOptions;
	const body: IDataObject = { module: resolveModule(context), action };
	if (action === 'modify' && options.fields) {
		body.fields = parseList(options.fields).map(String);
	}
	if (options.owners) body.owners = parseList(options.owners);
	if (options.actors) body.actors = parseList(options.actors);
	if (options.relationType) body.relationType = options.relationType;
	if (options.relationType === 'bookmark' && options.bookmarkId) {
		body.bookmarkId = options.bookmarkId;
	}
	return body;
}

/**
 * Finds the subscription this node registered, by URL, module and action. Scoro stores the
 * "any" action as null, so the stored value is normalised before comparing.
 */
async function findSubscription(context: IHookFunctions): Promise<number | undefined> {
	const webhookUrl = context.getNodeWebhookUrl('default');
	const { module, action } = subscriptionBody(context);
	let page = 1;
	// Scoro lists are bare arrays without a total; stop on a short page.
	for (;;) {
		const webhooks = (await scoroApiRequest.call(context, 'GET', '/webhooks', undefined, {
			page,
			perPage: PAGE_SIZE,
		})) as ScoroWebhook[];
		for (const webhook of webhooks) {
			if (
				webhook.url === webhookUrl &&
				webhook.module === module &&
				(webhook.action ?? 'any') === action
			) {
				return webhook.id;
			}
		}
		if (webhooks.length < PAGE_SIZE) return undefined;
		page += 1;
	}
}

export class ScoroTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scoro Trigger',
		name: 'scoroTrigger',
		icon: { light: 'file:scoro.svg', dark: 'file:scoro.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["action"] + ": " + $parameter["module"]}}',
		description: 'Starts the workflow when a record is created, modified or deleted in Scoro',
		defaults: {
			name: 'Scoro Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scoroOAuth2Api', required: true }],
		// Order matters: the HEAD route must exist before `create` registers the URL, because
		// Scoro probes the subscription URL with a HEAD request before delivering events.
		webhooks: [
			{
				name: 'setup',
				httpMethod: 'HEAD',
				responseMode: 'onReceived',
				path: 'webhook',
				// Same URL as the POST webhook; only the POST entry is shown in the node view.
				ndvHideUrl: true,
			},
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Module',
				name: 'module',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. tasks',
				description:
					'Module to watch, as named by the Scoro webhooks API: for example tasks, projects, companies, persons, quotes, orders, invoices, bills, expenses, purchaseOrders, calendar, bookings or timeoff. Custom modules use their path. See the Webhooks section of the Scoro API v4 guide.',
			},
			{
				displayName: 'Event',
				name: 'action',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Any Change', value: 'any' },
					{ name: 'Created', value: 'create' },
					{ name: 'Deleted', value: 'delete' },
					{ name: 'Modified', value: 'modify' },
				],
				default: 'create',
				description: 'Which change to the record starts the workflow',
			},
			{
				displayName: 'Return Full Record',
				name: 'returnFullRecord',
				type: 'boolean',
				default: true,
				description:
					'Whether to fetch the current record from the API v4 (camelCase fields) instead of returning the legacy snapshot included in the webhook. The record is read from /api/v4/&lt;module in kebab-case&gt;/{ID}, or from the Record Endpoint option. Deleted records cannot be fetched and are returned as delivered.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Actors',
						name: 'actors',
						type: 'string',
						default: '',
						placeholder: 'e.g. me',
						description:
							'Only changes made by these users start the workflow: user IDs, "me", "any", or a single "group_" value followed by a user group ID. Comma-separated list.',
					},
					{
						displayName: 'Bookmark ID',
						name: 'bookmarkId',
						type: 'number',
						default: 0,
						description: 'ID of the saved list view (bookmark) that records must match',
						displayOptions: { show: { relationType: ['bookmark'] } },
					},
					{
						displayName: 'Fields',
						name: 'fields',
						type: 'string',
						default: '',
						placeholder: 'e.g. status, datetime_due',
						description:
							'Only changes to these fields start the workflow. Comma-separated list. Applies to the Modified event only.',
						displayOptions: { show: { '/action': ['modify'] } },
					},
					{
						displayName: 'Owners',
						name: 'owners',
						type: 'string',
						default: '',
						placeholder: 'e.g. me',
						description:
							'Only records owned by these users start the workflow: user IDs, "me", "any", or a single "group_" value followed by a user group ID. Comma-separated list.',
					},
					{
						displayName: 'Record Endpoint',
						name: 'recordEndpoint',
						type: 'string',
						default: '',
						placeholder: 'e.g. /time-offs/{ID}',
						description:
							'Path under /api/v4 that returns one record of the module, with {ID} standing for the record ID. Only needed when the API path differs from the module name in kebab-case, for example /time-offs/{ID} for the timeoff module.',
						displayOptions: { show: { '/returnFullRecord': [true] } },
					},
					{
						displayName: 'Relation Type',
						name: 'relationType',
						type: 'options',
						options: [
							{ name: 'Assigned To', value: 'assigned_to' },
							{ name: 'Bookmark', value: 'bookmark' },
							{ name: 'Owned By', value: 'owned_by' },
						],
						default: 'owned_by',
						description:
							'Relation between the actor and the record that must hold for the event to fire',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookId = await findSubscription(this);
				if (webhookId === undefined) return false;
				this.getWorkflowStaticData('node').webhookId = webhookId;
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const body = { ...subscriptionBody(this), url: webhookUrl };
				const response = (await scoroApiRequest.call(this, 'POST', '/webhooks', body)) as
					| ScoroWebhook
					| undefined;
				if (response?.id === undefined) {
					return false;
				}
				this.getWorkflowStaticData('node').webhookId = response.id;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				// If n8n lost the stored ID, look the subscription up so it does not orphan in Scoro.
				const webhookId = webhookData.webhookId ?? (await findSubscription(this));
				if (webhookId !== undefined) {
					try {
						await scoroApiRequest.call(this, 'DELETE', `/webhooks/${String(webhookId)}`);
					} catch (error) {
						// A subscription that is already gone counts as deleted.
						if ((error as { httpCode?: string }).httpCode !== '404') {
							return false;
						}
					}
				}
				delete webhookData.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		if (this.getWebhookName() === 'setup') {
			// HEAD probe from Scoro while the subscription is being created: answer 200, no body.
			return {};
		}

		const payload = this.getBodyData();
		if (payload.entityId === undefined) {
			// Not a Scoro delivery; acknowledge without starting the workflow.
			return {};
		}

		const module = resolveModule(this);
		const action = this.getNodeParameter('action') as string;
		const returnFullRecord = this.getNodeParameter('returnFullRecord') as boolean;
		const options = this.getNodeParameter('options', {}) as SubscriptionOptions;
		const webhook: IDataObject = {
			module,
			action,
			entityId: payload.entityId,
			entityType: payload.entityType,
			actorId: payload.actorId,
		};

		const snapshot = payload.entity as IDataObject | undefined;
		const isDeleted = action === 'delete' || Number(snapshot?.is_deleted ?? 0) === 1;
		if (returnFullRecord && !isDeleted) {
			const path = recordEndpointFor(module, options.recordEndpoint).replace(
				/\{id\}/i,
				encodeURIComponent(String(payload.entityId)),
			);
			try {
				const record = (await scoroApiRequest.call(this, 'GET', path)) as IDataObject;
				return { workflowData: [[{ json: { ...record, webhook } }]] };
			} catch (error) {
				// Fall back to the delivered snapshot rather than losing the event.
				webhook.recordFetchError = (error as Error).message;
			}
		}

		return { workflowData: [[{ json: { ...payload, webhook } }]] };
	}
}

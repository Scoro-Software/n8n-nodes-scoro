import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	CREDENTIAL_NAME,
	scoroApiRequest,
	toOutputObjects,
	type ScoroRequestOptions,
	type StatusMessage,
} from './shared/transport';

/**
 * Eli answers synchronously and "can take a minute or more" (API reference), so the request gets
 * an explicit timeout; n8n's request helper applies none on its own.
 */
export const ELI_TIMEOUT_MS = 300_000;

/** Error texts for the statuses POST /api/v4/ai/messages documents beyond the generic ones. */
export const ELI_ERROR_MESSAGES: Partial<Record<number, StatusMessage>> = {
	403: {
		message: 'Eli is not available for this user or site',
		description:
			'The Scoro AI assistant must be enabled for the site and for the user who connected the credential.',
	},
	409: {
		message: 'Eli is still answering the same question',
		description:
			'Do not retry. Continue the conversation named in the error details to read the answer.',
	},
	502: {
		message: 'The Scoro AI assistant could not be reached',
		description: 'The request can be retried.',
	},
	504: {
		message: 'Eli did not answer in time',
		description:
			'The question is stored in the conversation named in the error details. Ask again in that conversation to get the answer.',
	},
};

/**
 * HTTP methods offered by Custom API Call: every method n8n's request helper supports. The API v4
 * itself uses GET, POST, PATCH and DELETE.
 */
const HTTP_METHODS: IHttpRequestMethods[] = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'];

/** Methods for which Custom API Call shows the body fields. */
const METHODS_WITH_BODY = ['PATCH', 'POST', 'PUT'];

/** A name/value pair from one of the fixed collections (query parameters, headers, body fields). */
interface NameValue {
	name: string;
	value: unknown;
}

/** Shape of the `parameters`-style fixed collections: `{ <collectionName>: NameValue[] }`. */
type NameValueCollection = Record<string, NameValue[] | undefined>;

/**
 * Normalises what the user typed into the Endpoint field into a path under /api/v4: whitespace
 * trimmed, an accidental `/api/v4` prefix removed, a leading slash guaranteed.
 */
export function normalizeEndpoint(endpoint: string): string {
	let path = endpoint.trim().replace(/^\/?api\/v4(?=\/|$)/i, '');
	if (!path.startsWith('/')) path = `/${path}`;
	return path;
}

/** Builds a query string from name/value pairs; repeated names (`filters[ids][]`) are kept. */
export function buildQueryString(pairs: NameValue[]): string {
	const encode = (value: unknown) =>
		encodeURIComponent(
			value === null || value === undefined
				? ''
				: typeof value === 'object'
					? JSON.stringify(value)
					: String(value),
		);
	return pairs
		.filter((pair) => pair.name.trim() !== '')
		.map((pair) => `${encodeURIComponent(pair.name.trim())}=${encode(pair.value)}`)
		.join('&');
}

/** The Company Account override shared by every operation, inside its Options collection. */
const companyAccountOption: INodeProperties = {
	displayName: 'Company Account',
	name: 'companyAccount',
	type: 'string',
	default: '',
	placeholder: 'e.g. acme-uk',
	description:
		'Company account to work in for this call, sent as the Scoro-Company-Account header. Overrides the Company Account of the credential; leave empty to use that one. Identifiers are listed under accounts in the output of User → Get Me.',
};

/** Name/value pairs the way the HTTP Request node collects them. */
function nameValueCollection(
	displayName: string,
	name: string,
	collectionName: string,
	entryName: string,
	placeholder: string,
	valuePlaceholder: string,
	methods?: string[],
): INodeProperties {
	return {
		displayName,
		name,
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		placeholder,
		default: {},
		displayOptions: {
			show: {
				resource: ['customApiCall'],
				operation: ['sendRequest'],
				...(methods ? { method: methods } : {}),
			},
		},
		options: [
			{
				displayName: entryName,
				name: collectionName,
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						placeholder: valuePlaceholder,
					},
				],
			},
		],
	};
}

/**
 * The Scoro node. One resource per thing the package does out of the box, plus an escape hatch:
 *
 * - **User → Get Me**: GET /api/v4/users/me, the user the credential is connected as, with the
 *   company accounts, enabled permissions and site settings a workflow needs before calling
 *   other endpoints.
 * - **Eli → Send Message**: POST /api/v4/ai/messages. Eli is the Scoro AI agent and can do pretty
 *   much anything in the Scoro environment that the connected user could do: answer questions,
 *   look up and reason over data across modules, and carry out work, from a natural-language
 *   message. Each call either starts a new conversation or continues the one named by Thread ID
 *   with its full history.
 * - **Custom API Call → Send Request**: any method and path under /api/v4, with query
 *   parameters, headers and a body, for the endpoints the node has no operation for.
 *
 * Every operation can override the credential's company account for the call.
 */
export class Scoro implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scoro',
		name: 'scoro',
		icon: { light: 'file:scoro.svg', dark: 'file:scoro.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Reads the connected Scoro user, sends messages to Eli, the Scoro AI agent that can do pretty much anything in your Scoro environment that you could do yourself, and calls any other Scoro API v4 endpoint',
		defaults: {
			name: 'Scoro',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: CREDENTIAL_NAME,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Custom API Call',
						value: 'customApiCall',
						description:
							'Any Scoro API v4 endpoint, with the method, path, query, headers and body you choose',
					},
					{
						name: 'Eli',
						value: 'eli',
						description:
							'The Scoro AI agent. Eli can answer questions, look up and reason over data across modules, and carry out work on your behalf.',
					},
					{
						name: 'User',
						value: 'user',
						description: 'The Scoro user the credential is connected as',
					},
				],
				default: 'eli',
			},

			// ----------------------------------------------------------------------------------
			// Custom API Call
			// ----------------------------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['customApiCall'],
					},
				},
				options: [
					{
						name: 'Send Request',
						value: 'sendRequest',
						description: 'Send a request to any Scoro API v4 endpoint and return the response',
						action: 'Send a custom API request',
					},
				],
				default: 'sendRequest',
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				required: true,
				options: HTTP_METHODS.map((method) => ({ name: method, value: method })),
				default: 'GET',
				description:
					'HTTP method of the request. The Scoro API v4 uses GET, POST, PATCH and DELETE.',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						operation: ['sendRequest'],
					},
				},
			},
			{
				displayName: 'Endpoint',
				name: 'endpoint',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. /projects/123',
				description:
					'Path of the endpoint under /api/v4 of your site, as listed in the Scoro API v4 reference (https://api.scoro.com/api/v4/reference). The site comes from the credential.',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						operation: ['sendRequest'],
					},
				},
			},
			nameValueCollection(
				'Query Parameters',
				'queryParameters',
				'parameters',
				'Parameter',
				'Add Parameter',
				'e.g. 50',
			),
			nameValueCollection(
				'Headers',
				'headers',
				'parameters',
				'Header',
				'Add Header',
				'e.g. application/json',
			),
			{
				displayName: 'Specify Body',
				name: 'specifyBody',
				type: 'options',
				options: [
					{
						name: 'Using Fields Below',
						value: 'fields',
					},
					{
						name: 'Using JSON',
						value: 'json',
					},
				],
				default: 'fields',
				description: 'How the request body is given. It is sent as JSON either way.',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						operation: ['sendRequest'],
						method: METHODS_WITH_BODY,
					},
				},
			},
			nameValueCollection(
				'Body Fields',
				'bodyFields',
				'parameters',
				'Field',
				'Add Field',
				'e.g. Website redesign',
				METHODS_WITH_BODY,
			),
			{
				displayName: 'JSON Body',
				name: 'jsonBody',
				type: 'json',
				required: true,
				default: '{}',
				description: 'Body of the request as a JSON object or array',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						operation: ['sendRequest'],
						method: METHODS_WITH_BODY,
						specifyBody: ['json'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						operation: ['sendRequest'],
					},
				},
				options: [companyAccountOption],
			},

			// ----------------------------------------------------------------------------------
			// Eli
			// ----------------------------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['eli'],
					},
				},
				options: [
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a message to Eli and return its answer',
						action: 'Send a message',
					},
				],
				default: 'sendMessage',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				required: true,
				default: '',
				typeOptions: {
					rows: 4,
				},
				placeholder: 'e.g. Which projects are over budget this month?',
				description:
					"What Eli should answer or do, in natural language (up to 10,000 characters). Eli acts as the user who connected the credential, within that user's permissions.",
				displayOptions: {
					show: {
						resource: ['eli'],
						operation: ['sendMessage'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['eli'],
						operation: ['sendMessage'],
					},
				},
				options: [
					companyAccountOption,
					{
						displayName: 'Thread ID',
						name: 'threadId',
						type: 'string',
						default: '',
						description:
							'Conversation to continue, taken from the threadId of a previous answer. Leave empty to start a new conversation.',
					},
				],
			},

			// ----------------------------------------------------------------------------------
			// User
			// ----------------------------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['user'],
					},
				},
				options: [
					{
						name: 'Get Me',
						value: 'getMe',
						description:
							'Get the user the credential is connected as, with the company accounts, permissions and site settings',
						action: 'Get the current user',
					},
				],
				default: 'getMe',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['getMe'],
					},
				},
				options: [companyAccountOption],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const pairsOf = (name: string, i: number): NameValue[] => {
			const collection = this.getNodeParameter(name, i, {}) as NameValueCollection;
			return (collection.parameters ?? []).filter(
				(pair): pair is NameValue => typeof pair?.name === 'string',
			);
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const companyAccount =
					typeof options.companyAccount === 'string' ? options.companyAccount : undefined;
				let results: IDataObject[];

				if (resource === 'user' && operation === 'getMe') {
					const user = await scoroApiRequest.call(this, 'GET', '/users/me', undefined, {
						companyAccount,
					});
					results = [user as IDataObject];
				} else if (resource === 'eli' && operation === 'sendMessage') {
					const message = this.getNodeParameter('message', i) as string;
					const threadId = typeof options.threadId === 'string' ? options.threadId.trim() : '';
					const body: IDataObject = { message };
					if (threadId) body.threadId = threadId;

					const answer = await scoroApiRequest.call(this, 'POST', '/ai/messages', body, {
						companyAccount,
						timeout: ELI_TIMEOUT_MS,
						errorMessages: ELI_ERROR_MESSAGES,
					});
					results = [answer as IDataObject];
				} else if (resource === 'customApiCall' && operation === 'sendRequest') {
					const method = this.getNodeParameter('method', i) as IHttpRequestMethods;
					const endpoint = this.getNodeParameter('endpoint', i) as string;
					if (!endpoint.trim()) {
						throw new NodeOperationError(this.getNode(), 'The Endpoint field is empty', {
							itemIndex: i,
							description: 'Enter the path of a Scoro API v4 endpoint, for example /projects.',
						});
					}
					const query = buildQueryString(pairsOf('queryParameters', i));
					const path = `${normalizeEndpoint(endpoint)}${query ? `?${query}` : ''}`;

					const headers: IDataObject = {};
					for (const pair of pairsOf('headers', i)) {
						if (pair.name.trim()) headers[pair.name.trim()] = pair.value as IDataObject[string];
					}

					let body: IDataObject | undefined;
					if (METHODS_WITH_BODY.includes(method)) {
						const specifyBody = this.getNodeParameter('specifyBody', i, 'fields') as string;
						if (specifyBody === 'json') {
							body = parseJsonBody(this.getNodeParameter('jsonBody', i, '{}'), this, i);
						} else {
							body = {};
							for (const pair of pairsOf('bodyFields', i)) {
								if (pair.name.trim()) body[pair.name.trim()] = pair.value as IDataObject[string];
							}
						}
					}

					const requestOptions: ScoroRequestOptions = { headers, companyAccount };
					const response = await scoroApiRequest.call(this, method, path, body, requestOptions);
					results = toOutputObjects(response);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for the resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				for (const json of results) {
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				const failure =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw failure;
			}
		}

		return [returnData];
	}
}

/** The JSON Body field: a string to parse, or already an object when an expression produced one. */
function parseJsonBody(value: unknown, context: IExecuteFunctions, itemIndex: number): IDataObject {
	if (value !== null && typeof value === 'object') return value as IDataObject;
	const text = typeof value === 'string' ? value.trim() : '';
	if (text === '') return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), 'The JSON Body is not valid JSON', {
			itemIndex,
			description: (error as Error).message,
		});
	}
	if (parsed === null || typeof parsed !== 'object') {
		throw new NodeOperationError(context.getNode(), 'The JSON Body must be an object or an array', {
			itemIndex,
		});
	}
	return parsed as IDataObject;
}

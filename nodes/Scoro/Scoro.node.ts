import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CREDENTIAL_NAME, scoroApiRequest, type StatusMessage } from './shared/transport';

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
 * The Scoro node. One resource per thing the package does out of the box:
 *
 * - **User → Get Me**: GET /api/v4/users/me, the user the credential is connected as, with the
 *   company accounts, enabled permissions and site settings a workflow needs before calling
 *   other endpoints.
 * - **Eli → Send Message**: POST /api/v4/ai/messages. Eli is the Scoro AI agent and can do pretty
 *   much anything in the Scoro environment that the connected user could do: answer questions,
 *   look up and reason over data across modules, and carry out work, from a natural-language
 *   message. Each call either starts a new conversation or continues the one named by Thread ID
 *   with its full history.
 *
 * Everything else in the API is reachable through the HTTP Request node with the Scoro OAuth2
 * credential.
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
			'Reads the connected Scoro user and sends messages to Eli, the Scoro AI agent that can do pretty much anything in your Scoro environment that you could do yourself',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let result: IDataObject;

				if (resource === 'user' && operation === 'getMe') {
					result = (await scoroApiRequest.call(this, 'GET', '/users/me')) as IDataObject;
				} else if (resource === 'eli' && operation === 'sendMessage') {
					const message = this.getNodeParameter('message', i) as string;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const threadId = typeof options.threadId === 'string' ? options.threadId.trim() : '';
					const body: IDataObject = { message };
					if (threadId) body.threadId = threadId;

					result = (await scoroApiRequest.call(this, 'POST', '/ai/messages', body, {
						timeout: ELI_TIMEOUT_MS,
						errorMessages: ELI_ERROR_MESSAGES,
					})) as IDataObject;
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for the resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				returnData.push({ json: result, pairedItem: { item: i } });
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

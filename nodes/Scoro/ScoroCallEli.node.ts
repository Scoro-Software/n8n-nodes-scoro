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
 * The assistant answers synchronously and "can take a minute or more" (API reference), so the
 * request gets an explicit timeout; n8n's request helper applies none on its own.
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
 * Hands a message to Eli, the Scoro AI agent: POST /api/v4/ai/messages. Eli can do pretty much
 * anything in the Scoro environment that the connected user could do: answer questions, look up and
 * reason over data across modules, and carry out work, all from a natural-language message. Each
 * call either starts a new conversation or continues the one named by Thread ID with its full
 * history.
 */
export class ScoroCallEli implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scoro Call Eli',
		name: 'scoroCallEli',
		icon: { light: 'file:scoro.svg', dark: 'file:scoro.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["threadId"] ? "Continue conversation" : "New conversation" }}',
		description:
			'Sends a message to Eli, the Scoro AI agent, and returns its answer. Eli can do pretty much anything in your Scoro environment that you could do yourself: answer questions, look up and reason over data across modules, and carry out work on your behalf, from a natural-language message.',
		defaults: {
			name: 'Scoro Call Eli',
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
					'What Eli should answer or do, in natural language (up to 10,000 characters). Eli acts as the user who connected the credential, within that user\'s permissions.',
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				description:
					'Conversation to continue, taken from the threadId of a previous answer. Leave empty to start a new conversation.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const message = this.getNodeParameter('message', i) as string;
				const threadId = (this.getNodeParameter('threadId', i, '') as string).trim();
				const body: IDataObject = { message };
				if (threadId) body.threadId = threadId;

				const answer = (await scoroApiRequest.call(this, 'POST', '/ai/messages', body, {
					timeout: ELI_TIMEOUT_MS,
					errorMessages: ELI_ERROR_MESSAGES,
				})) as IDataObject;
				returnData.push({ json: answer, pairedItem: { item: i } });
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

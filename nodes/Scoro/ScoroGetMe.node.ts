import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CREDENTIAL_NAME, scoroApiRequest } from './shared/transport';

/**
 * Returns the Scoro user the credential is connected as: GET /api/v4/users/me. The answer
 * includes the company accounts the user can work in, the enabled permissions and the site's
 * base currency and formats, which is what a workflow needs before calling other endpoints.
 */
export class ScoroGetMe implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scoro Get Me',
		name: 'scoroGetMe',
		icon: { light: 'file:scoro.svg', dark: 'file:scoro.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: 'Current user',
		description:
			'Returns the Scoro user the credential is connected as, with the company accounts, permissions and site settings',
		defaults: {
			name: 'Scoro Get Me',
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
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const user = (await scoroApiRequest.call(this, 'GET', '/users/me')) as IDataObject;
				returnData.push({ json: user, pairedItem: { item: i } });
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

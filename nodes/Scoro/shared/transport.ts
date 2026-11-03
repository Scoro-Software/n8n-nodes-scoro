import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'scoroOAuth2Api';

interface ScoroCredentials {
	siteUrl: string;
	companyAccount?: string;
}

type ApiContext = IExecuteFunctions | ILoadOptionsFunctions;

/** Error text shown for one HTTP status, replacing the generic text of `toScoroError`. */
export interface StatusMessage {
	message: string;
	description?: string;
}

export interface ScoroRequestOptions {
	/** Query string parameters. */
	qs?: IDataObject;
	/** Request timeout in milliseconds. n8n applies no timeout when this is unset. */
	timeout?: number;
	/** Endpoint-specific error texts by HTTP status. */
	errorMessages?: Partial<Record<number, StatusMessage>>;
}

/** Host of a Scoro site from the Site URL field: protocol, path and whitespace are ignored. */
export function siteHost(siteUrl: string): string {
	const withoutProtocol = siteUrl.trim().replace(/^[a-z]+:\/\//i, '');
	return withoutProtocol.split('/')[0];
}

/** Base URL of the API v4 for a Scoro site, on any Scoro domain (scoro.com, scoro.ee, ...). */
export function apiBaseUrl(siteUrl: string): string {
	return `https://${siteHost(siteUrl)}/api/v4`;
}

/**
 * Makes an authenticated request to the Scoro API v4 with the Scoro OAuth2 credential.
 * Sends the `Scoro-Company-Account` header when the credential names a company account
 * (multi-entity sites); an empty value must not produce an empty header.
 */
export async function scoroApiRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	requestOptions: ScoroRequestOptions = {},
): Promise<unknown> {
	const credentials = (await this.getCredentials(CREDENTIAL_NAME)) as unknown as ScoroCredentials;
	const headers: IDataObject = { Accept: 'application/json' };
	const companyAccount = credentials.companyAccount?.trim();
	if (companyAccount) {
		headers['Scoro-Company-Account'] = companyAccount;
	}
	const options: IHttpRequestOptions = {
		method,
		url: `${apiBaseUrl(credentials.siteUrl)}${path}`,
		headers,
	};
	if (body !== undefined) options.body = body;
	if (requestOptions.qs !== undefined) options.qs = requestOptions.qs;
	if (requestOptions.timeout !== undefined) options.timeout = requestOptions.timeout;
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, options);
	} catch (error) {
		throw toScoroError(this.getNode(), error, requestOptions.errorMessages);
	}
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

interface HttpErrorDetails {
	status?: number;
	body?: unknown;
	headers?: Record<string, unknown>;
}

interface ErrorLike {
	cause?: unknown;
	httpCode?: string | null;
	response?: unknown;
	context?: { data?: unknown };
}

interface ResponseLike {
	status?: number;
	data?: unknown;
	headers?: Record<string, unknown>;
}

function extractDetails(error: unknown): HttpErrorDetails | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const e = error as ErrorLike;
	for (const candidate of [e, e.cause]) {
		const response = (candidate as ErrorLike | undefined)?.response as ResponseLike | undefined;
		if (response && typeof response === 'object' && typeof response.status === 'number') {
			return { status: response.status, body: response.data, headers: response.headers };
		}
	}
	if (e.httpCode) {
		return { status: Number(e.httpCode), body: e.context?.data };
	}
	return undefined;
}

/** Collects the human-readable messages out of the different error shapes Scoro returns. */
function messagesFrom(body: unknown): string[] {
	if (typeof body === 'string') return body.trim() ? [body.trim()] : [];
	if (!body || typeof body !== 'object') return [];
	const b = body as IDataObject;
	const messages: string[] = [];
	const push = (value: unknown) => {
		if (Array.isArray(value)) value.forEach(push);
		else if (typeof value === 'string' && value.trim()) messages.push(value.trim());
	};
	push(b.message);
	push(b.error_description);
	const nested = b.messages as IDataObject | undefined;
	if (nested && typeof nested === 'object') push(nested.error);
	return messages;
}

/**
 * Turns an error thrown by an HTTP request to Scoro into a NodeApiError whose message says
 * what went wrong and what to do about it. Non-HTTP errors are returned unchanged.
 * `errorMessages` replaces the generic text for the statuses it names, except for a 403 that
 * reports a missing scope, which always names the scope.
 */
export function toScoroError(
	node: INode,
	error: unknown,
	errorMessages: Partial<Record<number, StatusMessage>> = {},
): Error {
	// Errors mapped once must not be mapped again.
	if (error instanceof NodeApiError && error.context?.scoroMapped === true) {
		return error;
	}
	const details = extractDetails(error);
	if (!details?.status) {
		return error as Error;
	}
	const { status, body, headers } = details;
	const b = (body && typeof body === 'object' ? body : {}) as IDataObject;
	const messages = messagesFrom(body);
	const errorName = typeof b.error === 'string' ? b.error : undefined;
	const detail = messages.join(' ');
	const missingScope = status === 403 && errorName === 'insufficient_scope';

	let message: string;
	let description = detail || undefined;
	switch (status) {
		case 400:
			message = 'Scoro rejected the request as invalid';
			break;
		case 401:
			message = 'Scoro did not accept the authentication';
			description = `${detail ? `${detail}. ` : ''}Reconnect the Scoro OAuth2 credential. If the site restricts API access by IP address, make sure the n8n host is on its allow-list.`;
			break;
		case 403:
			if (missingScope) {
				const scope = typeof b.required_scope === 'string' ? b.required_scope : 'the required';
				message = `The connected Scoro app does not have the "${scope}" scope`;
				description =
					'Add the scope under "Manage access" of the app in the Scoro Developer Portal, add it to the Scope field of the credential, then reconnect the credential so a new token is issued.';
			} else {
				message = 'Scoro denied access';
				description = `${detail ? `${detail}. ` : ''}The user who connected the credential may lack the module or permission, or the company account is not accessible.`;
			}
			break;
		case 404:
			message = 'The Scoro record was not found';
			break;
		case 409:
			message = 'The request conflicts with the current state of the record in Scoro';
			break;
		case 429: {
			const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
			message = 'Scoro rate limit exceeded';
			description = `${retryAfter ? `Retry after ${String(retryAfter)} seconds. ` : ''}Space out requests to Scoro.`;
			break;
		}
		default:
			message = status >= 500 ? `Scoro API error (${status})` : `Scoro returned HTTP ${status}`;
			if (status >= 500 && !description) {
				description = 'The request can be retried.';
			}
	}
	const override = errorMessages[status];
	if (override && !missingScope) {
		message = override.message;
		if (override.description) {
			description = `${override.description}${detail ? ` (${detail})` : ''}`;
		}
	}
	if (description && errorName && !description.includes(errorName) && status !== 403) {
		description = `${description} (${errorName})`;
	} else if (!description && errorName) {
		description = errorName;
	}

	// The full error body stays available under the error details (for example the
	// conversation a 409 or 504 from the AI assistant refers to).
	const errorResponse = { ...b, message: detail, error: errorName } as JsonObject;
	const mapped = new NodeApiError(node, errorResponse, {
		message,
		description,
		httpCode: String(status),
	});
	mapped.context.scoroMapped = true;
	return mapped;
}

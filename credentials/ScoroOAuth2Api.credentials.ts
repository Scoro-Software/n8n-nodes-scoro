import type { ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

/**
 * Scopes requested for every connection.
 *
 * Read/write/delete on the core resources so the credential is useful from the HTTP Request
 * node, read on every module the Scoro Trigger can fetch a record for (its "Return Full
 * Record" option), and `webhooks:rwd` for the trigger's subscriptions. Scope names are the
 * ones the Scoro API v4 schema lists in each operation's `security` entry; `contacts:*` covers
 * companies and persons, `tasks:*` covers time entries, and `base:r` (reference data such as
 * statuses and `/users/me`) is granted automatically. `offline_access` is required to receive
 * a refresh token.
 *
 * A token can never hold more scopes than the Developer Portal app allows, so the app's
 * "Manage access" list must include at least these. Changing this list requires users to
 * reconnect the credential.
 */
const SCOPES = [
	'offline_access',
	'projects:rwd',
	'tasks:rwd',
	'contacts:rwd',
	'quotes:rwd',
	'orders:rwd',
	'invoices:rwd',
	'products:rwd',
	'webhooks:rwd',
	'bills:r',
	'bookings:r',
	'calendar:r',
	'expenses:r',
	'prepayments:r',
	'purchase-orders:r',
	'time-offs:r',
];

export class ScoroOAuth2Api implements ICredentialType {
	name = 'scoroOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Scoro OAuth2 API';

	icon: Icon = {
		light: 'file:../nodes/Scoro/scoro.svg',
		dark: 'file:../nodes/Scoro/scoro.dark.svg',
	};

	documentationUrl = 'https://github.com/Scoro-Software/n8n-nodes-scoro#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Site URL',
			name: 'siteUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. https://mycompany.scoro.com',
			description:
				'The address of your Scoro site, for example https://mycompany.scoro.com or https://mycompany.scoro.ee. The site must be listed under Site URLs of the Developer Portal app.',
		},
		{
			displayName: 'Company Account',
			name: 'companyAccount',
			type: 'string',
			default: '',
			placeholder: 'e.g. mycompany',
			description:
				'Optional. On a Scoro site with several company accounts (business entities), the identifier of the account to work in. Leave empty to use your default account. Identifiers are listed under "accounts" in GET /users/me.',
		},
		// Scoro Developer Portal apps use the authorization code grant with PKCE and
		// always have a client secret. n8n's "pkce" grant type adds the S256 code
		// challenge to the authorization request and still sends the client
		// credentials, so both requirements are met.
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		// OAuth endpoints live on the customer's own Scoro site, whatever its domain
		// (scoro.com, scoro.ee, scoro.lv, scoro.lt, ...). Only the host of the Site URL is used.
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default:
				'=https://{{ $self["siteUrl"].trim().split("://").pop().split("/")[0] }}/auth/oauth/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default:
				'=https://{{ $self["siteUrl"].trim().split("://").pop().split("/")[0] }}/auth/oauth/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: SCOPES.join(' '),
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		// Scoro documents client_id and client_secret as form fields of the token
		// request, so send them in the body rather than as a Basic auth header.
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];
}

import type { ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

/**
 * Default value of the editable Scope field.
 *
 * `ai:rw` for the Eli resource of the Scoro node (User → Get Me only needs `base:r`, which is
 * granted automatically), read/write/delete on the core resources so the credential is useful
 * from the HTTP Request node, and read on the remaining modules. Scope names are the ones the Scoro API
 * v4 schema lists in each operation's `security` entry; `contacts:*` covers companies and
 * persons, `tasks:*` covers time entries, and `base:r` (reference data such as statuses and
 * `/users/me`) is granted automatically. `offline_access` is required to receive a refresh token.
 *
 * A token can never hold more scopes than the Developer Portal app allows. Users edit the list
 * in the credential; changing it requires reconnecting.
 */
const DEFAULT_SCOPES = [
	'offline_access',
	'ai:rw',
	'projects:rwd',
	'tasks:rwd',
	'contacts:rwd',
	'quotes:rwd',
	'orders:rwd',
	'invoices:rwd',
	'products:rwd',
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
		{
			displayName: 'Scope',
			name: 'scopes',
			type: 'string',
			default: DEFAULT_SCOPES.join(' '),
			description:
				'Space-separated scopes to request, as named in the Scoro API v4 reference ("resource:r", ":rw" or ":rwd"). Keep "offline_access" so the token can be refreshed. The Developer Portal app must allow every scope listed here; changing the list requires reconnecting.',
			hint: 'Copy the list from your app in the Scoro Developer Portal (developers.scoro.com): open the app, Manage access, Copy scopes. Keep offline_access.',
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
		// n8n ignores a user-edited "scope" on credentials that extend oAuth2Api and re-applies
		// this default when building the authorization request, so the default reads the
		// editable Scope field above instead of holding a fixed list.
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '={{ $self["scopes"] }}',
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

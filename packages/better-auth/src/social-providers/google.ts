import { betterFetch } from "@better-fetch/fetch";
import { decodeJwt } from "jose";
import { BetterAuthError } from "../error";
import type { OAuthProvider, ProviderOptions } from "../oauth2";
import { createAuthorizationURL, validateAuthorizationCode } from "../oauth2";
import { logger } from "../utils/logger";
import { refreshAccessToken } from "../oauth2/refresh-access-token";

export interface GoogleProfile {
	aud: string;
	azp: string;
	email: string;
	email_verified: boolean;
	exp: number;
	/**
	 * The family name of the user, or last name in most
	 * Western languages.
	 */
	family_name: string;
	/**
	 * The given name of the user, or first name in most
	 * Western languages.
	 */
	given_name: string;
	hd?: string;
	iat: number;
	iss: string;
	jti?: string;
	locale?: string;
	name: string;
	nbf?: number;
	picture: string;
	sub: string;
}

export interface GoogleOptions extends ProviderOptions<GoogleProfile> {
	/**
	 * The access type to use for the authorization code request
	 */
	accessType?: "offline" | "online";
	/**
	 * The display mode to use for the authorization code request
	 */
	display?: "page" | "popup" | "touch" | "wap";
	/**
	 * The hosted domain of the user
	 */
	hd?: string;
}

export const google = (options: GoogleOptions) => {
	return {
		id: "google",
		name: "Google",
		async createAuthorizationURL({
			state,
			scopes,
			codeVerifier,
			redirectURI,
			loginHint,
			display,
		}) {
			if (!options.clientId || !options.clientSecret) {
				logger.error(
					"Client Id and Client Secret is required for Google. Make sure to provide them in the options.",
				);
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) {
				throw new BetterAuthError("codeVerifier is required for Google");
			}
			const _scopes = options.disableDefaultScope
				? []
				: ["email", "profile", "openid"];
			options.scope && _scopes.push(...options.scope);
			scopes && _scopes.push(...scopes);

			// Get the first client ID if an array is provided
			const clientId = Array.isArray(options.clientId) ? options.clientId[0] : options.clientId;

			const url = await createAuthorizationURL({
				id: "google",
				options: {
					...options,
					clientId, // Pass the selected client ID
				},
				authorizationEndpoint: "https://accounts.google.com/o/oauth2/auth",
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI,
				prompt: options.prompt,
				accessType: options.accessType,
				display: display || options.display,
				loginHint,
				hd: options.hd,
				additionalParams: {
					include_granted_scopes: "true",
				},
			});
			return url;
		},
		validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				codeVerifier,
				redirectURI,
				options,
				tokenEndpoint: "https://oauth2.googleapis.com/token",
			});
		},
		refreshAccessToken: options.refreshAccessToken
			? options.refreshAccessToken
			: async (refreshToken) => {
					return refreshAccessToken({
						refreshToken,
						options: {
							clientId: Array.isArray(options.clientId) ? options.clientId[0] : options.clientId,
							clientKey: options.clientKey,
							clientSecret: options.clientSecret,
						},
						tokenEndpoint: "https://www.googleapis.com/oauth2/v4/token",
					});
				},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) {
				return false;
			}
			if (options.verifyIdToken) {
				return options.verifyIdToken(token, nonce);
			}
			const googlePublicKeyUrl = `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`;
			const { data: tokenInfo } = await betterFetch<{
				aud: string;
				iss: string;
				email: string;
				email_verified: boolean;
				name: string;
				picture: string;
				sub: string;
			}>(googlePublicKeyUrl);
			if (!tokenInfo) {
				return false;
			}

			// Check if the audience matches any of the client IDs
			const clientIds = Array.isArray(options.clientId) ? options.clientId : [options.clientId];
			const isValidAudience = clientIds.includes(tokenInfo.aud);

			const isValid =
				isValidAudience &&
				(tokenInfo.iss === "https://accounts.google.com" ||
					tokenInfo.iss === "accounts.google.com");
			return isValid;
		},
		async getUserInfo(token) {
			if (options.getUserInfo) {
				return options.getUserInfo(token);
			}
			if (!token.idToken) {
				return null;
			}
			const user = decodeJwt(token.idToken) as GoogleProfile;
			const userMap = await options.mapProfileToUser?.(user);
			return {
				user: {
					id: user.sub,
					name: user.name,
					email: user.email,
					image: user.picture,
					emailVerified: user.email_verified,
					...userMap,
				},
				data: user,
			};
		},
		options,
	} satisfies OAuthProvider<GoogleProfile>;
};

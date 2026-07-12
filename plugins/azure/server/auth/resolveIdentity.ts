import type { JwtPayload } from "jsonwebtoken";
import { parseEmail } from "@shared/utils/email";
import { MicrosoftGraphError } from "@server/errors";

/** The identity fields returned by the Microsoft Graph user endpoint. */
export interface AzureGraphProfile {
  mail?: string | null;
  userPrincipalName?: string | null;
}

interface AzureIdentity {
  email: string;
  emailVerified?: boolean;
  domain: string;
}

/**
 * Resolves the contact email and authentication domain for an Azure identity.
 * The directory mail attribute is preferred for user communication, while the
 * UPN is preferred for workspace domain authorization.
 *
 * @param profile The decoded Azure ID token.
 * @param graphProfile The user profile returned by Microsoft Graph.
 * @returns The resolved email, verification status, and authentication domain.
 * @throws MicrosoftGraphError if no usable email identity is available.
 */
export function resolveAzureIdentity(
  profile: JwtPayload,
  graphProfile: AzureGraphProfile
): AzureIdentity {
  const tokenEmail =
    typeof profile.email === "string" ? profile.email : undefined;
  const email =
    graphProfile.mail || tokenEmail || graphProfile.userPrincipalName;

  if (!email) {
    throw MicrosoftGraphError(
      "'email' property is required but could not be found in user profile."
    );
  }

  const directoryEmails = [
    graphProfile.mail,
    graphProfile.userPrincipalName,
  ].filter((value): value is string => Boolean(value));
  const verificationClaims = [profile.xms_edov, profile.email_verified].filter(
    (claim) => claim !== undefined
  );
  const emailVerified =
    directoryEmails.some(
      (directoryEmail) => directoryEmail.toLowerCase() === email.toLowerCase()
    ) ||
    (verificationClaims.length
      ? verificationClaims.some((claim) => claim === true || claim === "true")
      : undefined);

  const domain = parseEmail(graphProfile.userPrincipalName || email).domain;

  return {
    email,
    emailVerified,
    domain,
  };
}

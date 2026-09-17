// Every sentence the service hands to a person lives here, so the wording can
// be read and changed in one place. `providerName` is the provider module's
// `displayName`, for example "Stripe".

export const messages = {
  signupRateLimited: (minutes: number) =>
    `Too many sign-ups from this network. Try again in ${minutes} ${
      minutes === 1 ? "minute" : "minutes"
    }.`,

  signupDailyCap:
    "Sign-ups are closed for today because the daily limit was reached. Try again after midnight UTC.",

  providerAccountMismatch: (providerName: string) =>
    `This firm key is tied to the ${providerName} account its first link used, and these keys belong to another account. Use the first account's keys, or sign up for a second firm key for this account.`,

  providerIdentifyFailed: (providerName: string) =>
    `We could not check which ${providerName} account these keys belong to. Check that the key is right.`,

  // The line under the firm's name on a client's link page.
  verifiedLine: (providerName: string, verifiedName: string) =>
    `Their ${providerName} account is registered to ${verifiedName}.`,
};

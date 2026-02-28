"use client";

import { useState, useCallback, useRef } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";

interface AccountResult {
  provider_account_id: string;
  account_metadata: Record<string, string>;
}

interface SessionData {
  index: number;
  client_secret: string;
  status: string;
  accounts: AccountResult[];
}

interface BundleAuthFlowProps {
  bundleId: string;
  bundleToken: string;
  provider: string;
  publishableKey: string;
  sessions: SessionData[];
}

type FlowStatus =
  | "idle"
  | "connecting"
  | "submitting"
  | "session_success"
  | "all_done"
  | "error";

export default function BundleAuthFlow({
  bundleId,
  bundleToken,
  publishableKey,
  sessions,
}: BundleAuthFlowProps) {
  // Find first pending session
  const firstPendingIndex = sessions.findIndex((s) => s.status === "pending");

  // Collect already-connected accounts from prior sessions
  const priorAccounts = sessions
    .filter((s) => s.status === "completed")
    .flatMap((s) => s.accounts);

  const [currentIndex, setCurrentIndex] = useState(
    firstPendingIndex >= 0 ? firstPendingIndex : sessions.length
  );
  const [flowStatus, setFlowStatus] = useState<FlowStatus>(
    firstPendingIndex < 0 ? "all_done" : "idle"
  );
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [allConnectedAccounts, setAllConnectedAccounts] =
    useState<AccountResult[]>(priorAccounts);

  // Track completed session count (institutions, not accounts)
  const [sessionsCompletedCount, setSessionsCompletedCount] = useState(
    sessions.filter((s) => s.status === "completed").length
  );

  // Cache Stripe instance — same publishable key for all sessions
  const stripeRef = useRef<Promise<Stripe | null> | null>(null);

  const getStripe = useCallback(() => {
    if (!stripeRef.current) {
      stripeRef.current = loadStripe(publishableKey);
    }
    return stripeRef.current;
  }, [publishableKey]);

  const handleConnect = useCallback(async () => {
    setFlowStatus("connecting");
    setError("");

    try {
      const stripe = await getStripe();
      if (!stripe) {
        throw new Error("Failed to load Stripe");
      }

      const session = sessions[currentIndex];
      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: session.client_secret,
      });

      if (result.error) {
        const isStale =
          result.error.code === "session_expired" ||
          result.error.type === "invalid_request_error";

        if (isStale) {
          setError(
            "We couldn't connect to your financial institution. This may happen if the link has been open for a while. Please contact your accountant for a new link."
          );
          setRetryable(false);
        } else {
          setError(
            result.error.message || "Connection failed. Please try again."
          );
          setRetryable(true);
        }
        setFlowStatus("error");
        console.error(
          "Stripe FC error:",
          result.error.code,
          result.error.message
        );
        return;
      }

      const linkedAccounts = (
        result.financialConnectionsSession?.accounts ?? []
      ).map((account) => ({
        id: account.id,
        institution_name: account.institution_name ?? undefined,
        last4: account.last4 ?? undefined,
        category: account.category ?? undefined,
        subcategory: account.subcategory ?? undefined,
        display_name: account.display_name,
        status: account.status ?? undefined,
      }));

      if (linkedAccounts.length === 0) {
        setError("No accounts were connected. Please try again.");
        setRetryable(true);
        setFlowStatus("error");
        return;
      }

      // Submit results — X-Bundle-Token header (NOT X-Channel-Token)
      setFlowStatus("submitting");
      const submitResponse = await fetch(
        `/api/bundles/${bundleId}/results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Bundle-Token": bundleToken,
          },
          body: JSON.stringify({
            session_index: currentIndex,
            accounts: linkedAccounts,
          }),
        }
      );

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error ||
            `Submission failed (${submitResponse.status})`
        );
      }

      const submitData = (await submitResponse.json()) as {
        sessions_remaining: number;
      };

      // Map to ProviderResultItem shape for display (server stores this shape)
      const newAccounts: AccountResult[] = linkedAccounts.map((a) => ({
        provider_account_id: a.id,
        account_metadata: {
          institution_name: a.institution_name || "",
          last4: a.last4 || "",
          category: a.category || "",
          subcategory: a.subcategory || "",
          display_name: a.display_name ?? "",
          status: a.status || "",
        },
      }));

      setAllConnectedAccounts((prev) => [...prev, ...newAccounts]);
      setSessionsCompletedCount((prev) => prev + 1);

      if (submitData.sessions_remaining === 0) {
        // Server auto-completed the bundle
        setFlowStatus("all_done");
      } else {
        setFlowStatus("session_success");
      }
    } catch (err) {
      console.error("BundleAuthFlow error:", err);
      setError("Something went wrong. Please try again.");
      setRetryable(true);
      setFlowStatus("error");
    }
  }, [bundleId, bundleToken, currentIndex, sessions, getStripe]);

  const handleConnectAnother = useCallback(() => {
    // Find next pending session after current
    const nextPending = sessions.findIndex(
      (s, i) => i > currentIndex && s.status === "pending"
    );
    if (nextPending >= 0) {
      setCurrentIndex(nextPending);
      setFlowStatus("idle");
    }
  }, [currentIndex, sessions]);

  const handleDone = useCallback(async () => {
    try {
      await fetch(`/api/bundles/${bundleId}/complete`, {
        method: "POST",
        headers: {
          "X-Bundle-Token": bundleToken,
        },
      });
    } catch {
      // Best-effort — bundle stays active until expiry if this fails
    }
    setFlowStatus("all_done");
  }, [bundleId, bundleToken]);

  // All done state
  if (flowStatus === "all_done") {
    return (
      <div className="text-center">
        <div className="text-5xl mb-4">&#x2705;</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {allConnectedAccounts.length > 1
            ? "Accounts Connected Successfully"
            : "Account Connected Successfully"}
        </h2>
        <p className="text-gray-600 mb-6">You can close this page now.</p>
        {allConnectedAccounts.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 text-left">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Connected accounts:
            </p>
            {allConnectedAccounts.map((account) => (
              <div
                key={account.provider_account_id}
                className="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0"
              >
                {account.account_metadata?.institution_name || "Account"}{" "}
                {account.account_metadata?.last4
                  ? `****${account.account_metadata.last4}`
                  : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Session success state — offer to connect another
  if (flowStatus === "session_success") {
    const remainingCount = sessions.filter(
      (s, i) => i > currentIndex && s.status === "pending"
    ).length;

    return (
      <div className="text-center">
        <div className="text-5xl mb-4">&#x2705;</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Account Connected
        </h2>
        <p className="text-gray-600 mb-6">
          {allConnectedAccounts.length}{" "}
          {allConnectedAccounts.length === 1 ? "account" : "accounts"}{" "}
          connected so far.
        </p>

        {allConnectedAccounts.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 text-left mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Connected accounts:
            </p>
            {allConnectedAccounts.map((account) => (
              <div
                key={account.provider_account_id}
                className="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0"
              >
                {account.account_metadata?.institution_name || "Account"}{" "}
                {account.account_metadata?.last4
                  ? `****${account.account_metadata.last4}`
                  : ""}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {remainingCount > 0 && (
            <button
              onClick={handleConnectAnother}
              className="w-full bg-gray-900 text-white font-medium py-3 px-6 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer"
            >
              Connect Another Financial Account
            </button>
          )}
          <button
            onClick={handleDone}
            className="w-full bg-white text-gray-700 font-medium py-3 px-6 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            I&apos;m Done
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (flowStatus === "error") {
    return (
      <div className="text-center">
        <div className="text-5xl mb-4">&#x26A0;&#xFE0F;</div>
        <p className="text-gray-700 mb-6">{error}</p>
        {retryable && (
          <button
            onClick={handleConnect}
            className="w-full bg-gray-900 text-white font-medium py-3 px-6 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Try Again
          </button>
        )}
      </div>
    );
  }

  // Idle / Connecting / Submitting
  const isLoading = flowStatus === "connecting" || flowStatus === "submitting";
  const isFirstConnection = sessionsCompletedCount === 0;

  return (
    <div>
      {!isFirstConnection && (
        <p className="text-sm text-gray-500 text-center mb-4">
          Institution {sessionsCompletedCount + 1} of {sessions.length}
        </p>
      )}
      <button
        onClick={handleConnect}
        disabled={isLoading}
        className="w-full bg-gray-900 text-white font-medium py-3 px-6 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {flowStatus === "submitting" ? "Saving..." : "Connecting..."}
          </span>
        ) : isFirstConnection ? (
          "Connect Your Financial Account"
        ) : (
          "Connect Another Financial Account"
        )}
      </button>
    </div>
  );
}

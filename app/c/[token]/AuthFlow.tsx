"use client";

import { useState, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";

interface AuthFlowProps {
  channelId: string;
  channelToken: string;
  clientSecret: string;
  publishableKey: string;
  provider: string;
}

interface LinkedAccount {
  id: string;
  institution_name?: string;
  last4?: string;
  category?: string;
  subcategory?: string;
  display_name?: string | null;
  status?: string;
}

type FlowStatus = "idle" | "connecting" | "submitting" | "success" | "error";

export default function AuthFlow({
  channelId,
  channelToken,
  clientSecret,
  publishableKey,
}: AuthFlowProps) {
  const [status, setStatus] = useState<FlowStatus>("idle");
  const [error, setError] = useState<string>("");
  const [retryable, setRetryable] = useState(false);
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);

  const handleConnect = useCallback(async () => {
    setStatus("connecting");
    setError("");

    try {
      const stripe = await loadStripe(publishableKey);
      if (!stripe) {
        throw new Error("Failed to load Stripe");
      }

      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret,
      });

      if (result.error) {
        // Stale client_secret or user cancelled
        const isStale =
          result.error.code === "session_expired" ||
          result.error.type === "invalid_request_error";

        if (isStale) {
          setError(
            "We couldn't connect to your financial institution. This may happen if the link has been open for a while. Please contact your accountant for a new link."
          );
          setRetryable(false);
        } else {
          setError(result.error.message || "Connection failed. Please try again.");
          setRetryable(true);
        }
        setStatus("error");
        console.error("Stripe FC error:", result.error.code, result.error.message);
        return;
      }

      const linkedAccounts: LinkedAccount[] = (
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
        setStatus("error");
        return;
      }

      // Submit results to platform
      setStatus("submitting");
      const submitResponse = await fetch(`/api/channels/${channelId}/results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Channel-Token": channelToken,
        },
        body: JSON.stringify({ accounts: linkedAccounts }),
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || `Submission failed (${submitResponse.status})`
        );
      }

      setAccounts(linkedAccounts);
      setStatus("success");
    } catch (err) {
      console.error("AuthFlow error:", err);
      setError("Something went wrong. Please try again.");
      setRetryable(true);
      setStatus("error");
    }
  }, [channelId, channelToken, clientSecret, publishableKey]);

  if (status === "success") {
    return (
      <div className="text-center">
        <div className="text-5xl mb-4">&#x2705;</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Account Connected Successfully
        </h2>
        <p className="text-gray-600 mb-6">
          You can close this page now.
        </p>
        {accounts.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 text-left">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Connected accounts:
            </p>
            {accounts.map((account) => (
              <div
                key={account.id}
                className="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0"
              >
                {account.institution_name || "Account"}{" "}
                {account.last4 ? `****${account.last4}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (status === "error") {
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

  const isLoading = status === "connecting" || status === "submitting";

  return (
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
          {status === "submitting" ? "Saving..." : "Connecting..."}
        </span>
      ) : (
        "Connect Your Financial Account"
      )}
    </button>
  );
}

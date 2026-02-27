import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Image from "next/image";
import { db } from "@/lib/db";
import { channels, channelResults } from "@/lib/schema";
import AuthFlow from "./AuthFlow";

interface ConsentData {
  title: string;
  body: string;
  firm_name: string;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full">{children}</div>
      <div className="mt-12 opacity-40">
        <Image src="/icon.svg" alt="" width={24} height={24} />
      </div>
    </div>
  );
}

export default async function AuthPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.token, token));

  if (!channel) {
    notFound();
  }

  const consent = channel.consent as ConsentData;

  // Expired
  if (new Date(channel.expiresAt) < new Date()) {
    return (
      <PageShell>
        <div className="text-center">
          <Image
            src="/icon.svg"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-4 opacity-30"
          />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Link Expired
          </h1>
          <p className="text-gray-600">
            This link has expired. Please contact your accountant for a new
            link.
          </p>
        </div>
      </PageShell>
    );
  }

  // Already completed
  if (channel.status === "completed") {
    const results = await db
      .select()
      .from(channelResults)
      .where(eq(channelResults.channelId, channel.id));

    return (
      <PageShell>
        <div className="text-center">
          <Image
            src="/icon.svg"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-4"
          />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Already Connected
          </h1>
          <p className="text-gray-600 mb-6">
            Your account has already been connected successfully.
          </p>
          {results.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4 text-left">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Connected accounts:
              </p>
              {results.map((r) => {
                const meta = r.accountMetadata as Record<string, string>;
                return (
                  <div
                    key={r.id}
                    className="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0"
                  >
                    {meta?.institution_name || "Account"}{" "}
                    {meta?.last4 ? `****${meta.last4}` : ""}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PageShell>
    );
  }

  // Pending — show consent + auth flow
  return (
    <PageShell>
      <div className="text-center mb-8">
        <Image
          src="/icon.svg"
          alt=""
          width={36}
          height={36}
          className="mx-auto mb-3"
        />
        <p className="text-sm text-gray-500 mb-1">Requested by</p>
        <h2 className="text-lg font-semibold text-gray-900">
          {consent.firm_name}
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-3">
          {consent.title}
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">
          {consent.body}
        </p>
      </div>

      <AuthFlow
        channelId={channel.id}
        channelToken={channel.token}
        clientSecret={channel.providerClientSecret}
        publishableKey={channel.providerPublishableKey || ""}
        provider={channel.provider}
      />
    </PageShell>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Image from "next/image";
import { db } from "@/lib/db";
import { channels, channelResults } from "@/lib/schema";

export default async function SuccessPage({
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

  if (channel.status !== "completed") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <p className="text-gray-600">
            This connection has not been completed yet.
          </p>
        </div>
      </div>
    );
  }

  const results = await db
    .select()
    .from(channelResults)
    .where(eq(channelResults.channelId, channel.id));

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <Image
          src="/icon.svg"
          alt=""
          width={48}
          height={48}
          className="mx-auto mb-4"
        />
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Account Connected
        </h1>
        <p className="text-gray-600 mb-6">
          Your bank account has been successfully connected. You can close this
          page.
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
      <div className="mt-12 opacity-40">
        <Image src="/icon.svg" alt="" width={24} height={24} />
      </div>
    </div>
  );
}

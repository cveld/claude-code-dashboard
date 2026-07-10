"use client";

import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-4">
      <h2 className="text-lg font-semibold text-zinc-200">Something went wrong</h2>
      <p className="text-sm text-zinc-500 max-w-md">
        {error.message || "An unexpected error occurred while rendering this page."}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Back to Projects
        </Link>
      </div>
    </div>
  );
}

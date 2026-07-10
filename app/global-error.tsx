"use client";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center gap-4">
          <h2 className="text-lg font-semibold text-zinc-200">Something went wrong</h2>
          <p className="text-sm text-zinc-500 max-w-md">
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => unstable_retry()}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

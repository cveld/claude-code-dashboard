import { notFound } from "next/navigation";
import { ResponsiveViewer } from "./responsive-viewer";

export default function GalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="max-w-5xl w-full mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Component Gallery</h1>
        <p className="text-xs text-zinc-500 mt-1">Dev-only — returns 404 in production. Fixture data, no API calls.</p>
      </div>
      <ResponsiveViewer />
    </div>
  );
}

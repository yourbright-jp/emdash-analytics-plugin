import { getEmDashCollection, getEmDashEntry } from "emdash";

import type { ManagedContentRef, PageKind } from "./types.js";

interface EntryLike {
  id?: string;
  slug?: string | null;
  data?: Record<string, unknown>;
}

export function classifyPageKind(urlPath: string): PageKind {
  if (/^\/blog\/[^/]+\/$/.test(urlPath)) return "blog_post";
  if (urlPath === "/blog/" || /^\/blog\/[^/]+\/$/.test(urlPath)) return "blog_archive";
  if (urlPath.startsWith("/tag/")) return "tag";
  if (urlPath.startsWith("/author/")) return "author";
  if (
    urlPath === "/" ||
    urlPath.startsWith("/company/") ||
    urlPath.startsWith("/contact/") ||
    urlPath.startsWith("/download/") ||
    urlPath.startsWith("/foreignworkers/") ||
    urlPath.startsWith("/jirei/") ||
    urlPath.startsWith("/kaigo/") ||
    urlPath.startsWith("/pr/") ||
    urlPath.startsWith("/seminar/")
  ) {
    return "landing";
  }
  return "other";
}

export function normalizePath(pathOrUrl: string, expectedHost?: string): string | null {
  try {
    const parsed = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, "https://placeholder.invalid");
    if (expectedHost && parsed.hostname !== "placeholder.invalid" && parsed.hostname !== expectedHost) {
      return null;
    }
    let pathname = parsed.pathname || "/";
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
    pathname = pathname.replace(/\/{2,}/g, "/");
    if (pathname !== "/" && !pathname.endsWith("/")) pathname = `${pathname}/`;
    return pathname;
  } catch {
    return null;
  }
}

export function buildContentUrl(siteOrigin: string, urlPath: string): string {
  return new URL(urlPath, `${siteOrigin}/`).toString();
}

export async function getManagedContentMap(siteOrigin: string): Promise<Map<string, ManagedContentRef>> {
  const result = await getEmDashCollection("posts", {
    status: "published",
    limit: 1000,
    orderBy: { updatedAt: "desc" }
  });

  const managed = new Map<string, ManagedContentRef>();
  for (const entry of result.entries as Array<EntryLike>) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id) continue;
    const slug = typeof entry.slug === "string" ? entry.slug : null;
    const data = entry.data ?? {};
    const title = typeof data.title === "string" ? data.title : slug || id;
    const excerpt = typeof data.excerpt === "string" ? data.excerpt : undefined;
    const seoDescription =
      typeof data.seo_description === "string" ? data.seo_description : undefined;
    const urlPath = `/blog/${slug || id}/`;
    managed.set(urlPath, {
      collection: "posts",
      id,
      slug,
      urlPath,
      title,
      excerpt,
      seoDescription
    });
  }

  void siteOrigin;
  return managed;
}

export async function resolveManagedContent(
  collection: string,
  id?: string,
  slug?: string,
  siteOrigin?: string
): Promise<ManagedContentRef | null> {
  if (collection !== "posts") return null;
  const ref = id || slug;
  if (!ref) return null;

  const result = await getEmDashEntry("posts", ref);
  const entry = result.entry as EntryLike | null;
  if (!entry) return null;
  const entryId = typeof entry.id === "string" ? entry.id : ref;
  const entrySlug = typeof entry.slug === "string" ? entry.slug : null;
  const data = entry.data ?? {};
  const urlPath = `/blog/${entrySlug || entryId}/`;
  return {
    collection: "posts",
    id: entryId,
    slug: entrySlug,
    urlPath,
    title: typeof data.title === "string" ? data.title : entrySlug || entryId,
    excerpt: typeof data.excerpt === "string" ? data.excerpt : undefined,
    seoDescription: typeof data.seo_description === "string" ? data.seo_description : undefined
  };
}

export function pageStorageId(urlPath: string): string {
  return stableStorageId(urlPath);
}

export function pageQueryStorageId(urlPath: string, query: string): string {
  return stableStorageId(`${urlPath}::${query}`);
}

export function dailyMetricStorageId(source: "gsc" | "ga", scope: "all_public", date: string): string {
  return stableStorageId(`${source}::${scope}::${date}`);
}

function stableStorageId(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return `ybci_${(hash >>> 0).toString(16)}`;
}

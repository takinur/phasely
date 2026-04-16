import matter from "gray-matter";

export type ProfileData = Record<string, unknown>;

export function parseProfileMarkdown(markdown: string): ProfileData {
  const parsed = matter(markdown);
  return parsed.data as ProfileData;
}
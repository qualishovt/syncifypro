/**
 * export/entities/content.js
 *
 * Combined "Content" entity = pages + blog articles in one sheet, distinguished
 * by a `content_type` column. Page and article rows are mapped onto a shared
 * union shape (page_id/article_id → id, body_summary/summary → summary, etc.).
 */

import { extractPages } from "./pages.js";
import { extractArticles } from "./articles.js";

const BLANK = {
  content_type: "", id: "", title: "", handle: "", body_html: "", summary: "",
  author: "", tags: "", image_url: "", image_alt: "", blog_id: "",
  blog_handle: "", blog_title: "", published: "", published_at: "",
  template_suffix: "", created_at: "", updated_at: "",
};

export async function extractContent(admin, { query = "", onProgress } = {}) {
  let processed = 0;
  const tick = onProgress ? (n) => onProgress(processed + n) : undefined;
  const pages = (await extractPages(admin, { query, onProgress: tick })).map((p) => ({
    ...BLANK,
    content_type: "page",
    id: p.page_id, title: p.title, handle: p.handle, body_html: p.body_html,
    summary: p.body_summary, published: p.published, published_at: p.published_at,
    template_suffix: p.template_suffix, created_at: p.created_at, updated_at: p.updated_at,
  }));
  processed += pages.length;
  const articles = (await extractArticles(admin, { query, onProgress: tick })).map((a) => ({
    ...BLANK,
    content_type: "article",
    id: a.article_id, title: a.title, handle: a.handle, body_html: a.body_html,
    summary: a.summary, author: a.author, tags: a.tags, image_url: a.image_url,
    image_alt: a.image_alt, blog_id: a.blog_id, blog_handle: a.blog_handle,
    blog_title: a.blog_title, published: a.published, published_at: a.published_at,
    template_suffix: a.template_suffix, created_at: a.created_at, updated_at: a.updated_at,
  }));
  return [...pages, ...articles];
}

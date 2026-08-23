/** routes/blog/:slug — a single post. */

import { useLoaderData } from "react-router";
import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { POSTS, getPost, formatDate } from "../content/posts.js";

export const meta = ({ data }) =>
  data?.post
    ? [{ title: `${data.post.title} — SyncifyPro` }, { name: "description", content: data.post.excerpt }]
    : [{ title: "Post not found — SyncifyPro" }];

export async function loader({ params }) {
  const post = getPost(params.slug);
  if (!post) throw new Response("Not found", { status: 404 });
  const more = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
  return { post, more };
}

export default function Post() {
  const { post, more } = useLoaderData();
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/blog" style={c.back}>← All posts</a>
        <h1 style={c.h1}>{post.title}</h1>
        <p style={c.meta}>{formatDate(post.date)} · {post.readingTime}</p>
        <Blocks blocks={post.body} />

        <h2 style={c.groupTitle}>More reading</h2>
        <div style={c.grid} className="sc-grid">
          {more.map((p) => (
            <a key={p.slug} href={`/blog/${p.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{formatDate(p.date)}</p>
              <h3 style={c.cardTitle}>{p.title}</h3>
              <p style={c.cardBody}>{p.excerpt}</p>
            </a>
          ))}
        </div>

        <div style={c.cta}>
          <p style={c.ctaTitle}>Try it on your own store</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

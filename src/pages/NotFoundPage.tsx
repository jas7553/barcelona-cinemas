import { useNow } from "../client/clock";
import { Layout } from "../components/Layout";
import type { PageBase } from "../pageData";

export function NotFoundPage({ data }: { data: PageBase }) {
  const now = useNow(data.renderedAt);
  return (
    <Layout data={data} now={now}>
      <div class="empty">
        <h1 class="display empty-big">Not showing.</h1>
        <p class="sub">That page doesn't exist, or the film has finished its run.</p>
        <a class="pill pill--on" href="/">
          See what's on this week
        </a>
      </div>
    </Layout>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { source } from "@/lib/source";
import { mdxComponents } from "@/mdx-components";

export function generateStaticParams() {
  return source.generateParams();
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const doc = page.data;
  const MDX = doc.body;

  return (
    <div className="max-w-4xl mx-auto min-h-svh px-6 py-12">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; All components
      </Link>

      <header className="mt-6 mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
          <Badge variant="secondary">ui</Badge>
        </div>
        {doc.description && (
          <p className="mt-2 text-muted-foreground">{doc.description}</p>
        )}
      </header>

      <Separator className="mb-8" />

      <div className="prose prose-invert max-w-none">
        <MDX components={mdxComponents} />
      </div>
    </div>
  );
}

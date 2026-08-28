import type { MDXComponents } from "mdx/types";

import { CodeBlock } from "@/components/code-block";
import { PreviewCard } from "@/components/preview-card";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const mdxComponents: MDXComponents = {
  PreviewCard,
  h2: (props) => (
    <h2
      className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mt-10 mb-4 first:mt-0"
      {...props}
    />
  ),
  p: (props) => <p {...props} />,
  pre: (props) => <CodeBlock {...props} />,
  code: (props) => <code className="text-foreground text-xs" {...props} />,
  table: (props) => (
    <Card className="mb-4 overflow-hidden">
      <Table {...props} />
    </Card>
  ),
  thead: (props) => <TableHeader {...props} />,
  tbody: (props) => <TableBody {...props} />,
  tr: (props) => <TableRow {...props} />,
  th: (props) => (
    <TableHead
      className="text-xs font-semibold text-muted-foreground"
      {...props}
    />
  ),
  td: (props) => <TableCell className="text-sm" {...props} />,
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...mdxComponents, ...components };
}

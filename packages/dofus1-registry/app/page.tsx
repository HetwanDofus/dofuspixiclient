import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getRegistryItems } from "@/lib/registry";

export default function Home() {
  const items = getRegistryItems();

  return (
    <div className="max-w-4xl mx-auto min-h-svh px-6 py-12">
      <header className="mb-12">
        <h1 className="text-3xl font-bold tracking-tight">Dofus1 Registry</h1>
        <p className="mt-2 text-muted-foreground">
          Game UI components for Dofus 1.29, installable via shadcn CLI.
        </p>
      </header>
      <div className="grid gap-4">
        {items.map((item) => (
          <Link key={item.name} href={`/docs/components/${item.name}`}>
            <Card className="hover:border-foreground/20 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{item.title}</CardTitle>
                  <Badge variant="secondary">
                    {item.type.replace("registry:", "")}
                  </Badge>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <code className="text-xs text-muted-foreground">
                  npx shadcn@latest add {item.name}
                </code>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import type { Role } from "./session-registry.ts";
import type { Upstream } from "./upstream.ts";

// One Upstream per role. Each keeps its own blue/green handoff state — an
// authd rollout and a gamed rollout are independent events. Callers always go
// through this registry rather than holding Upstream refs directly.

export class UpstreamRegistry {
  private readonly byRole = new Map<Role, Upstream>();

  register(upstream: Upstream): void {
    if (this.byRole.has(upstream.role)) {
      throw new Error(
        `upstream for role "${upstream.role}" already registered`
      );
    }
    this.byRole.set(upstream.role, upstream);
  }

  get(role: Role): Upstream {
    const up = this.byRole.get(role);
    if (!up) {
      throw new Error(`no upstream registered for role "${role}"`);
    }
    return up;
  }

  status() {
    return Array.from(this.byRole.values()).map((u) => u.status());
  }
}

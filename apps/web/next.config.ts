import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
};

// `withWorkflow()` enables the `"use workflow"` and `"use step"`
// directives the SDK needs to transform our workflow files. It also
// generates internal route handlers under `/.well-known/workflow/*`
// at build time — see `middleware.ts` for the matcher exclusion that
// keeps the auth middleware off those paths.
export default withWorkflow(nextConfig);

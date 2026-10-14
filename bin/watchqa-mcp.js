#!/usr/bin/env node
import { serve } from "../src/mcp.js";

serve().catch((err) => {
  console.error(`watchqa-mcp: ${err.message}`);
  process.exit(1);
});

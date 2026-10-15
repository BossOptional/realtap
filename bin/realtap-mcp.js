#!/usr/bin/env node
import { serve } from "../src/mcp.js";

serve().catch((err) => {
  console.error(`realtap-mcp: ${err.message}`);
  process.exit(1);
});

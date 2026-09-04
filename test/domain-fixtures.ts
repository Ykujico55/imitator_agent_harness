import type { TaskSpec } from "../src/types.ts";

// Domains live in test inputs, not in a production glossary or scoring branches.
export const cacheTask: TaskSpec = {
  task: "Implement a small zero-dependency TypeScript LRU cache with capacity eviction and TTL expiration",
  language: "TypeScript", ecosystem: "node",
  domain: {
    purpose: { name: "lru cache", aliases: ["lru", "least recently used"], taskEvidence: "LRU cache" },
    capabilities: [
      { name: "eviction", aliases: ["evict", "recency"], taskEvidence: "capacity eviction" },
      { name: "expiration", aliases: ["ttl", "expires at", "expiry"], taskEvidence: "TTL expiration" },
    ],
  },
};

export const queueTask: TaskSpec = {
  task: "Build a persistent job queue with retries and worker acknowledgement",
  domain: {
    purpose: { name: "job queue", aliases: ["task queue"], taskEvidence: "job queue" },
    capabilities: [
      { name: "retry", aliases: ["retries", "backoff"], taskEvidence: "retries" },
      { name: "acknowledge", aliases: ["acknowledgement", "ack"], taskEvidence: "worker acknowledgement" },
    ],
  },
};

export const parserTask: TaskSpec = {
  task: "开发 Markdown 解析器，将文本转成语法树，支持语法错误恢复",
  domain: {
    purpose: { name: "markdown parser", aliases: ["commonmark", "markdown解析器"], taskEvidence: "Markdown 解析器" },
    capabilities: [
      { name: "syntax tree", aliases: ["ast", "parse"], taskEvidence: "文本转成语法树" },
      { name: "error recovery", aliases: ["recover"], taskEvidence: "语法错误恢复" },
    ],
  },
};

export const calendarTask: TaskSpec = {
  task: "Create a calendar that expands recurring events across timezones",
  domain: {
    purpose: { name: "calendar", aliases: ["calendaring"], taskEvidence: "calendar" },
    capabilities: [
      { name: "recurrence", aliases: ["recurring", "rrule"], taskEvidence: "recurring events" },
      { name: "timezone", aliases: ["timezones", "tzid"], taskEvidence: "timezones" },
    ],
  },
};

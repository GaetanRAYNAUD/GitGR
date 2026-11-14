// Icônes au trait (24×24), couleur héritée de `currentColor`.

const PATHS = {
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
  pull: "M12 4v12m-5-5 5 5 5-5M5 20h14",
  push: "M12 20V8m-5 5 5-5 5 5M5 4h14",
  fetch: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  stash: "M4 9h16v11H4zM9 13h6M3 5h18v4H3z",
  pop: "M4 11h16v9H4zM12 16V3m-4 4 4-4 4 4",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  minimize: "M5 12h14",
  maximize: "M6 6h12v12H6z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  check: "m5 12 5 5 9-10",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  cloud:"M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9Z",
  commit: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 12h5M16 12h5",
  tag: "M3 12V4h8l9 9-8 8-9-9ZM7.5 8h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  chevron: "m6 9 6 6 6-6",
  back: "M19 12H5m6-6-6 6 6 6",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  inline: "M4 5h16v14H4zM8 9h8M8 12h8M8 15h5",
  split: "M4 5h16v14H4zM12 5v14M6.5 9h3M6.5 12h3M14.5 9h3M14.5 12h3",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  tree: "M4 4h6v4H4zM13 10h7v4h-7zM13 17h7v4h-7zM7 8v11h6M7 12h6",
  file: "M14 3H6v18h12V7l-4-4ZM14 3v4h4",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `ico ${className}` : "ico"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

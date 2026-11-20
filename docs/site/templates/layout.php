<?php
/** @var Site\Page $page */
use Site\View;
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= View::e($page->title) ?> | ドキュメント</title>
<style>
  :root { --fg: #222; --bg: #fff; --muted: #666; --line: #ddd; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e5e5e5; --bg: #161616; --muted: #999; --line: #333; --accent: #60a5fa; } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; line-height: 1.7; color: var(--fg); background: var(--bg); }
  .wrap { display: flex; gap: 32px; max-width: 1100px; margin: 0 auto; padding: 16px; }
  nav { flex: 0 0 200px; font-size: 0.9em; }
  nav ul { list-style: none; padding: 0; margin: 0; }
  nav a { display: block; padding: 2px 0; color: var(--muted); text-decoration: none; }
  nav a[aria-current] { color: var(--accent); font-weight: bold; }
  main { flex: 1; min-width: 0; }
  a { color: var(--accent); }
  img { max-width: 100%; }
  pre { overflow-x: auto; padding: 12px; border: 1px solid var(--line); }
  code { font-family: ui-monospace, monospace; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  .cap { color: var(--muted); font-size: 0.85em; }
  @media (max-width: 720px) { .wrap { flex-direction: column; gap: 8px; } nav { flex: none; } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <ul>
<?php foreach ($page->nav as $item): ?>
      <li><a href="<?= View::e($item->href) ?>"<?= $item->href === $page->current ? ' aria-current="page"' : '' ?>><?= View::e($item->title) ?></a></li>
<?php endforeach ?>
    </ul>
  </nav>
  <main>
<?= $page->body ?>
  </main>
</div>
</body>
</html>

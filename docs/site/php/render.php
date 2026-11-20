<?php
// build.mjs から呼ばれる。標準入力の JSON を1ページの HTML にして標準出力へ書く。
declare(strict_types=1);

require __DIR__ . '/Site.php';

use Site\{Device, NavItem, Page, View};

$input = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$view = new View(dirname(__DIR__) . '/templates');

$nav = array_map(
    static fn(array $n): NavItem => new NavItem(...$n),
    $input['nav'],
);

[$title, $body] = match ($input['kind']) {
    'doc' => [$input['title'], $input['html']],
    'devices' => [
        '機器の一覧',
        $view->render('devices', [
            'devices' => array_map(Device::fromArray(...), $input['devices']),
        ]),
    ],
    default => throw new UnexpectedValueException("不明な種類: {$input['kind']}"),
};

echo $view->render('layout', [
    'page' => new Page(title: $title, body: $body, nav: $nav, current: $input['href']),
]);

<?php
/** @var list<Site\Device> $devices */
use Site\View;
?>
<h1>機器の一覧</h1>
<table>
  <thead>
    <tr><th>Lv</th><th>名前</th><th>種類</th><th>ポート</th><th>価格</th></tr>
  </thead>
  <tbody>
<?php foreach ($devices as $d): ?>
    <tr>
      <td class="num"><?= $d->unlockLevel ?></td>
      <td>
        <strong><?= View::e($d->name) ?></strong><br>
        <?= View::e($d->desc) ?>
<?php if ($d->capabilities !== []): ?>
        <div class="cap"><?= View::e(implode(' / ', $d->capabilities)) ?></div>
<?php endif ?>
      </td>
      <td><?= View::e($d->category) ?></td>
      <td><?= implode('<br>', array_map(static fn($p) => View::e($p->label()), $d->ports)) ?></td>
      <td class="num"><?= View::e(number_format($d->price)) ?> 円</td>
    </tr>
<?php endforeach ?>
  </tbody>
</table>

// 実データの登録表。機器・ケーブル・家具の定義を virtual:game-data から読むのは、このファイルだけにする。
import { cables, devices, furniture } from 'virtual:game-data';
import { bootstrap } from './bootstrap';

export const registries = bootstrap({ devices, cables, furniture });

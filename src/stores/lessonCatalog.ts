// ゲームのデータから作った、学習モードで開ける構成の目録
import { contracts, drills, lessons } from 'virtual:game-data';
import { lessonCatalogOf } from '../sim/lessonCatalog';

export const lessonCatalog = lessonCatalogOf(lessons, contracts, drills);
